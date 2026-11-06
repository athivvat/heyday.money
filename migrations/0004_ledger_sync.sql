-- Once a dataset contains ledger records, category-only clients must upgrade.
ALTER TABLE cloud_sync_state ADD COLUMN protocol smallint NOT NULL DEFAULT 1 CHECK(protocol IN (1,2));
