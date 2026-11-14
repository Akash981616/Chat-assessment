import { Router } from 'express';
import { createOrGetChat, getMessages, listUserChats, markMessageRead, sendMessage, updateLastSeen } from '../services/chat-service.js';
import {
  createChatBodySchema,
  getMessagesParamsSchema,
  getMessagesQuerySchema,
  listUserChatsParamsSchema,
  markMessageReadBodySchema,
  markMessageReadParamsSchema,
  sendMessageBodySchema,
  sendMessageParamsSchema,
  updateLastSeenBodySchema,
  updateLastSeenParamsSchema,
} from '../validation.js';

export const chatRouter = Router();

chatRouter.post('/chat/create', async (req, res) => {
  const body = createChatBodySchema.parse(req.body);
  res.status(200).json({ chatId: await createOrGetChat(body.userAId, body.userBId) });
});

chatRouter.post('/chat/:chatId/message/send', async (req, res) => {
  const params = sendMessageParamsSchema.parse(req.params);
  const body = sendMessageBodySchema.parse(req.body);
  res.status(201).json({ message: await sendMessage(params.chatId, body.senderId, body.text) });
});

chatRouter.get('/chat/:chatId/messages', async (req, res) => {
  const params = getMessagesParamsSchema.parse(req.params);
  const query = getMessagesQuerySchema.parse(req.query);
  res.json({ messages: await getMessages(params.chatId, query.userId, query.limit) });
});

chatRouter.post('/chat/:chatId/message/:messageId/read', async (req, res) => {
  const params = markMessageReadParamsSchema.parse(req.params);
  const body = markMessageReadBodySchema.parse(req.body);
  await markMessageRead(params.chatId, params.messageId, body.userId);
  res.status(204).send();
});

chatRouter.post('/chat/:chatId/lastseen', async (req, res) => {
  const params = updateLastSeenParamsSchema.parse(req.params);
  const body = updateLastSeenBodySchema.parse(req.body);
  await updateLastSeen(params.chatId, body.messageId, body.userId);
  res.status(204).send();
});

chatRouter.get('/user/:userId/chats', async (req, res) => {
  const params = listUserChatsParamsSchema.parse(req.params);
  res.json({ chats: await listUserChats(params.userId) });
});
