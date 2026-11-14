import type { Message } from '../models/message.js';

export interface ChatRow { id: string; created_at: Date; member_ids: string[] }

export interface ChatPersistenceAdapter {
  createOrGetDirectChat(userAId: string, userBId: string): Promise<string>;
  isMember(chatId: string, userId: string): Promise<boolean>;
  listChatsForUser(userId: string): Promise<ChatRow[]>;
}

export interface MessagePersistenceAdapter {
  createMessage(chatId: string, senderId: string, text: string): Promise<Message>;
  readMessages(chatId: string, limit: number): Promise<Message[]>;
  markMessageRead(chatId: string, messageId: string, userId: string): Promise<boolean>;
  updateLastSeen(chatId: string, messageId: string, userId: string): Promise<'updated' | 'missing' | 'backwards'>;
}
