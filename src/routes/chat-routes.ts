import { Router } from 'express';
import { z } from 'zod';
import { createOrGetChat, getMessages, listUserChats, markMessageRead, sendMessage, updateLastSeen } from '../services/chat-service.js';

export const chatRouter = Router();
const idSchema = z.string().trim().min(1).max(128);
const chatIdSchema = z.string().uuid();

chatRouter.post('/chat/create', async (req, res) => {
  const body = z.object({ userAId: idSchema, userBId: idSchema }).parse(req.body);
  res.status(200).json({ chatId: await createOrGetChat(body.userAId, body.userBId) });
});

chatRouter.post('/chat/:chatId/message/send', async (req, res) => {
  const params = z.object({ chatId: chatIdSchema }).parse(req.params);
  const body = z.object({ senderId: idSchema, text: z.string().trim().min(1).max(10000) }).parse(req.body);
  res.status(201).json({ message: await sendMessage(params.chatId, body.senderId, body.text) });
});

chatRouter.get('/chat/:chatId/messages', async (req, res) => {
  const params = z.object({ chatId: chatIdSchema }).parse(req.params);
  const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), userId: idSchema }).parse(req.query);
  res.json({ messages: await getMessages(params.chatId, query.userId, query.limit) });
});

chatRouter.post('/chat/:chatId/message/:messageId/read', async (req, res) => {
  const params = z.object({ chatId: chatIdSchema, messageId: idSchema }).parse(req.params);
  const body = z.object({ userId: idSchema }).parse(req.body);
  await markMessageRead(params.chatId, params.messageId, body.userId);
  res.status(204).send();
});

chatRouter.post('/chat/:chatId/lastseen', async (req, res) => {
  const params = z.object({ chatId: chatIdSchema }).parse(req.params);
  const body = z.object({ userId: idSchema, messageId: idSchema }).parse(req.body);
  await updateLastSeen(params.chatId, body.messageId, body.userId);
  res.status(204).send();
});

chatRouter.get('/user/:userId/chats', async (req, res) => {
  const params = z.object({ userId: idSchema }).parse(req.params);
  res.json({ chats: await listUserChats(params.userId) });
});
