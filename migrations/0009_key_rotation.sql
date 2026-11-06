-- Append-only rotation receipts retain exact ciphertext for safe retries.
ALTER TABLE cloud_keys ADD COLUMN rotation jsonb;
CREATE TABLE cloud_key_rotations (
  user_id text NOT NULL REFERENCES cloud_accounts(user_id) ON DELETE CASCADE,
  key_id text NOT NULL,
  request jsonb NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key_id)
);
