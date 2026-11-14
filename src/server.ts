import { app } from './app.js';
import { config } from './config.js';
import { db } from './db.js';
import { createServer } from 'node:http';
import { createSocketServer } from './lib/socket-server.js';

const server = createServer(app);

async function main(): Promise<void> {
  const realtime = await createSocketServer(server);
  server.listen(config.PORT, () => console.log(`Chat API listening on port ${config.PORT}`));

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void realtime.close().then(() => db.end()).then(() => process.exit(0)).catch((error: unknown) => {
      console.error('Graceful shutdown failed', error);
      process.exit(1);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main().catch((error: unknown) => {
  console.error('Application startup failed', error);
  process.exit(1);
});
