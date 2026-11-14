import express, { type ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError } from './errors.js';
import { chatRouter } from './routes/chat-routes.js';

export const app = express();
app.use(express.json({ limit: '32kb' }));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use(chatRouter);

const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof ZodError) { res.status(400).json({ error: 'Invalid request', details: error.flatten() }); return; }
  if (error instanceof HttpError) { res.status(error.status).json({ error: error.message }); return; }
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
};
app.use(errorHandler);
