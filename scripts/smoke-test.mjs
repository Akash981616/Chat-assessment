import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { io } from 'socket.io-client';
import { deleteApp, getApps } from 'firebase-admin/app';
import { Timestamp } from 'firebase-admin/firestore';
import { config } from '../dist/config.js';
import { firestore, lastSeenCollection, messageCollection, outboxCollection, receiptCollection } from '../dist/lib/firebase.js';

const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3000';
const database = new Pool({ connectionString: config.DATABASE_URL });
const testUsers = ['smoke-user-a', 'smoke-user-b', 'smoke-outsider'];

function makeToken(userId) {
  return jwt.sign({}, config.JWT_SECRET, { subject: userId, expiresIn: '5m', algorithm: 'HS256' });
}

async function request(path, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${apiBase}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function waitFor(predicate, description, timeoutMs = 15_000) {
  const expiresAt = Date.now() + timeoutMs;
  while (Date.now() < expiresAt) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

let socket;
try {
  await database.query(
    'INSERT INTO users(id) VALUES ($1), ($2), ($3) ON CONFLICT (id) DO NOTHING',
    testUsers,
  );

  const unauthenticated = await request('/user/smoke-user-a/chats');
  assert.equal(unauthenticated.status, 401, 'protected routes reject requests without a JWT');

  const tokenA = makeToken(testUsers[0]);
  const tokenB = makeToken(testUsers[1]);
  const outsiderToken = makeToken(testUsers[2]);
  const malformedJson = await fetch(`${apiBase}/chat/create`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
    body: '{invalid-json',
  });
  assert.equal(malformedJson.status, 400, 'malformed JSON receives a client error');
  const createResponse = await request('/chat/create', {
    token: tokenA,
    method: 'POST',
    body: { userAId: testUsers[0], userBId: testUsers[1] },
  });
  assert.equal(createResponse.status, 200, 'authenticated user can create a chat they belong to');
  const { chatId } = await createResponse.json();
  assert.match(chatId, /^[0-9a-f-]{36}$/i);

  const forbiddenHistory = await request(`/chat/${chatId}/messages`, { token: outsiderToken });
  assert.equal(forbiddenHistory.status, 403, 'non-members cannot read chat history');

  socket = io(apiBase, { transports: ['websocket'], auth: { token: tokenB }, reconnection: false });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connection timed out')), 8_000);
    socket.once('connect', () => { clearTimeout(timer); resolve(); });
    socket.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
  });
  await new Promise((resolve, reject) => {
    socket.timeout(5_000).emit('chat:join', { chatId }, (error, result) => {
      if (error) { reject(error); return; }
      if (!result?.ok) { reject(new Error(result?.error ?? 'Socket room join failed')); return; }
      resolve();
    });
  });

  const marker = `smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const incomingMessage = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for chat:message')), 10_000);
    socket.once('chat:message', (message) => { clearTimeout(timer); resolve(message); });
  });
  const sendResponse = await request(`/chat/${chatId}/message/send`, {
    token: tokenA,
    method: 'POST',
    body: { text: marker },
  });
  assert.equal(sendResponse.status, 201, 'member can send a message');
  const sent = (await sendResponse.json()).message;
  const received = await incomingMessage;
  assert.equal(received.id, sent.id, 'Socket.IO delivers the persisted message');
  assert.equal(received.text, marker);
  assert.equal(received.senderId, testUsers[0]);

  const historyResponse = await request(`/chat/${chatId}/messages?limit=50`, { token: tokenB });
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json();
  assert.ok(history.messages.some((message) => message.id === sent.id), 'message is readable from history');

  const readResponse = await request(`/chat/${chatId}/message/${sent.id}/read`, {
    token: tokenB,
    method: 'POST',
  });
  assert.equal(readResponse.status, 204, 'member can update their read receipt');

  const lastSeenResponse = await request(`/chat/${chatId}/lastseen`, {
    token: tokenB,
    method: 'POST',
    body: { messageId: sent.id },
  });
  assert.equal(lastSeenResponse.status, 204, 'member can update last-seen state');

  const chatsResponse = await request(`/user/${testUsers[0]}/chats`, { token: tokenA });
  assert.equal(chatsResponse.status, 200);
  assert.ok((await chatsResponse.json()).chats.some((chat) => chat.id === chatId));

  const receipt = await firestore.collection(receiptCollection).doc(`${sent.id}_${testUsers[1]}`).get();
  assert.equal(receipt.exists, true, 'read receipt is persisted');
  const firstReadAt = receipt.get('readAt');
  const repeatedReadResponse = await request(`/chat/${chatId}/message/${sent.id}/read`, {
    token: tokenB,
    method: 'POST',
  });
  assert.equal(repeatedReadResponse.status, 204, 'marking a message read is idempotent');
  assert.ok(firstReadAt.isEqual((await receipt.ref.get()).get('readAt')), 'repeated reads preserve the original receipt time');
  const lastSeen = await firestore.collection(lastSeenCollection).doc(`${chatId}_${testUsers[1]}`).get();
  assert.equal(lastSeen.get('messageId'), sent.id, 'last-seen pointer is persisted');
  await waitFor(async () => (await firestore.collection(outboxCollection).doc(sent.id).get()).get('status') === 'delivered', 'worker delivery acknowledgement');
  assert.equal((await firestore.collection(messageCollection).doc(sent.id).get()).exists, true);

  const edgeUserId = `smoke/user-${Date.now()}`;
  const edgePeerId = `smoke-peer-${Date.now()}`;
  await database.query('INSERT INTO users(id) VALUES ($1), ($2) ON CONFLICT (id) DO NOTHING', [edgeUserId, edgePeerId]);
  const edgeToken = makeToken(edgeUserId);
  const edgeChatResponse = await request('/chat/create', {
    token: edgeToken,
    method: 'POST',
    body: { userAId: edgeUserId, userBId: edgePeerId },
  });
  assert.equal(edgeChatResponse.status, 200, 'subjects containing slashes can create chats');
  const { chatId: edgeChatId } = await edgeChatResponse.json();
  const tieTime = Timestamp.fromMillis(Date.now());
  const tiedMessages = [firestore.collection(messageCollection).doc(), firestore.collection(messageCollection).doc()]
    .sort((left, right) => left.id.localeCompare(right.id));
  await Promise.all(tiedMessages.map((ref) => ref.set({
    chatId: edgeChatId,
    senderId: edgeUserId,
    text: 'ordering fixture',
    createdAt: tieTime,
  })));
  const slashReceiptResponse = await request(`/chat/${edgeChatId}/message/${tiedMessages[0].id}/read`, {
    token: edgeToken,
    method: 'POST',
  });
  assert.equal(slashReceiptResponse.status, 204, 'slash-containing subjects can write read receipts');
  assert.equal((await firestore.collection(receiptCollection)
    .doc(`${tiedMessages[0].id}_${encodeURIComponent(edgeUserId)}`).get()).exists, true);
  const advanceLastSeen = await request(`/chat/${edgeChatId}/lastseen`, {
    token: edgeToken,
    method: 'POST',
    body: { messageId: tiedMessages[1].id },
  });
  assert.equal(advanceLastSeen.status, 204, 'last-seen accepts the later ID when timestamps tie');
  const reverseLastSeen = await request(`/chat/${edgeChatId}/lastseen`, {
    token: edgeToken,
    method: 'POST',
    body: { messageId: tiedMessages[0].id },
  });
  assert.equal(reverseLastSeen.status, 400, 'last-seen cannot move backward across tied timestamps');

  console.log('Smoke checks passed: authentication, access control, chat creation, message persistence, Socket.IO relay, idempotent read receipts, monotonic last seen, chat listing, and worker outbox delivery.');
} finally {
  socket?.disconnect();
  await database.end();
  await Promise.all(getApps().map((app) => deleteApp(app)));
}
