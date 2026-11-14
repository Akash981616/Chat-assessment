CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chats (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

-- Canonical ordering makes each 1:1 pair unique regardless of request order.
CREATE TABLE IF NOT EXISTS direct_chats (
  user_low text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id uuid NOT NULL UNIQUE REFERENCES chats(id) ON DELETE CASCADE,
  CONSTRAINT direct_chats_pair_order CHECK (user_low < user_high),
  PRIMARY KEY (user_low, user_high)
);

CREATE INDEX IF NOT EXISTS chat_members_user_idx ON chat_members(user_id, chat_id);
