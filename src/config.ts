import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  ALLOWED_ORIGINS: z.string().default(''),
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIRESTORE_MESSAGES_COLLECTION: z.string().default('messages'),
  FIRESTORE_RECEIPTS_COLLECTION: z.string().default('messageReceipts'),
  FIRESTORE_LAST_SEEN_COLLECTION: z.string().default('chatLastSeen'),
  FIRESTORE_OUTBOX_COLLECTION: z.string().default('messageDeliveryOutbox'),
  FIRESTORE_EMULATOR_HOST: z.string().optional(),
});

export const config = envSchema.parse(process.env);
