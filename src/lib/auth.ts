import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { HttpError } from './http-error.js';

export function getUserIdFromToken(token: string): string {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof decoded === 'string' || typeof decoded.sub !== 'string' || decoded.sub.trim().length === 0
      || decoded.sub.length > 128 || typeof decoded.exp !== 'number') {
      throw new HttpError(401, 'Token must include a valid subject and expiry');
    }
    return decoded.sub;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, 'Invalid authentication token');
  }
}
