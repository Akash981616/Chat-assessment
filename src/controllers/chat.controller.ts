import { Router } from 'express';
import { CHAT_ERROR_MESSAGES } from '../constants/chat-messages.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { HttpError } from '../lib/http-error.js';
import { createOrGetChat, getMessages, listUserChats, markMessageRead, sendMessage, updateLastSeen } from '../services/chat-service.js';
import {
  createChatBodySchema,
  getMessagesParamsSchema,
  getMessagesQuerySchema,
  listUserChatsParamsSchema,
  markMessageReadParamsSchema,
  sendMessageBodySchema,
  sendMessageParamsSchema,
  updateLastSeenBodySchema,
  updateLastSeenParamsSchema,
} from '../schemas/chat.schema.js';

export const chatRouter = Router();

function authenticatedUserId(req: Express.Request): string {
  if (!req.auth?.userId) throw new HttpError(401, 'Authentication required');
  return req.auth.userId;
}

chatRouter.post('/chat/create', asyncHandler(async (req, res) => {
  const body = createChatBodySchema.parse(req.body);
  const userId = authenticatedUserId(req);
  if (body.userAId !== userId && body.userBId !== userId) throw new HttpError(403, 'You can only create a chat that includes your account');
  res.status(200).json({ chatId: await createOrGetChat(body.userAId, body.userBId) });
}));

chatRouter.post('/chat/:chatId/message/send', asyncHandler(async (req, res) => {
  const params = sendMessageParamsSchema.parse(req.params);
  const body = sendMessageBodySchema.parse(req.body);
  const message = await sendMessage(params.chatId, authenticatedUserId(req), body.text);
  res.status(201).json({ message });
}));

chatRouter.get('/chat/:chatId/messages', asyncHandler(async (req, res) => {
  const params = getMessagesParamsSchema.parse(req.params);
  const query = getMessagesQuerySchema.parse(req.query);
  res.json({ messages: await getMessages(params.chatId, authenticatedUserId(req), query.limit) });
}));

chatRouter.post('/chat/:chatId/message/:messageId/read', asyncHandler(async (req, res) => {
  const params = markMessageReadParamsSchema.parse(req.params);
  await markMessageRead(params.chatId, params.messageId, authenticatedUserId(req));
  res.status(204).send();
}));

chatRouter.post('/chat/:chatId/lastseen', asyncHandler(async (req, res) => {
  const params = updateLastSeenParamsSchema.parse(req.params);
  const body = updateLastSeenBodySchema.parse(req.body);
  await updateLastSeen(params.chatId, body.messageId, authenticatedUserId(req));
  res.status(204).send();
}));

chatRouter.get('/user/:userId/chats', asyncHandler(async (req, res) => {
  const params = listUserChatsParamsSchema.parse(req.params);
  const userId = authenticatedUserId(req);
  if (params.userId !== userId) throw new HttpError(403, CHAT_ERROR_MESSAGES.listOnlyOwnChats);
  res.json({ chats: await listUserChats(userId) });
}));
