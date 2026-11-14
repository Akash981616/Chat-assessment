import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { io as createSocket } from 'socket.io-client';
import { config } from '../dist/config.js';

const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3000';
const database = new Pool({ connectionString: config.DATABASE_URL });
const users = ['smoke-user-a', 'smoke-user-b', 'smoke-outsider'];
const sockets = [];

function token(userId) {
  return jwt.sign({}, config.JWT_SECRET, { subject: userId, expiresIn: '5m', algorithm: 'HS256' });
}

async function request(path, { accessToken, method = 'GET', body } = {}) {
  const headers = {};
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${apiBase}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function connectSocket(accessToken) {
  const socket = createSocket(apiBase, { auth: { token: accessToken }, transports: ['websocket'], timeout: 5000 });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

function joinChat(socket, chatId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket chat:join acknowledgement timed out')), 5000);
    socket.emit('chat:join', { chatId }, (result) => { clearTimeout(timer); resolve(result); });
  });
}

try {
  const health = await request('/health');
  assert.equal(health.status, 200, 'health endpoint responds');
  assert.equal((await health.json()).status, 'ok');

  const unauthenticated = await request('/user/smoke-user-a/chats');
  assert.equal(unauthenticated.status, 401, 'protected routes require a JWT');

  await database.query('INSERT INTO users(id) VALUES ($1), ($2), ($3) ON CONFLICT (id) DO NOTHING', users);
  const tokenA = token(users[0]);
  const tokenB = token(users[1]);
  const outsiderToken = token(users[2]);

  const createChat = async (userAId, userBId) => request('/chat/create', {
    accessToken: tokenA,
    method: 'POST',
    body: { userAId, userBId },
  });
  const createdResponse = await createChat(users[0], users[1]);
  assert.equal(createdResponse.status, 200, 'authenticated participant can create a chat');
  const created = await createdResponse.json();
  const repeated = await createChat(users[1], users[0]);
  assert.equal((await repeated.json()).chatId, created.chatId, 'direct chat creation is idempotent and order-independent');

  const spoofedCreate = await request('/chat/create', {
    accessToken: outsiderToken,
    method: 'POST',
    body: { userAId: users[0], userBId: users[1] },
  });
  assert.equal(spoofedCreate.status, 403, 'users cannot create chats pretending to be other participants');

  const forbiddenHistory = await request(`/chat/${created.chatId}/messages`, { accessToken: outsiderToken });
  assert.equal(forbiddenHistory.status, 403, 'non-members cannot read chat history');
  const forbiddenChatList = await request(`/user/${users[0]}/chats`, { accessToken: tokenB });
  assert.equal(forbiddenChatList.status, 403, 'users cannot list another account\'s chats');

  const chats = await request(`/user/${users[0]}/chats`, { accessToken: tokenA });
  assert.equal(chats.status, 200);
  assert.ok((await chats.json()).chats.some((chat) => chat.id === created.chatId));

  const memberSocket = await connectSocket(tokenB);
  assert.deepEqual(await joinChat(memberSocket, created.chatId), { ok: true }, 'chat members can join their Socket.IO room');
  const outsiderSocket = await connectSocket(outsiderToken);
  const deniedJoin = await joinChat(outsiderSocket, created.chatId);
  assert.equal(deniedJoin.ok, false, 'non-members cannot join a Socket.IO room');

  console.log('API smoke checks passed: health, JWT authentication, direct chat idempotency, participant enforcement, REST and Socket.IO membership checks, and chat listing.');
} finally {
  for (const socket of sockets) socket.disconnect();
  await database.end();
}
