import { z } from 'zod';
import { messageSchema } from '../schemas/message.schema.js';

export const MESSAGE_RELAY_CHANNEL = 'chat:message:relay';
export const messageRelaySchema = z.object({ chatId: z.string().uuid(), message: messageSchema });
