import type { ChatRow } from '../types/chat.js';
import type { Message } from '../models/message.js';
import { FirestoreMessageAdapter } from '../repositories/firestore-message.repository.js';
import { PostgresChatAdapter } from '../repositories/postgres-chat.repository.js';
import { HttpError } from '../lib/http-error.js';
import { CHAT_ERROR_MESSAGES } from '../constants/chat-messages.js';

const chats = new PostgresChatAdapter();
const messages = new FirestoreMessageAdapter();

async function requireMember(chatId: string, userId: string): Promise<void> {
  if (!(await chats.isMember(chatId, userId))) throw new HttpError(403, 'User is not a member of this chat');
}

export async function createOrGetChat(userAId: string, userBId: string): Promise<string> {
  if (userAId === userBId) throw new HttpError(400, CHAT_ERROR_MESSAGES.requireTwoDifferentUsers);
  try { return await chats.createOrGetDirectChat(userAId, userBId); }
  catch (error) {
    if (error instanceof Error && error.name === 'UserNotFoundError') throw new HttpError(404, error.message);
    throw error;
  }
}

export async function sendMessage(chatId: string, senderId: string, text: string): Promise<Message> {
  await requireMember(chatId, senderId);
  return messages.createMessage(chatId, senderId, text);
}

export async function getMessages(chatId: string, userId: string, limit: number): Promise<Message[]> {
  await requireMember(chatId, userId);
  return messages.readMessages(chatId, limit);
}

export async function markMessageRead(chatId: string, messageId: string, userId: string): Promise<void> {
  await requireMember(chatId, userId);
  if (!(await messages.markMessageRead(chatId, messageId, userId))) throw new HttpError(404, 'Message not found in this chat');
}

export async function updateLastSeen(chatId: string, messageId: string, userId: string): Promise<void> {
  await requireMember(chatId, userId);
  const result = await messages.updateLastSeen(chatId, messageId, userId);
  if (result === 'missing') throw new HttpError(404, 'Message not found in this chat');
  if (result === 'backwards') throw new HttpError(400, 'Last seen cannot move backwards');
}

export async function listUserChats(userId: string): Promise<ChatRow[]> {
  return chats.listChatsForUser(userId);
}
