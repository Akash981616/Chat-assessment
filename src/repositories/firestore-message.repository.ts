import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { MessagePersistenceAdapter } from '../types/chat.js';
import type { Message } from '../models/message.js';
import { firestore, lastSeenCollection, messageCollection, outboxCollection, receiptCollection } from '../lib/firebase.js';

export class FirestoreMessageAdapter implements MessagePersistenceAdapter {
  async createMessage(chatId: string, senderId: string, text: string): Promise<Message> {
    const ref = firestore.collection(messageCollection).doc();
    const createdAt = Timestamp.now();
    const message: Message = { id: ref.id, chatId, senderId, text, createdAt: createdAt.toDate().toISOString() };
    const batch = firestore.batch();
    batch.create(ref, { ...message, createdAt });
    batch.create(firestore.collection(outboxCollection).doc(ref.id), {
      messageId: ref.id,
      chatId,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: createdAt,
      leaseUntil: null,
      createdAt,
    });
    await batch.commit();
    return message;
  }

  async readMessages(chatId: string, limit: number): Promise<Message[]> {
    const snapshot = await firestore.collection(messageCollection).where('chatId', '==', chatId)
      .orderBy('createdAt', 'desc').orderBy('__name__', 'desc').limit(limit).get();
    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return { id: doc.id, chatId: data.chatId as string, senderId: data.senderId as string, text: data.text as string,
        createdAt: (data.createdAt as Timestamp).toDate().toISOString() };
    }).reverse();
  }

  async markMessageRead(chatId: string, messageId: string, userId: string): Promise<boolean> {
    const message = await firestore.collection(messageCollection).doc(messageId).get();
    if (!message.exists || message.get('chatId') !== chatId) return false;
    await firestore.collection(receiptCollection).doc(`${messageId}_${userId}`).set({
      chatId, messageId, userId, readAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  }

  async updateLastSeen(chatId: string, messageId: string, userId: string): Promise<'updated' | 'missing' | 'backwards'> {
    const messageRef = firestore.collection(messageCollection).doc(messageId);
    const message = await messageRef.get();
    if (!message.exists || message.get('chatId') !== chatId) return 'missing';
    const ref = firestore.collection(lastSeenCollection).doc(`${chatId}_${userId}`);
    return firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      const currentId = current.get('messageId') as string | undefined;
      if (currentId) {
        const currentMessage = await transaction.get(firestore.collection(messageCollection).doc(currentId));
        const currentAt = currentMessage.get('createdAt') as Timestamp | undefined;
        const nextAt = message.get('createdAt') as Timestamp;
        if (currentAt && currentAt.toMillis() > nextAt.toMillis()) return 'backwards';
      }
      transaction.set(ref, { chatId, userId, messageId, updatedAt: FieldValue.serverTimestamp() });
      return 'updated';
    });
  }
}
