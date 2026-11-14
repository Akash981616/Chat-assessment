# Chat Backend

Typed Node.js/Express API for 1:1 chats. PostgreSQL stores users and chat membership; Firestore stores messages, per-message read receipts, and per-user last-seen pointers. Socket.IO delivers new messages in real time, and Redis relays room broadcasts between backend instances.

Persistence is isolated behind `ChatPersistenceAdapter` and `MessagePersistenceAdapter` in `src/persistence/contracts.ts`. `PostgresChatAdapter` and `FirestoreMessageAdapter` provide the configured database implementations; `src/services/chat-service.ts` coordinates membership checks and API-level behavior without embedding SQL or Firestore queries.

## Requirements

- Node.js 20+
- PostgreSQL 13+
- Redis 7+
- A Firebase project with Firestore enabled and service account credentials available to the server
- An authentication service that issues JWTs with the user's ID in the `sub` claim

## Setup

1. Create a PostgreSQL database and run `sql/schema.sql` against it. Provision users in the `users` table before creating chats.
2. Start Redis locally with `docker compose up -d redis`, or provide another Redis URL.
3. Copy `.env.example` to `.env`, set `DATABASE_URL`, `REDIS_URL`, a unique random `JWT_SECRET` of at least 32 characters, and `FIREBASE_PROJECT_ID`. Configure Firebase Application Default Credentials (locally, set `GOOGLE_APPLICATION_CREDENTIALS` to your service-account JSON path).
4. Run `npm install`, `npm run build`, and `npm start`. For development, use `npm run dev`.

Never commit Firebase credentials. Firestore composite index setup may be requested by Firebase for the chatId + createdAt query; follow the index link in the Firebase error output.

## API

All IDs are strings. Chat IDs are UUIDs. The API validates input and checks chat membership using the supplied user ID. The WebSocket connection requires a JWT, verified using `JWT_SECRET`; its `sub` claim identifies the user. The existing HTTP API still accepts user IDs in request data, so production deployments should also authenticate those routes and derive identity from the verified token.

### Create or get a direct chat

`POST /chat/create` with `{ "userAId": "u1", "userBId": "u2" }` returns `{ "chatId": "..." }`. Repeated and concurrent requests for a pair return one chat.

### Send a message

`POST /chat/:chatId/message/send` with `{ "senderId": "u1", "text": "Hello" }` returns a message object with its Firestore timestamp as `createdAt`.

### Get messages

`GET /chat/:chatId/messages?userId=u1&limit=50` returns messages oldest-to-newest. `limit` is 1–100 (default 50). The userId query parameter is required for membership checks.

### Mark a message read

`POST /chat/:chatId/message/:messageId/read` with `{ "userId": "u2" }` writes/updates a receipt keyed by message and user in the `messageReceipts` collection.

### Update last seen

`POST /chat/:chatId/lastseen` with `{ "userId": "u1", "messageId": "..." }` stores the latest seen message pointer in `chatLastSeen/{chatId}_{userId}` and rejects attempts to move the pointer backwards.

### List chats

`GET /user/:userId/chats` returns relational chat IDs, creation timestamps, and member IDs.

## Firestore shape

- `messages/{messageId}`: `{ id, chatId, senderId, text, createdAt }`
- `messageReceipts/{messageId_userId}`: `{ chatId, messageId, userId, readAt }`
- `chatLastSeen/{chatId_userId}`: `{ chatId, userId, messageId, updatedAt }`

Read receipts are idempotent; last-seen pointers only move forward by message timestamp.

## Real-time events

Connect with Socket.IO using WebSocket transport and pass the JWT as `auth: { token }`. The token must have the authenticated user's ID in `sub`.

- Emit `chat:join` with `{ "chatId": "..." }` to join a chat room. The server checks PostgreSQL membership and acknowledges `{ "ok": true }` or an error.
- Emit `chat:leave` with `{ "chatId": "..." }` to leave a room.
- Listen for `chat:message`. A successful `POST /chat/:chatId/message/send` persists the message in Firestore, then emits it to the chat room. Redis Socket.IO adapter relays this event to every app instance, where that instance delivers it to its connected clients.

Each backend instance must use the same Redis deployment, PostgreSQL database, Firebase project, and JWT signing secret. The Socket.IO server is configured for WebSocket transport, so the load balancer does not need polling-session stickiness. Clients should fetch message history after reconnecting; Redis Pub/Sub is a live relay and is not a durable message queue.
