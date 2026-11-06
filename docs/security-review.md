# Independent encryption review brief

Status: **not independently reviewed; production security sign-off remains open**.
Implementation and automated tests are not independent assurance. No external
reviewer has been contacted or granted access as part of this work.

Review [key-rotation.md](key-rotation.md), [e2ee.md](e2ee.md), and
[sync-api.md](sync-api.md), together with the source paths below. A reviewer must
record the exact app and service commit IDs being reviewed; the current workspace
contains uncommitted implementation work and is not an immutable audit target.

## Assets and trust boundaries

- Financial plaintext: local native memory, SQLite and intentionally exported
  backups. Local financial backups are not encrypted by cloud E2EE.
- Dataset/recovery roots: native memory and OS credential storage; recovery text
  intentionally crosses IPC for user display/input. No support key or server escrow.
- Server: untrusted for ciphertext integrity/freshness, but trusted for account
  access, rate limiting, entitlement and availability. It sees email, devices,
  opaque record IDs, sizes, timing and history structure.
- Other key-holding devices: can create valid financial changes. Revocation and
  rotation cannot erase their previously obtained data. A symmetric shared root
  does not provide per-device nonrepudiation or protection from a malicious
  currently authorized key holder.
- Independent history proof: a user-transferred checkpoint from a trusted device.
  It is a minimum-prefix check, not continuous consensus, a transparency witness,
  or a guarantee of global freshness. Explicit unverified recovery retains that
  limitation visibly and cryptographically in subsequently exported codes.

## Review targets

Desktop (self-contained `app` repository):

- `src-tauri/src/cloud_crypto.rs`: recovery wrapping and key parsing.
- `src-tauri/src/cloud_key_protocol.rs`: archive, epoch boundaries, stable IDs,
  transition MAC, package fingerprints and history verification codes.
- `src-tauri/src/cloud_e2ee.rs`: credential-store pins, pending rotation durability,
  acknowledgment, cancellation, recovery policy and key erasure.
- `src-tauri/src/cloud_sync.rs`: prefix staging, pagination, rollback/fork checks,
  accepted/rejected pending requests and SQLite/keychain crash ordering.
- `src-tauri/src/cloud_sync_protocol.rs` and `cloud_sync_store.rs`: per-mutation
  AEAD/MAC, exact integer versions, local merge/conflict validation and consent.
- `CloudEncryption.tsx`, `CloudSyncProvider.tsx`, native command registration:
  untrusted IPC arguments, visible warnings, transient secrets and upload consent.
- Existing native authentication/session/device enrollment and backup boundaries.

Service (`site` repository): contracts, device/sync handlers and services,
`0009_key_rotation.sql`, existing account transaction locks and auth verification.
Review exact-field validation, byte limits, key-ID reuse, concurrent old/new writes,
replayed rotations, expiry/revocation races, cross-account access and transaction
rollback. The server cannot validate the transition MAC; account takeover can
replace a package with invalid material and cause denial of service. Determine
whether a separately authenticated management key is needed before production.

## Required adversarial exercises

- Compromise an old root/recovery key and retain every old wrapper: show that it
  cannot decrypt new mutations, and document all old data/metadata still exposed.
- Change archive keys, ordering, boundaries, owner, key ID, nonce, salt, proof,
  history-code warning and pin; no altered input may silently become trusted.
- Fork a paginated history just before a trusted checkpoint, truncate it, replay
  another account's cursor, equivocate between pages, and return an old package.
  Confirm no unverified downloaded financial rows reach SQLite.
- Crash before/after public request persistence, native key persistence, server
  commit, acknowledgment, pin advancement and SQLite commit. Retry must preserve
  exact ciphertext and user edits without generating a replacement key silently.
- Rotate concurrently from two devices, revoke a rotating device, expire a trial,
  restore an old financial backup and sign out during an outstanding UI request.
- Verify explicit unverified recovery cannot erase a previously saved checkpoint,
  and that restoring/locking/rotating/signing out cannot remove its warning.
- Test real installed macOS and Windows credential stores, including payload
  bounds, denied access, lost keys, restart and retained-key preferences.
- Exercise history-size limits and service rollback/deployment procedures. Audit
  logging and error messages for tokens, recovery text, roots and plaintext.

## Reproducible automated entry points

In `app`: `cargo test --locked --offline --manifest-path src-tauri/Cargo.toml cloud_ -- --test-threads=1`,
`bun run build`, and `bun run test:e2e tests/cloud-*.spec.ts tests/language.spec.ts`.
Browser tests mock native IPC and do not test real Keychain/Windows credentials.
Native HTTP tests use local loopback fixtures, not production accounts.

In `site`: `bun run typecheck`, `bun run build`, `bun run test:api`, and
`TEST_DATABASE_URL=<isolated test connection> bun run test:postgres`. PostgreSQL
suites create/drop random schemas; use a dedicated test service. Public vectors:
`tests/fixtures/key-rotation-v1.json` in each repository, plus existing record
protocol vectors. Never substitute real keys into fixtures or test logs.

An acceptable review report identifies scope/commits, reviewer independence,
threat assumptions, reproducible findings and severity, remediation verification,
remaining limitations, and an explicit release recommendation. Keep this item open
until that report and required packaged-device evidence exist.
