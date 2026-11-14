import { z } from 'zod';

export const messageSchema = z.object({
  id: z.string().min(1),
  chatId: z.string().uuid(),
  senderId: z.string().min(1),
  text: z.string(),
  createdAt: z.string().datetime(),
});
