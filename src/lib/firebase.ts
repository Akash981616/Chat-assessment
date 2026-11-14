import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from '../config.js';

const firebaseOptions = config.FIRESTORE_EMULATOR_HOST
  ? { projectId: config.FIREBASE_PROJECT_ID }
  : { credential: applicationDefault(), projectId: config.FIREBASE_PROJECT_ID };
const app = getApps()[0] ?? initializeApp(firebaseOptions);

export const firestore = getFirestore(app);
export const messageCollection = config.FIRESTORE_MESSAGES_COLLECTION;
export const receiptCollection = config.FIRESTORE_RECEIPTS_COLLECTION;
export const lastSeenCollection = config.FIRESTORE_LAST_SEEN_COLLECTION;
export const outboxCollection = config.FIRESTORE_OUTBOX_COLLECTION;
