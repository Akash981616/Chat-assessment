import type { ChatRow, Message } from '../persistence/contracts.js';
import { FirestoreMessageAdapter } from '../persistence/firestore-message-adapter.js';
import { PostgresChatAdapter } from '../persistence/postgres-chat-adapter.js';
import { HttpError } from '../errors.js';
import { emitChatMessage } from '../realtime/publisher.js';

const chats = new PostgresChatAdapter();
const messages = new FirestoreMessageAdapter();

async function requireMember(chatId: string, userId: string): Promise<void> {
  if (!(await chats.isMember(chatId, userId))) throw new HttpError(403, 'User is not a member of this chat');
}

export async function createOrGetChat(userAId: string, userBId: string): Promise<string> {
  if (userAId === userBId) throw new HttpError(400, 'A direct chat requires two different users');
  try { return await chats.createOrGetDirectChat(userAId, userBId); }
  catch (error) {
    if (error instanceof Error && error.name === 'UserNotFoundError') throw new HttpError(404, error.message);
    throw error;
  }
}

export async function sendMessage(chatId: string, senderId: string, text: string): Promise<Message> {
  await requireMember(chatId, senderId);
  const message = await messages.createMessage(chatId, senderId, text);
  emitChatMessage(chatId, message);
  return message;
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
