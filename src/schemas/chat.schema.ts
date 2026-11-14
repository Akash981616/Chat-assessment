import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(128);
const chatIdSchema = z.string().uuid();
const messageIdSchema = z.string().regex(/^[A-Za-z0-9]{20}$/);

export const createChatBodySchema = z.object({ userAId: idSchema, userBId: idSchema });
export const sendMessageParamsSchema = z.object({ chatId: chatIdSchema });
export const sendMessageBodySchema = z.object({ text: z.string().trim().min(1).max(10000) });
export const getMessagesParamsSchema = z.object({ chatId: chatIdSchema });
export const getMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const markMessageReadParamsSchema = z.object({ chatId: chatIdSchema, messageId: messageIdSchema });
export const updateLastSeenParamsSchema = z.object({ chatId: chatIdSchema });
export const updateLastSeenBodySchema = z.object({ messageId: messageIdSchema });
export const listUserChatsParamsSchema = z.object({ userId: idSchema });
