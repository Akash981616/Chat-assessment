import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config.js';
import { PostgresChatAdapter } from '../persistence/postgres-chat-adapter.js';
import type { Message } from '../persistence/contracts.js';
import { registerMessagePublisher } from './publisher.js';

const chatIdSchema = z.string().uuid();
const chats = new PostgresChatAdapter();

interface ClientToServerEvents {
  'chat:join': (payload: unknown, acknowledge?: (result: { ok: boolean; error?: string }) => void) => void;
  'chat:leave': (payload: unknown, acknowledge?: (result: { ok: boolean; error?: string }) => void) => void;
}
interface ServerToClientEvents {
  'chat:message': (message: Message) => void;
}
interface InterServerEvents {}
interface SocketData { userId: string }

export async function createSocketServer(httpServer: HttpServer) {
  const publisher = createClient({ url: config.REDIS_URL });
  const subscriber = publisher.duplicate();
  publisher.on('error', (error) => console.error('Redis publisher error', error));
  subscriber.on('error', (error) => console.error('Redis subscriber error', error));
  await Promise.all([publisher.connect(), subscriber.connect()]);

  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
    adapter: createAdapter(publisher, subscriber),
    transports: ['websocket'],
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (typeof token !== 'string') { next(new Error('Authentication token required')); return; }
    try {
      const decoded = jwt.verify(token, config.JWT_SECRET);
      if (typeof decoded === 'string' || typeof decoded.sub !== 'string' || decoded.sub.length === 0) {
        next(new Error('Token must include a user subject'));
        return;
      }
      socket.data.userId = decoded.sub;
      next();
    } catch {
      next(new Error('Invalid authentication token'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('chat:join', (payload, acknowledge) => {
      void (async () => {
        const parsed = z.object({ chatId: chatIdSchema }).safeParse(payload);
        if (!parsed.success) { acknowledge?.({ ok: false, error: 'Invalid chatId' }); return; }
        if (!(await chats.isMember(parsed.data.chatId, socket.data.userId))) {
          acknowledge?.({ ok: false, error: 'User is not a member of this chat' });
          return;
        }
        await socket.join(`chat:${parsed.data.chatId}`);
        acknowledge?.({ ok: true });
      })().catch((error: unknown) => {
        console.error('Unable to join chat room', error);
        acknowledge?.({ ok: false, error: 'Unable to join chat' });
      });
    });

    socket.on('chat:leave', (payload, acknowledge) => {
      const parsed = z.object({ chatId: chatIdSchema }).safeParse(payload);
      if (!parsed.success) { acknowledge?.({ ok: false, error: 'Invalid chatId' }); return; }
      void socket.leave(`chat:${parsed.data.chatId}`).then(() => acknowledge?.({ ok: true }));
    });
  });

  registerMessagePublisher((chatId, message) => {
    io.to(`chat:${chatId}`).emit('chat:message', message);
  });

  return {
    io,
    async close(): Promise<void> {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await Promise.all([publisher.quit(), subscriber.quit()]);
    },
  };
}
