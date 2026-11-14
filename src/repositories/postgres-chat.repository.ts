import { randomUUID } from 'node:crypto';
import type { ChatPersistenceAdapter, ChatRow } from '../types/chat.js';
import { db } from '../db.js';

export class PostgresChatAdapter implements ChatPersistenceAdapter {
  async createOrGetDirectChat(userAId: string, userBId: string): Promise<string> {
    const [low, high] = [userAId, userBId].sort();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const users = await client.query('SELECT id FROM users WHERE id = ANY($1::text[])', [[low, high]]);
      if (users.rowCount !== 2) {
        const missing = new Error('One or both users do not exist');
        missing.name = 'UserNotFoundError';
        throw missing;
      }
      const existing = await client.query<{ chat_id: string }>(
        'SELECT chat_id FROM direct_chats WHERE user_low = $1 AND user_high = $2', [low, high]);
      if (existing.rows[0]) { await client.query('COMMIT'); return existing.rows[0].chat_id; }

      const proposedId = randomUUID();
      await client.query('INSERT INTO chats(id) VALUES ($1)', [proposedId]);
      const inserted = await client.query<{ chat_id: string }>(
        `INSERT INTO direct_chats(user_low, user_high, chat_id) VALUES ($1, $2, $3)
         ON CONFLICT (user_low, user_high) DO UPDATE SET user_low = EXCLUDED.user_low
         RETURNING chat_id`, [low, high, proposedId]);
      const chatId = inserted.rows[0]!.chat_id;
      if (chatId === proposedId) {
        await client.query('INSERT INTO chat_members(chat_id, user_id) VALUES ($1, $2), ($1, $3)', [chatId, low, high]);
      } else {
        await client.query('DELETE FROM chats WHERE id = $1', [proposedId]);
      }
      await client.query('COMMIT');
      return chatId;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async isMember(chatId: string, userId: string): Promise<boolean> {
    const result = await db.query('SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId]);
    return result.rowCount !== 0;
  }

  async listChatsForUser(userId: string): Promise<ChatRow[]> {
    const result = await db.query<ChatRow>(
      `SELECT c.id, c.created_at, array_agg(cm2.user_id ORDER BY cm2.user_id) AS member_ids
       FROM chat_members mine JOIN chats c ON c.id = mine.chat_id
       JOIN chat_members cm2 ON cm2.chat_id = c.id WHERE mine.user_id = $1
       GROUP BY c.id, c.created_at ORDER BY c.created_at DESC`, [userId]);
    return result.rows;
  }
}
