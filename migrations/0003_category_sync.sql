-- Server-only grants until Stripe entitlement reconciliation is implemented.
CREATE TABLE cloud_sync_entitlements (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  access_until timestamptz NOT NULL,
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cloud_sync_state (
  user_id text PRIMARY KEY,
  dataset_id uuid NOT NULL UNIQUE,
  sequence bigint NOT NULL DEFAULT 0 CHECK(sequence >= 0),
  hash text NOT NULL DEFAULT repeat('0', 64) CHECK(hash ~ '^[0-9a-f]{64}$'),
  FOREIGN KEY(user_id, dataset_id) REFERENCES cloud_accounts(user_id, dataset_id) ON DELETE CASCADE
);

-- Immutable history also serves as durable retry receipts. No pruning in v1.
CREATE TABLE cloud_sync_changes (
  dataset_id uuid NOT NULL REFERENCES cloud_sync_state(dataset_id) ON DELETE CASCADE,
  sequence bigint NOT NULL CHECK(sequence > 0),
  mutation_id text NOT NULL,
  record_id text NOT NULL,
  version bigint NOT NULL CHECK(version > 0),
  hash text NOT NULL CHECK(hash ~ '^[0-9a-f]{64}$'),
  request jsonb NOT NULL CHECK(jsonb_typeof(request) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(dataset_id, sequence),
  UNIQUE(dataset_id, mutation_id)
);

CREATE TABLE cloud_sync_records (
  dataset_id uuid NOT NULL REFERENCES cloud_sync_state(dataset_id) ON DELETE CASCADE,
  record_id text NOT NULL,
  version bigint NOT NULL CHECK(version > 0),
  sequence bigint NOT NULL,
  PRIMARY KEY(dataset_id, record_id),
  FOREIGN KEY(dataset_id, sequence) REFERENCES cloud_sync_changes(dataset_id, sequence)
);
