CREATE TABLE cloud_accounts (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  dataset_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Metadata only. A dataset ID does not enroll a key or enable financial storage.
CREATE TABLE cloud_devices (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES cloud_accounts(user_id) ON DELETE CASCADE,
  installation_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  platform text NOT NULL CHECK (platform IN ('macos', 'windows', 'linux')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (user_id, installation_id),
  UNIQUE (user_id, id)
);
CREATE INDEX cloud_devices_owner_page ON cloud_devices(user_id, id);

-- Retain the binding even after auth session cleanup: a session must never move
-- to another installation. This ID is obtained from provider verification only.
CREATE TABLE cloud_device_sessions (
  session_id text PRIMARY KEY,
  user_id text NOT NULL,
  device_id uuid NOT NULL,
  FOREIGN KEY (user_id, device_id) REFERENCES cloud_devices(user_id, id) ON DELETE CASCADE
);
CREATE INDEX cloud_device_sessions_device ON cloud_device_sessions(user_id, device_id);

CREATE TABLE cloud_api_usage (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  requests integer NOT NULL CHECK (requests > 0)
);
