import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { Server } from 'socket.io';
import { z } from 'zod';
import { config } from '../config.js';
import { PostgresChatAdapter } from '../repositories/postgres-chat.repository.js';
import type { Message } from '../models/message.js';
import { getUserIdFromToken } from './auth.js';
import { MESSAGE_RELAY_CHANNEL, messageRelaySchema } from './redis-relay.js';

const chatIdSchema = z.string().uuid();
const chats = new PostgresChatAdapter();

interface ClientToServerEvents {
  'chat:join': (payload: unknown, acknowledge?: (result: { ok: boolean; error?: string }) => void) => void;
  'chat:leave': (payload: unknown, acknowledge?: (result: { ok: boolean; error?: string }) => void) => void;
}
interface ServerToClientEvents {
  'chat:message': (message: Message) => void;
}
type InterServerEvents = Record<never, never>;
interface SocketData { userId: string }

export async function createSocketServer(httpServer: HttpServer) {
  const publisher = createClient({ url: config.REDIS_URL });
  const subscriber = publisher.duplicate();
  const relaySubscriber = publisher.duplicate();
  publisher.on('error', (error) => console.error('Redis publisher error', error));
  subscriber.on('error', (error) => console.error('Redis subscriber error', error));
  relaySubscriber.on('error', (error) => console.error('Redis message relay error', error));
  await Promise.all([publisher.connect(), subscriber.connect(), relaySubscriber.connect()]);

  const allowedOrigins = config.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
    adapter: createAdapter(publisher, subscriber),
    transports: ['websocket'],
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      if (!origin || allowedOrigins.includes(origin)) callback(null, true);
      else callback('Origin is not allowed', false);
    },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (typeof token !== 'string') { next(new Error('Authentication token required')); return; }
    try {
      socket.data.userId = getUserIdFromToken(token);
      next();
    } catch {
      next(new Error('Invalid authentication token'));
    }
  });

  await relaySubscriber.subscribe(MESSAGE_RELAY_CHANNEL, (payload) => {
    let decoded: unknown;
    try { decoded = JSON.parse(payload) as unknown; }
    catch { console.error('Discarding malformed chat relay event'); return; }
    const parsed = messageRelaySchema.safeParse(decoded);
    if (!parsed.success) { console.error('Discarding malformed chat relay event'); return; }
    io.local.to(`chat:${parsed.data.chatId}`).emit('chat:message', parsed.data.message);
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
      void Promise.resolve(socket.leave(`chat:${parsed.data.chatId}`)).then(() => acknowledge?.({ ok: true }));
    });
  });

  return {
    io,
    async close(): Promise<void> {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await Promise.all([publisher.quit(), subscriber.quit(), relaySubscriber.quit()]);
    },
  };
}
