import { createClient } from 'redis';
import { config } from './config.js';
import { MESSAGE_RELAY_CHANNEL } from './lib/redis-relay.js';
import { runWorkerLoop } from './workerLoop.js';

async function main(): Promise<void> {
  const redis = createClient({ url: config.REDIS_URL });
  redis.on('error', (error) => console.error('Delivery worker Redis error', error));
  await redis.connect();
  const stop = new AbortController();
  process.once('SIGINT', () => stop.abort());
  process.once('SIGTERM', () => stop.abort());
  try {
    await runWorkerLoop(async (chatId, message) => {
      const subscribers = await redis.publish(MESSAGE_RELAY_CHANNEL, JSON.stringify({ chatId, message }));
      if (subscribers === 0) throw new Error('No API relay subscribers are connected');
    }, stop.signal);
  } finally { await redis.quit(); }
}

void main().catch((error: unknown) => {
  console.error('Delivery worker startup failed', error);
  process.exit(1);
});
