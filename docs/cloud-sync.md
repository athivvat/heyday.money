# Cloud sync implementation status

This is an implementation companion to `PLAN.md`, not a released desktop API.
Better Auth routes exist at `/api/auth/*`; they require configured environment
variables and migrated PostgreSQL tables. Account metadata and session-bound
device registration/listing/revocation exist under `/api/v1`; see
[account API contracts](account-api.md). Encrypted-key setup/recovery APIs and the
native key lifecycle are implemented; see [E2EE protocol](e2ee.md). All current
financial entities now sync in the beta, including remaining planning data,
loans/statements, reconciliation history, editable catalogs and custom logos.
[sync-api.md](sync-api.md) defines protocol 5, aggregate validation and fresh consent.
Billing and production security/packaged-device verification remain unfinished.
The record-v1 design below is historical, not the active wire format.

## Confirmed decisions

Cloud records require end-to-end encryption (confirmed during implementation).
The server must never receive plaintext financial records or unwrapped dataset
keys. Account authentication and possession of a dataset key are separate things.
An authenticated session alone must not unlock encrypted data.

Beta sign-in supports email with a one-time code only. Google and Apple are
deferred and disabled even when legacy credentials exist. TanStack Start remains the API framework.
Billing uses Stripe; hosting uses Railway; the database uses PostgreSQL with
connection configuration supplied through environment variables.
Email sign-in codes are delivered through Resend.

Selected authentication: Better Auth hosted with the
TanStack Start application. It has documented TanStack Start, PostgreSQL, Google,
Apple and email OTP integrations. Native desktop login uses its OAuth
provider plugin with a registered public client, browser authorization, S256
PKCE and refresh tokens. This changes the original managed-auth assumption to
self-hosted authentication: we own upgrades, operation and email delivery.
Resend is selected for email delivery; the local sender is configured as
`Heyday Money <account@heyday.money>`. Production configuration and delivery
verification remain deployment tasks.
Provider documentation:
[TanStack Start](https://better-auth.com/docs/integrations/tanstack),
[email OTP](https://better-auth.com/docs/plugins/email-otp),
[OAuth provider](https://better-auth.com/docs/plugins/oauth-provider).

Users must retain their recovery key. Support has no means to recover plaintext.
The recovery key must never be sent to the API or included in logs. The desktop
must explain recovery responsibility during setup and allow the user to save
their key. Native key wrapping, recovery-key confirmation/export, secure key storage
and local locking are implemented. Only the wrapped package reaches PostgreSQL.
Personal financial analysis and credit scoring remain future work with a separate
explicit permission flow for any server-readable disclosure; login and E2EE setup
do not authorize it. No such disclosure or consent UI is implemented here.

There are no subscription-tier device or total storage limits. Request-size,
batch-size, pagination and operational rate limits are technical bounds, not
paid-plan quotas. Once trial or paid entitlement ends, retain encrypted cloud
data without automatic expiry but deny push, pull and snapshot access. Local use,
sign-in and billing management remain available. Resubscribing can resume sync.
Cancellation must not delete retained records. Explicit account/data deletion is
a separate operation. Cancellation retains access through the paid period's end;
THB pricing is configured in Stripe and trials default off. See [website billing](billing.md).

This supersedes the plan's server-side domain validation assumption. The server
can enforce account ownership, active devices, entitlement, versions, batch
atomicity, and request-size bounds. Desktop clients must decrypt, validate money,
dates, relationships and domain constraints before applying a complete atomic
group. Category names, entity types, relationships, and amounts belong inside
ciphertext. Unique category names cannot be enforced by a plaintext server index.
Concurrent changes to different records can violate financial invariants; the
financial beta uses encrypted income/payroll/transaction aggregates and dataset-level concurrency;
protocol 5 extends this to all remaining metadata aggregates with dependency checks,
exact loan allocations and explicit conflicts.

## Desktop schema review

Inspected sibling `../app`, version `0.0.1-beta.4`:

- Tauri 2 with React; Rust owns operations and SQLx owns SQLite persistence.
  Release data lives at `v1/heyday.db`, debug data at `development/v1/heyday.db`.
- Released migrations are `0001_initial.sql`, `0002_salary_payments.sql`, and
  `0003_subscription_providers.sql`. Preserve this baseline and append migrations.
- User-created IDs use `lower(hex(randomblob(16)))`, not UUID strings. Existing
  category seeds include `planner-expense-0` and `default-fee-interest`; do not
  regenerate them during import. Cloud record identity must include dataset ownership.
- Transaction categories (`categories`) are distinct from `planner_categories`.
  Implemented first slice: transaction categories with `id`, `name`, `is_archived`,
  and `icon`. `name_key` is derived locally, not an independent editable field.
  Names use whitespace normalization and lowercase uniqueness including archives.
  `transaction_options.rs` owns the supported icon set and validation.
- Archive is a domain value, not a sync tombstone. The current category UI
  archives/restores; deleting categories requires relationship rules before use.
- Money crosses IPC as signed decimal integer strings and is stored as SQLite
  i64 minor units. Dates use Gregorian `YYYY-MM-DD`, years 0001–9999. Transaction
  positivity and future-date checks are additional desktop domain rules.
- Financial dependencies extend beyond accounts and transactions: payroll groups,
  loan payment parts, reconciliation evidence, card statements, installments,
  recurring subscriptions, income definitions and planner overrides must be
  audited as atomic aggregates. Derived balances cannot be independently merged.
- Device-local data includes credential/key storage, installation/session identity,
  pending queues, pull cursors, sync state, local paths and backup locations.
  Protocol 5 now synchronizes editable reference catalogs and PNG assets by content
  hash; appearance preferences remain local.
- No existing cloud login or transactional sync queue was found in the reviewed
  command/migration paths. Local edits must enqueue in the same Rust transaction;
  adding a frontend network request after saving would not be durable.

The desktop now has an optional Settings > Heyday account panel and Rust-owned
browser PKCE flow, cancellation, refresh and sign-out, with OS credential storage.
The login screen is `/login`. SQLite migration `0004_category_sync.sql` adds the
category queue, shadow and account binding. Separate explicit enablement starts
sync; signing in does not upload local records. Native packaged-app smoke
testing with real email and credential-store prompts remains.

## Implemented foundations

`src/server/devices` implements `/api/v1/me` and device registration, listing and
revocation. A server-only Better Auth endpoint verifies native-client access
tokens through the provider API; the PostgreSQL service rechecks session validity
under an account lock. Device sessions cannot switch installations, and revocation
atomically expires their sessions and tokens. `migrations/0001_cloud_accounts_devices.sql`
stores account/dataset metadata, devices, session bindings and request counters.
The existing migration command applies these after the Better Auth schema.
`tests/integration/devices.test.ts` exercises the flow against isolated PostgreSQL
schemas with synthetic email delivery. Desktop device registration/UI is implemented
under Settings → Heyday account → Manage devices, with stable local installation
identity, saved names, paginated lists and confirmed revocation. Separate Encryption
settings implements initial key setup and recovery. Migration `0002_encryption_keys.sql`
stores one immutable recovery-wrapped dataset key per account. `/me` advertises key
enrollment and sync capability separately from expiring beta or verified subscription
entitlement. Website billing is implemented and disabled until configured; sync defaults
off unless the service flag is enabled. Registered devices can GET/PUT their
account's package; concurrent different initializations conflict and exact retries
are idempotent. Auth expiry/sign-out lock the native saved key.

`src/contracts/v1/common.ts` validates canonical integer strings, versions,
existing record identifiers and calendar dates, and defines the error envelope.
These validators do not make plaintext domain fields acceptable in API payloads.

`src/contracts/v1/encrypted-record.ts` defines and validates a draft encrypted
envelope. It provides canonical associated-data bytes for cross-language clients.
The native `cloud_crypto.rs` implements this record format and the separate key
wrapping format in `src/contracts/v1/encryption.ts`. Shared public vectors verify
Rust/Web Crypto interoperability. These older record-v1 helpers are not used for uploads or exposed through IPC.
Active sync uses the record-v2 protocol in [sync-api.md](sync-api.md).

Draft wire representation:

```json
{
  "format": "heyday-record-v1",
  "algorithm": "A256GCM",
  "keyId": "opaque-key-id",
  "nonce": "unpadded-base64url-12-bytes",
  "ciphertext": "unpadded-base64url-ciphertext-with-16-byte-tag"
}
```

Ciphertext is limited to 65,536 decoded bytes, including its tag. Metadata IDs
are 1–128 ASCII letters, digits, underscores or hyphens. Versions are canonical
decimal strings between zero and 9223372036854775807; zero means create-only.
Unknown envelope fields are rejected so accidental plaintext fields are not
silently accepted. Base64url must have canonical zero padding bits and no `=`.

For AES-256-GCM, the client must generate a fresh random 96-bit nonce for each
encryption and use a 128-bit authentication tag. Persist the entire ciphertext
and mutation together; retries resend exactly those bytes. Key enrollment and
recovery are implemented, but record-key usage bounds and rotation remain required
before production financial sync.
The construction uses standard [Web Crypto AES-GCM](https://www.w3.org/TR/webcrypto-1/#aes-gcm).

Associated data is UTF-8 encoding of a JSON array without whitespace, in this order:

```json
["heyday-record-v1","A256GCM","datasetId","recordId","mutationId","baseVersion","put","keyId"]
```

The operation is `put` or `delete`. Deletion carries an encrypted tombstone too.
The server-assigned committed version is excluded because it is not known when
encrypting. Clients must verify associated data against the expected account's
dataset and record before accepting decrypted content. This binding detects
substitution; it does not alone detect a malicious server replaying old history.
Rollback detection and trusted key distribution still need a protocol review.

`src/server/api/http.ts` supplies private/no-store responses, server-generated
request IDs, redacted unexpected errors, and bounded streamed UTF-8 JSON reads.
It is not an authentication layer. Route handlers must authenticate and authorize
before calling future services. Public errors use `code`, `message`, `requestId`,
and optional `details: [{field}]`; unexpected failures never include raw exceptions.

Run `bun run test:api` for protocol/helper tests. They include real AES-GCM
authentication checks for changes to each bound metadata field. These are not
PostgreSQL concurrency tests or desktop end-to-end tests.

## Decisions blocking the next implementation stage

1. Configure the implemented Better Auth and Resend integration. Supply
   Railway/PostgreSQL environment configuration and Resend sender credentials;
   Stripe billing product and webhook configuration are needed for the billing phase.
2. Validate the implemented user-held recovery-key model on packaged native apps;
   define rotation, compromised/lost-device handling and key usage bounds. Support
   recovery is prohibited; existing-device approval is not a confirmed requirement.
3. Configure trial duration and billing lifecycle handling; define history and
   retry-deduplication retention, supported offline duration and minimum client
   version. Retained encrypted records must not be pruned because premium expires.
4. Category sync has explicit import, fixed-boundary bootstrap, durable retries
   and conflict reconciliation. Financial atomic operations are implemented; history
   compaction, key rotation and packaged two-device verification remain.

Do not deploy placeholder authentication, trust client entitlement flags, store
plaintext temporarily, or claim production/full-financial-sync readiness from
category-level automated coverage alone. See the current scope and limitations in
[sync-api.md](sync-api.md).

## Income forecast increment

Protocol 4 adds encrypted per-source/month Outlook income and deduction overrides.
Existing connections explicitly select **Add income forecasts**. Zero is preserved;
clearing restores the scheduled estimate. Offline competing edits need a choice,
including when an income definition removes a deduction. Forecast changes never
post money. Protocol 5 now adds other planner entries and payday settings. See
[sync-api.md](sync-api.md#income-forecast-overrides) for identity, migrations and scope.

## Complete financial increment

Protocol 5 / SQLite 0008 / PostgreSQL 0007 implement the remaining financial
entities. Existing users confirm **Add remaining financial data**; login alone
still uploads nothing. The service stores opaque ciphertext with no new plaintext
financial tables. Native tests cover complete restore of all 23 metadata kinds,
legacy upgrades without double posting, concurrent principal allocations, audit
identity remapping, logo deduplication and explicit offline conflicts. See the
[complete metadata specification](sync-api.md#complete-financial-metadata-protocol-5).
