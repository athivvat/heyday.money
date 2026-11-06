-- Complete financial metadata and linked ledger operations require protocol 5.
ALTER TABLE cloud_sync_state DROP CONSTRAINT cloud_sync_state_protocol_check;
ALTER TABLE cloud_sync_state ADD CONSTRAINT cloud_sync_state_protocol_check CHECK(protocol IN (1,2,3,4,5));
