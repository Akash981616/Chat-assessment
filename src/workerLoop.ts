import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { firestore, messageCollection, outboxCollection } from './lib/firebase.js';
import type { Message } from './models/message.js';

const MAX_ATTEMPTS = 8;
const LEASE_MS = 30_000;
const BASE_RETRY_MS = 1_000;
const MAX_RETRY_MS = 60_000;
const BATCH_SIZE = 25;

type RelayMessage = (chatId: string, message: Message) => Promise<void>;
interface ClaimedDelivery { messageId: string; chatId: string; attempt: number; token: string }

async function claimDelivery(ref: DocumentReference): Promise<ClaimedDelivery | null> {
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return null;
    const status = snapshot.get('status') as string;
    const now = Timestamp.now();
    if (status === 'pending') {
      const nextAttemptAt = snapshot.get('nextAttemptAt') as Timestamp | undefined;
      if (nextAttemptAt && nextAttemptAt.toMillis() > now.toMillis()) return null;
    } else if (status === 'processing') {
      const leaseUntil = snapshot.get('leaseUntil') as Timestamp | undefined;
      if (leaseUntil && leaseUntil.toMillis() > now.toMillis()) return null;
    } else return null;

    const previousAttempts = (snapshot.get('attempts') as number | undefined) ?? 0;
    if (previousAttempts >= MAX_ATTEMPTS) {
      transaction.update(ref, { status: 'failed', failedAt: FieldValue.serverTimestamp(), leaseUntil: null, lastError: 'retry-limit-reached' });
      return null;
    }
    const attempt = previousAttempts + 1;
    const token = randomUUID();
    transaction.update(ref, {
      status: 'processing', attempts: attempt, claimToken: token,
      leaseUntil: Timestamp.fromMillis(now.toMillis() + LEASE_MS),
    });
    return { messageId: snapshot.get('messageId') as string, chatId: snapshot.get('chatId') as string, attempt, token };
  });
}

async function finishDelivery(ref: DocumentReference, claim: ClaimedDelivery, error?: unknown): Promise<void> {
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.get('claimToken') !== claim.token) return;
    if (error === undefined) {
      transaction.update(ref, { status: 'delivered', deliveredAt: FieldValue.serverTimestamp(), leaseUntil: null, claimToken: FieldValue.delete() });
      return;
    }
    if (claim.attempt >= MAX_ATTEMPTS) {
      transaction.update(ref, { status: 'failed', failedAt: FieldValue.serverTimestamp(), leaseUntil: null, claimToken: FieldValue.delete(), lastError: 'relay-failed' });
      console.error(`Message relay exhausted retries for outbox record ${ref.id}`);
      return;
    }
    const exponential = Math.min(BASE_RETRY_MS * (2 ** (claim.attempt - 1)), MAX_RETRY_MS);
    const delay = exponential + Math.floor(Math.random() * 250);
    transaction.update(ref, {
      status: 'pending', nextAttemptAt: Timestamp.fromMillis(Date.now() + delay),
      leaseUntil: null, claimToken: FieldValue.delete(), lastError: 'relay-failed',
    });
  });
}

async function processOutboxRecord(ref: DocumentReference, relayMessage: RelayMessage): Promise<void> {
  const claim = await claimDelivery(ref);
  if (!claim) return;
  try {
    const messageDoc = await firestore.collection(messageCollection).doc(claim.messageId).get();
    if (!messageDoc.exists) throw new Error('Stored message is missing');
    const timestamp = messageDoc.get('createdAt') as Timestamp;
    const message: Message = {
      id: messageDoc.id,
      chatId: messageDoc.get('chatId') as string,
      senderId: messageDoc.get('senderId') as string,
      text: messageDoc.get('text') as string,
      createdAt: timestamp.toDate().toISOString(),
    };
    await relayMessage(claim.chatId, message);
    await finishDelivery(ref, claim);
  } catch (error) {
    console.error(`Message relay attempt ${claim.attempt} failed for ${ref.id}`);
    await finishDelivery(ref, claim, error);
  }
}

export async function processPendingDeliveries(relayMessage: RelayMessage): Promise<number> {
  const now = Timestamp.now();
  const [pending, expired] = await Promise.all([
    firestore.collection(outboxCollection).where('status', '==', 'pending').where('nextAttemptAt', '<=', now)
      .orderBy('nextAttemptAt', 'asc').limit(BATCH_SIZE).get(),
    firestore.collection(outboxCollection).where('status', '==', 'processing').where('leaseUntil', '<=', now).orderBy('leaseUntil', 'asc').limit(BATCH_SIZE).get(),
  ]);
  const records = new Map<string, DocumentReference>();
  for (const doc of [...pending.docs, ...expired.docs]) records.set(doc.id, doc.ref);
  await Promise.all([...records.values()].map((ref) => processOutboxRecord(ref, relayMessage)));
  return records.size;
}

export async function runWorkerLoop(relayMessage: RelayMessage, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      const processed = await processPendingDeliveries(relayMessage);
      if (processed === 0) await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error('Delivery worker poll failed', error);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
