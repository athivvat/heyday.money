ALTER TABLE cloud_accounts ADD CONSTRAINT cloud_accounts_owner_dataset UNIQUE (user_id, dataset_id);

-- Immutable first key package. Rotation/reset is intentionally not exposed until
-- versioned recovery and record re-encryption protocols exist.
CREATE TABLE cloud_keys (
  user_id text PRIMARY KEY,
  dataset_id uuid NOT NULL UNIQUE,
  envelope jsonb NOT NULL CHECK (jsonb_typeof(envelope) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, dataset_id) REFERENCES cloud_accounts(user_id, dataset_id) ON DELETE CASCADE
);
