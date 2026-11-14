import type { RequestHandler } from 'express';
import { getUserIdFromToken } from '../lib/auth.js';
import { HttpError } from '../lib/http-error.js';

export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.header('authorization');
  const match = header?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) { next(new HttpError(401, 'Authentication required')); return; }
  try {
    req.auth = { userId: getUserIdFromToken(match[1]) };
    next();
  } catch (error) { next(error); }
};
