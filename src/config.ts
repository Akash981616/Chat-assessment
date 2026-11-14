import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIRESTORE_MESSAGES_COLLECTION: z.string().default('messages'),
  FIRESTORE_RECEIPTS_COLLECTION: z.string().default('messageReceipts'),
  FIRESTORE_LAST_SEEN_COLLECTION: z.string().default('chatLastSeen'),
});

export const config = envSchema.parse(process.env);
