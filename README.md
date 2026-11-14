# Chat Backend

Strictly typed Node.js and Express chat API. PostgreSQL stores users and chat membership, Firestore stores messages and read state, and Redis relays real-time message events across API instances. A Firestore outbox and worker retry event delivery after transient failures.

## Source layout

```text
src/
  constants/       Shared application messages
  controllers/     HTTP route handlers
  lib/             Firebase, JWT, Redis relay, Socket.IO, and HTTP error helpers
  middleware/      Authentication and async error handling
  models/          Domain models
  repositories/    PostgreSQL and Firestore persistence adapters
  schemas/         Zod request and event validation
  services/        Chat business logic
  types/           Shared contracts and Express request types
  app.ts
  config.ts
  db.ts
  server.ts
  worker.ts
  workerLoop.ts
```

## Run the full local stack

Requirements: Docker Desktop with Compose enabled.

```sh
docker compose up --build
```

Compose starts PostgreSQL, Redis, the Firestore Emulator, the HTTP/Socket.IO API, and the message-delivery worker. The API is available at `http://localhost:3000`. PostgreSQL, Redis, and Firestore are kept on the internal Compose network; the API port is bound to localhost. PostgreSQL schema is loaded from `sql/schema.sql` on the first database initialization. Persistent named volumes hold service data; `docker compose down -v` removes that local data.

The Compose stack uses local-only fallback credentials. Before any shared or production deployment, set strong `POSTGRES_PASSWORD` and `JWT_SECRET` values in `.env`. Do not use the local defaults outside development.

To use cloud Firestore instead, remove `FIRESTORE_EMULATOR_HOST`, set `FIREBASE_PROJECT_ID`, and provide Application Default Credentials or mount a service-account file securely. Never commit Firebase credentials.

## Run without Docker

- Node.js 20+
- PostgreSQL 13+ with `sql/schema.sql` applied
- Redis 7+
- A Firebase project with Firestore enabled, or a running Firestore Emulator

Copy `.env.example` to `.env`, configure connection URLs and credentials, then run `npm install`, `npm run build`, `npm start`, and `npm run worker` in separate processes. For development use `npm run dev` and `npm run dev:worker`.

Provision users in PostgreSQL before creating chats. Each user's `id` must match the `sub` claim in the JWT issued by your identity provider. The backend does not issue tokens.

## API

Protected routes require `Authorization: Bearer <JWT>`. Tokens must use HS256, have a non-empty `sub` user ID (up to 128 characters), and include an expiry. `JWT_SECRET` must be at least 32 characters and identical across API and worker deployments. The health endpoint is public.

- `POST /chat/create` — body `{ "userAId": "u1", "userBId": "u2" }`. The authenticated user must be one of the participants. Returns `{ "chatId": "..." }`.
- `POST /chat/:chatId/message/send` — body `{ "text": "Hello" }`. The sender ID is taken from the verified token. Returns the stored message.
- `GET /chat/:chatId/messages?limit=50` — returns messages oldest-to-newest. `limit` is 1–100, default 50. Membership is checked against the authenticated user.
- `POST /chat/:chatId/message/:messageId/read` — marks the authenticated user's receipt as read. No user ID is accepted in the body.
- `POST /chat/:chatId/lastseen` — body `{ "messageId": "..." }`. Updates the authenticated user's last-seen pointer.
- `GET /user/:userId/chats` — the path user ID must match the authenticated user.

## Real-time events and retries

Connect to Socket.IO with WebSocket transport and pass the JWT as `auth: { token }`. Emit `chat:join` with `{ "chatId": "..." }`; the server checks membership before joining the room. Emit `chat:leave` to leave, and listen for `chat:message`.

Message creation writes the message and its pending delivery record in one Firestore batch. `worker.ts` claims outbox records with a lease, publishes to Redis, and marks them delivered. On transient failures it retries with exponential backoff and jitter, up to eight attempts. Expired leases are reclaimed after worker crashes. After the retry limit, the record is marked `failed` in `messageDeliveryOutbox` for operator review. Run at least one worker process; workers can be scaled horizontally.

Relay publication is retried and may happen more than once if a worker crashes after publishing but before marking the outbox record delivered. Use `message.id` to de-duplicate client-side. A successful Redis publish does not confirm that every device received the event. Redis Pub/Sub is transient; Firestore message history remains the source of truth, so clients should fetch history after reconnecting.

Deploy Firestore composite indexes from `firestore.indexes.json` for message history and outbox polling.

## Security notes

- HTTP and Socket.IO connections now authenticate with expiring JWTs. Routes derive the acting user from the verified token instead of trusting `senderId` or `userId` request fields. Creating a direct chat is restricted to requests where the authenticated user is one participant.
- Use HTTPS/WSS in deployments. Keep JWTs out of URLs and logs. The HS256 signing secret is shared across all API instances; protect and rotate it. A public-key JWT flow may be preferable when multiple independent services verify tokens.
- Set `ALLOWED_ORIGINS` to a comma-separated allowlist for browser Socket.IO clients. With an empty allowlist, browser-origin connections are denied; native clients without an `Origin` header are accepted and still require JWT authentication.
- The Firebase Admin SDK uses privileged service credentials and bypasses Firestore Security Rules. Restrict its IAM role to the minimum required Firestore access and never place service-account JSON in the image or repository.
- Keep PostgreSQL and Redis private to the service network. Configure Redis authentication/TLS and managed database encryption in shared environments. The Compose ports are intentionally not published for these services.
- The sample does not implement rate limiting, account provisioning, JWT issuance/rotation, or audit logging. Add these at the deployment boundary before exposing the API publicly.
- Firestore emulator data and the sample passwords/secrets are for local development only.
