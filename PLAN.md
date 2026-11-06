# Desktop account and cloud sync implementation plan

Last reviewed: 2026-11-06.

Status: Desktop `0.0.1-beta.5` implements encrypted sync for all currently editable
financial data: categories, accounts, transaction groups, income/deductions and
payslips, loans/facilities, shared card limits and statements, installments,
subscriptions/payment plans, all Outlook overrides/settings, reconciliation and
verification history, payoff/default history, catalogs and custom logos.
Protocol 5 requires fresh **Add remaining financial data** consent. Loan principal
and account balances remain derived; legacy ledger upgrades do not post twice.
See [the sync protocol](docs/sync-api.md).

Email-only beta authentication and local Docker infrastructure are
implemented. Desktop sign-in, token refresh/sign-out, secure credential storage,
and the redesigned browser callback are implemented. Strict encrypted sync contracts and endpoints are implemented. The service is
disabled by default until configured, and signing in alone never uploads local data. Account metadata and device registration/listing/
revocation APIs and desktop device controls are implemented. E2EE key generation,
wrapping, immutable package storage, saved-key confirmation/export, recovery and
local locking are implemented. Website Stripe checkout, customer portal and verified
subscription reconciliation are implemented, with configuration and real Stripe
sandbox validation still required. Key rotation, recovery-key replacement and
user-transferred history verification are implemented; independent security review
and cryptographic device enrollment remain open. Production deployment and packaged
native verification remain open.

Checked items below mean code or documented design work is implemented, not that
production rollout or the full native/email round trip has passed. Protocol design
details are in [the implementation companion](docs/cloud-sync.md).

## Current implementation status

| Feature | Status | Evidence and remaining work |
| --- | --- | --- |
| Desktop schema review | Initial review complete | Tauri/Rust/SQLite, existing IDs, money/date formats, category candidate and device-local fields documented; ledger aggregate scope is implemented below; remaining planning/statement aggregates are implemented in protocol 5. |
| Shared API foundations | Implemented; formal API specification pending | `src/contracts/v1` validates exact values, IDs, dates and draft encrypted envelopes; `src/server/api/http.ts` provides bounded JSON reads, private responses and error envelopes. Sync endpoint contracts and protocol 1-5 gating are implemented; a language-neutral API specification remains. |
| Better Auth API and PostgreSQL auth storage | Implemented | `/api/auth/*`, environment validation, auth migration runner and public desktop OAuth client registration. |
| Account and device APIs | Implemented | `/api/v1/me`, device registration/listing/revocation, metadata-only dataset mapping, session-bound ownership, pagination and account rate limits. PostgreSQL tests cover isolation, concurrency, expiry, revocation and rollback. Devices are not yet cryptographically enrolled. |
| Desktop device controls | Implemented; packaged smoke testing remains | Settings → Heyday account → Manage devices: explicit named registration, stable per-origin/account installation identity, saved names across sign-ins, paginated device lists and confirmed revocation. Current-device revocation clears local credentials; offline/error states preserve financial data. English/Thai UI and native tests pass. |
| Email-only beta login | Implemented | `/login` requests and verifies six-digit Resend codes; Google and Apple are disabled/deferred. OTPs are hashed, expiring and attempt/rate limited. |
| Email sender and delivery failures | Implemented/configured locally | Selected sender: `Heyday Money <account@heyday.money>`. Rejected sends produce an unavailable response instead of reporting success; logs redact codes, addresses and provider details. Production delivery verification remains. |
| Desktop account UI and native authentication | Implemented | Settings → Heyday account; browser Authorization Code + S256 PKCE, state/issuer checks, loopback callback, cancellation/timeout, token refresh and sign-out/revocation. Local finances remain independent of login. |
| OS credential storage | Implemented; native verification open | Rust stores tokens by server origin and debug/release mode. Overlapping account checks are deduplicated, unchanged account metadata is not rewritten, and status errors reach the UI. The reported repeated macOS Keychain prompt still needs user/native confirmation after these changes. |
| Redesigned browser callback | Implemented | Bundled responsive English/Thai page with system light/dark mode, automatic close attempt, close button and manual fallback. Invalid callbacks show retry guidance without auto-closing. Browser restrictions can prevent closing; the page confirms the browser step while the app finishes sign-in. |
| Docker development stack | Implemented; locally exercised | `Dockerfile`, `compose.yaml`, example environment files, PostgreSQL persistent volume/health check, localhost database access on configurable port 5432, auth migration job and website/API service. Railway deployment remains. |
| E2EE key setup and user-held recovery | Implemented foundation; release review remains | Rust AES-256-GCM/HKDF key wrapping, OS key storage, explicit saved-key confirmation/export, registered-device recovery, interrupted-setup retry, package pinning and local lock. Server GET/PUT handles immutable initial enrollment; POST atomically rotates the encrypted package and retains retry receipts. Record v2 uses a fresh derived AES key per mutation, authenticated ordered history and secure-store checkpoint pins. Versioned rotation/recovery-key replacement, trusted-device history codes and explicit warned recovery are implemented. Independent review, packaged smoke tests and global freshness/transparency remain open. See `docs/key-rotation.md`. |
| Stripe billing and entitlement | Implemented; local sandbox configured; full checkout/native flow remains | Website `/account`, same-origin cookie-authenticated checkout/portal, raw-signature webhooks, current-state reconciliation, durable checkout retries, paid/trial access on push/pull/snapshot, retained data, and independent beta grants. Confirmed sandbox prices: THB 49/month and 499/year with a 60-day trial. Cancellation retains paid access through period end. See `docs/billing.md`. |
| Category cloud sync | Implemented beta slice; packaged two-device test remains | Native encryption, durable SQLite queue, PostgreSQL history/records, push/pull/snapshot, conflict UI, background scheduling and safe backup reconnect. See `docs/sync-api.md`. |
| Accounts and transaction cloud sync | Implemented ledger beta | Account metadata/opening balances, exact transaction amounts, atomic transfers/payment groups, derived balances, fresh consent, conflicts and protocol-2 upgrade gating. Protocol 5 adds their full planning metadata; deletion waits for missing dependencies or explicit reconciliation confirmation. |
| Income sources, deductions and payroll sync | Implemented | One encrypted income/deductions aggregate; complete immutable payslips in their existing transaction groups, zero-net/empty payslips, cross-device reversal, legacy upgrade without duplicate cash, duplicate-month conflict handling, separate consent and protocol-3 gating. Protocol 5 restores contract definitions and exact payroll principal allocations. |
| Outlook income and deduction override sync | Implemented | Encrypted per-source/month records, exact amounts including zero, clear-to-estimate tombstones, fresh consent, background refresh, explicit offline conflicts and protection against losing overrides when a source is deleted. Protocol 5 adds manual rows, debt/installment overrides, opening cash, completion status and payday settings. |
| Remaining financial data sync | Implemented beta | Protocol 5 / SQLite 0008+0009 / PostgreSQL 0007; 23 metadata kinds, stable reconciliation IDs, content-hash PNG attachments, aggregate statements/default periods/shared limits, exact loan allocations, fresh consent and explicit conflicts. Device appearance, credentials, keys, backup paths/files and runtime sync state remain local. |

Validation: all 199 native regression tests, 65 targeted browser/domain checks, 18
API/auth/crypto tests and the isolated PostgreSQL integration scenario pass.
Shared protocol-1/3/4/5 crypto vectors agree between Rust and Node/Web Crypto.
Native coverage includes every metadata kind, full restore, equal payroll deductions,
concurrent contract repayments, borrowing/payment reversals, late audit evidence,
metadata conflicts, stable-ID remapping, PNG deduplication, atomic rollback,
consent and pending-request preservation. Browser checks mock native IPC.
Desktop and service build/typechecks are checked before delivery. The Docker
service is updated through `0007_complete_sync.sql`, preserving its database volume
and localhost port 5432. No real account grants, emails or financial uploads are
used by tests. Packaged two-device HTTP/keyring/recovery smoke tests and independent
cryptographic review remain release work.

Billing validation: 23 API tests and both isolated PostgreSQL scenarios pass,
including paid sync, duplicate/out-of-order events, rollback, expiry and retry
protection. Website billing/login and desktop account/language browser tests pass.
Automated suites mock Stripe responses. Separately, real sandbox Checkout and portal
creation passed with a temporary customer; its uncompleted checkout was expired and
the customer deleted. A synthetic `invoice.voided` event forwarded through Stripe CLI
was accepted by the local webhook with HTTP 200. Website checkout has now produced
an active stored trial, and the shared entitlement check returns `canSync:true`.
The checkout-return banner confirms the trial and end date instead of continuing
to describe payment processing. Four website billing checks pass for pending,
trial, paid, and expired displays. No live charge or completed native sync round
trip against this subscription has been verified.
The local Docker service is rebuilt and migrated through `0008_stripe_billing.sql`;
its database volume is preserved and both cloud sync and Stripe test billing are enabled with the confirmed
prices and 60-day trial. All 15 required webhook events and the period-end cancellation
portal are configured in the sandbox. Apply the same migration before deploying to
another environment; live billing and production rollout remain pending.

Confirmed decision: cloud sync requires end-to-end encryption. Store opaque
encrypted records and perform domain validation on the desktop; do not introduce
plaintext financial tables or server-side inspection of financial payloads.

Confirmed product behavior:

- Beta sign-in uses email with a one-time code only. Google and Apple are deferred;
  the later Apple option is intended for macOS and iPhone. Authentication uses Better Auth.
- Billing uses Stripe. Hosting uses Railway. Database uses PostgreSQL with
  connection configuration supplied through environment variables.
- Email sign-in codes are delivered through Resend.
- Users must keep their recovery key. Support cannot recover encrypted data.
- No subscription-tier device or total cloud-storage limits. Bounded requests,
  pagination and operational rate limits still protect the service.
- When a trial or paid entitlement ends, retain encrypted cloud data without an
  automatic expiry and deny sync in both directions, including bootstrap snapshots.
  Local use, sign-in and billing management remain available. Re-enabling an eligible
  entitlement resumes sync; cancellation is not a cloud-data deletion request.

Trial duration,
billing lifecycle configuration and technical recovery/retention details
are still implementation work; they do not reverse these confirmed product rules.

## Objective

Allow users to sign in to the Heyday desktop app, enable cloud sync with a premium subscription, and use the same data across multiple devices. The desktop app remains usable offline, with changes synchronized when connectivity returns.

## Agreed architecture

- Use TypeScript and the existing TanStack Start application for the initial API.
- Group public desktop endpoints under `/api/v1` using directory-based routes.
- Use PostgreSQL for cloud records, subscriptions, device registration, and sync history.
- Deploy the website and API together initially, keeping business logic independent of route handlers.
- Use Better Auth hosted with the API, with browser-based Authorization Code + PKCE
  login for desktop.
- Use incremental record synchronization instead of uploading and replacing database files.
- Keep a local database and durable pending-mutation queue on each desktop device.
- Use versioned REST/JSON contracts so installed desktop releases can remain compatible with newer servers.

The website and image-generation API now also contain Better Auth account routes,
email login and local deployment tooling. Billing remains planned; the category sync service is implemented. See [development documentation](docs/development.md) and
[dependencies](package.json).

## Proposed project structure

```text
src/
  routes/
    ...existing website routes
    login.tsx          # implemented
    api/
      auth/
        $.ts           # implemented Better Auth handler
      v1/
        me.ts
        devices/
          index.ts
          $deviceId.ts
        encryption/
          keys.ts     # implemented: immutable wrapped-key setup/recovery
        sync/
          push.ts
          pull.ts
          snapshot.ts
        billing/
          checkout.ts
          portal.ts
    api.webhooks.billing.ts
  server/
    auth/
    billing/
    sync/
    db/
  contracts/
    v1/
migrations/
tests/
  api/
  sync/
```

Route handlers authenticate, validate input, call a service, and format the response. Services own authorization, entitlement checks, transactions, and sync rules. Database credentials and provider secrets stay in server-only modules. Request and response schemas contain no secrets or database implementation details.

The billing webhook is a provider-facing endpoint outside the desktop API version. Existing website and social-preview URLs remain compatible.

## Decisions and remaining design work

1. **Initial review complete:** desktop framework, SQLite schema/migrations,
   existing identifiers and current beta version are documented. Complete the
   financial aggregate audit is implemented through protocol 5; production security review remains.
2. **First slice implemented:** transaction categories (names, icons, archive state),
   including local relationship checks. Accounts and transaction ledger groups now use protocol 2; remaining planning entities use protocol 5 aggregates and dependency validation.
3. **Providers selected:** Better Auth, Resend, Stripe, PostgreSQL and Railway.
   Local auth pooling/configuration and Docker setup exist; production region,
   database connectivity and deployment configuration still need verification.
4. **Encryption decision confirmed:** require E2EE with a user-held recovery key;
   support cannot recover it. Key generation, wrapping, immutable package storage,
   recovery and desktop locking are implemented; see [E2EE protocol](docs/e2ee.md).
   Record v2, cross-device key rotation and independent minimum-history checkpoints
   are implemented. Old-key copies cannot be erased; global freshness, packaged
   tests and independent review remain. See [rotation protocol](docs/key-rotation.md).
   Personal financial analysis/credit scoring and any server-readable disclosure
   need a future, separate explicit permission flow; this implementation grants none.
5. **Core premium rules confirmed:** no plan-based device/storage limits; retain
   cloud data but stop sync after entitlement ends. Billing is managed on the website
   in THB. Cancellation keeps access until the paid period ends. Trials default off
   until a duration is chosen; failed/past-due payments have no added grace period.
   Actual prices, Stripe activation and any separate export path remain to be configured.
6. **Beta retention:** immutable history, tombstones and retry receipts are retained
   indefinitely. No cursor expiry/pruning is supported. Compaction/recovery and
   minimum supported client policies remain future protocol work.

Defaults for planning: one private dataset per account; no shared households or collaborative editing; explicit resolution of conflicting financial edits; local use continues after premium expires. These defaults need confirmation when finalizing product behavior.

## API surface

`GET /api/v1/me`, the three device endpoints and encryption-key GET/PUT are
implemented, along with sync push/pull/snapshot. These desktop APIs accept verified native-client Bearer
access tokens, not browser cookies. Authentication lives under `/api/auth/*`
and follows Better Auth's contracts, with `/login` as its browser UI. See
[account/device API usage](docs/account-api.md) for current contracts and limits.
Website-only billing uses verified browser cookie sessions under `/api/billing/`,
with exact-origin validation on mutations. See [billing setup](docs/billing.md).

All desktop endpoints require authentication. Sync endpoints additionally require an active device and eligible premium entitlement. Device registration may be used before purchase; there is no subscription-tier device limit.

| Method | Endpoint | Responsibility |
| --- | --- | --- |
| GET | `/api/v1/me` | Account, entitlement, API capabilities, and limits |
| POST | `/api/v1/devices` | Register an installation idempotently and bind it to its authenticated session |
| GET | `/api/v1/devices` | List the user's devices and last activity |
| DELETE | `/api/v1/devices/:deviceId` | Revoke a device and its associated sessions |
| GET | `/api/v1/encryption/keys` | Retrieve this account's recovery-wrapped key package on a registered device |
| PUT | `/api/v1/encryption/keys` | Initialize the key package once; exact retries are idempotent |
| POST | `/api/v1/sync/push` | Apply mutations with version checks and retry protection |
| GET | `/api/v1/sync/pull?cursor=...&limit=...` | Retrieve ordered changes in bounded pages |
| GET | `/api/v1/sync/snapshot` | Start or continue a consistent, paginated bootstrap snapshot |
| GET | `/api/billing/` | Website account subscription, prices and sync access |
| POST | `/api/billing/checkout` | Create/reuse a checkout session for the website account |
| POST | `/api/billing/portal` | Create a website subscription-management session |
| POST | `/api/webhooks/billing` | Verify and process billing events |

Authentication redirects, token issuance, refresh, and logout follow the selected provider's native-app flow. Never embed a client secret in the desktop binary. Store refresh credentials in the OS credential store.

Contracts must define runtime validation, size limits, pagination limits, money and date representations, and a consistent error envelope such as `code`, `message`, `requestId`, and optional field details. Represent money with an exact format compatible with the desktop schema, not floating-point arithmetic. Serialize large versions/cursors safely for JSON clients.

Distinguish expired authentication, premium-required access, revoked devices, validation failures, conflicts, expired cursors, and rate limiting. Publish an OpenAPI specification or equivalent language-neutral contract. Additive changes stay in v1; breaking changes require a migration and compatibility policy.

## Data model

| Table or group | Purpose |
| --- | --- |
| `users` | Map provider identity to an internal user ID |
| `billing_accounts`, `billing_subscriptions` | Persisted customer/checkout identities and verified subscription state/expiry |
| `devices` | Installation identity, session association, revocation, last activity |
| `cloud_keys` (implemented) | One immutable recovery-wrapped dataset key package per authenticated owner; no plaintext key |
| `cloud_sync_records` (implemented) | Dataset-owned opaque ciphertext with stable record IDs, versions and encrypted deletion markers; domain fields stay inside ciphertext |
| `sync_state` | Per-user committed change position and retention boundary |
| `sync_changes` | Ordered committed updates and deletion markers |
| `sync_mutations` | Mutation IDs, request fingerprints, and durable results for deduplication |
| `billing_events` | Webhook deduplication and processing state |

Better Auth's authentication schema and `cloud_accounts`, `cloud_devices`,
`cloud_device_sessions`, `cloud_api_usage` and `cloud_keys` are implemented. The
dataset mapping contains no encryption keys or financial records; wrapped packages
are kept separately in `cloud_keys`. Remaining cloud tables above
include implemented sync history/state and billing tables. Derive ownership from authenticated identity,
never a client-supplied user ID. Scope metadata queries and constraints to the
owner/dataset. Encrypted domain relationships and uniqueness must be validated
on the desktop; the server cannot inspect financial payloads.

Record updates, version increments, change-history entries, and mutation results must commit in the same database transaction.

## Sync protocol

### Local writes and push

1. Save each local edit and its pending mutation atomically in the desktop database.
2. Assign a stable record ID and unique mutation ID. Include entity type, operation, base version, and validated payload.
3. Submit bounded batches. Explicitly group related financial mutations, such as both sides of a transfer, into one atomic operation.
4. Verify identity, device status, entitlement, ownership, encrypted-envelope metadata and operational bounds on the server. Validate decrypted relationships and financial invariants on the desktop.
5. Check deduplication before applying a mutation. Return the stored result for the same ID and payload; reject reuse of that ID with a different payload.
6. Apply an update only if its base version matches the current server version. Use an explicit create-only precondition for new records.
7. Return the accepted version or a conflict result containing the current server state. Define whether independent operations can partially succeed; atomic groups never partially succeed.
8. Acknowledge local queue entries only after durably saving the result. Preserve newer local edits made while a request was in flight.

### Pull and ordering

1. Fetch changes after the device's saved cursor in stable order.
2. Apply each page and advance its cursor in the same local transaction.
3. Preserve pending local edits when a downloaded version changes the same record; route these through reconciliation rather than overwriting them.
4. Continue until the response indicates there are no more pages.

Use server-controlled, account-scoped opaque cursors. For the initial implementation, serialize writes for each account using a locked `sync_state` row, allocate change positions inside the transaction, and release the lock only on commit. A plain global sequence alone is insufficient: transactions can commit out of allocation order and cause a client to skip changes.

Push success must not advance the client's pull cursor past unseen changes from other devices. Pull history independently and recognize already-applied own mutations.

### Conflicts and deletion

- Use optimistic concurrency checks rather than device clocks to determine conflicts.
- Preserve both the local edit and current server version until resolution.
- For financial conflicts, let the user select or edit the desired result, then submit a new mutation against the latest server version.
- Treat delete-versus-edit as a conflict. Do not silently restore deleted data.
- Retain deletion markers until the retention policy allows removal. Devices older than the retained history must bootstrap again.
- Do not store derived balances as independently editable sync records unless the domain design requires it; prefer recomputing them from authoritative records.

### Bootstrap and recovery

- Create a snapshot representing a consistent server state and its matching change cursor. Pages must share the same snapshot boundary; do not independently read a changing database on each page.
- Choose a bounded snapshot implementation suitable for the hosting environment, such as a materialized snapshot with a short-lived token. Do not hold a database transaction open across HTTP requests.
- After loading all snapshot pages, pull changes after its boundary cursor.
- For an expired cursor, preserve local pending changes, stage the snapshot, and reconcile those changes before replacing local state.
- A first upload from an existing local database needs an explicit import/bootstrap flow with stable IDs and retry protection. Do not assume an empty cloud dataset on every login.
- Define expired mutation-ID behavior so a very old retry cannot silently create duplicates after deduplication history is pruned.

### Scheduling and account isolation

Sync on launch, after edits with a short debounce, on connectivity restoration, periodically while active, and on manual retry. Retry transient failures with exponential backoff and jitter; honor rate-limit guidance. Pause for authentication, entitlement, or conflict states that require action.

Keep local datasets and pending queues isolated by account. Logging out, switching accounts, or revoking a device must never upload one user's data into another account. Cloud revocation stops future access but cannot erase data already held by an offline device.

## Premium and billing behavior

- Verify webhook signatures against the original request body.
- Deduplicate deliveries and handle delayed or out-of-order events using provider-supported reconciliation.
- Grant entitlement from verified server-side subscription state, never a checkout redirect or desktop flag.
- Validate entitlement on both push and pull.
- On expiry, preserve local use and pause sync. Keep login and billing management available.
- Define a separate export/recovery path if expired users need cloud-data retrieval without ongoing sync.
- Show cloud retention and deletion policies before purchase and before removing retained data.

## Security and operations

- Use TLS, encryption at rest, managed secrets, and encrypted backups.
- Validate token issuer, audience, expiry, and permitted algorithms through the selected provider's supported integration.
- Check device revocation on sync requests; a client-supplied device ID alone is not authentication.
- Apply authorization to every endpoint and domain relationship.
- Rate-limit per account/device and bound payload sizes, batch counts, and snapshot lifetimes.
- Keep financial payloads and credentials out of logs. Record request IDs, latency, error categories, queue backlog, and conflict counts.
- Use private/no-store cache behavior for account and financial responses.
- Select serverless-safe connection pooling and keep transactions short.
- Define backup restore, migration rollback, account deletion, and incident recovery procedures.
- Add realtime notifications only later; treat them as prompts to pull, not the authoritative data stream.

## Delivery milestones

### 1. Schema and contract design

- [x] Review the current desktop schema, identifiers and value formats; document the candidate category slice and device-local fields.
- [x] Confirm Better Auth, Resend, Stripe, PostgreSQL and Railway.
- [x] Confirm E2EE, user-held recovery keys, unlimited plan device/storage counts and cloud retention after entitlement expiry.
- [x] Implement and unit test common validators, draft encrypted-envelope/associated-data contracts and HTTP error/body-size helpers.
- [x] Implement all current financial entities and aggregates; sync editable catalogs/logos and financial settings, retaining device appearance, credentials, keys and backup files locally.
- [x] Implement and document native key generation, recovery-key wrapping, immutable enrollment, recovery and local locking.
- [x] Add record v2 with one derived AES key per mutation, client-authenticated history, pinned checkpoints and shared Rust/Web Crypto vectors.
- [x] Implement rotation/recovery-key replacement, immutable retry receipts, epoch-bound writes, stable record IDs, trusted-device history codes, verify-before-apply staging, and explicit warned recovery when all trusted devices are lost. Preserve existing pins and propagate the warning.
- [ ] Obtain independent security review and complete packaged two-device rotation/crash/recovery tests before production financial sync. Review brief: `docs/security-review.md`; global freshness beyond a transferred checkpoint remains outside this protocol.
- [ ] Finalize trial/billing lifecycle, history/deduplication retention and offline/client compatibility policies.
- [ ] Complete v1 endpoint request/response schemas, mutation semantics and a language-neutral API specification.
- [x] Implement encrypted-record constraints/indexes, additive migrations and a fixed-boundary immutable-history bootstrap; no history pruning in this beta.

Exit criterion: the desktop and server can implement the same documented protocol without assuming missing behavior.

### 2. Account and entitlement foundation

- [x] Implement Better Auth identity/session storage, `/api/auth/*`, environment validation and PostgreSQL auth migration tooling.
- [x] Register the public native OAuth client with required PKCE through the migration job.
- [x] Implement email-only browser login with Resend OTP, delivery-failure propagation and redacted diagnostics.
- [x] Configure the local sender as `Heyday Money <account@heyday.money>`.
- [x] Implement desktop account UI, PKCE login, refresh, cancellation, sign-out/revocation and OS credential storage.
- [x] Isolate new desktop OAuth sessions from website sessions; verify browser logout preserves app access/refresh and device revocation preserves the browser login. Existing app sessions need one fresh sign-in after deployment.
- [x] Implement the localized callback page, auto-close attempt and browser-restriction fallback.
- [x] Reduce redundant Keychain accesses and preserve credential-store errors in the account UI.
- [ ] Confirm the macOS repeated-prompt issue is resolved in native use and smoke-test packaged macOS/Windows sign-in, restart, refresh and sign-out.
- [x] Add metadata-only cloud dataset/account mapping, session-bound device registration/list/revocation and `/api/v1/me`.
- [x] Verify account isolation, expired/invalid tokens, disabled OAuth clients, device revocation, concurrent registration and transaction rollback against PostgreSQL.
- [x] Add desktop installation identity and English/Thai device management UI, including explicit registration, pagination and confirmed revocation; crypto enrollment remains separate.
- [x] Add registered-device-only wrapped-key GET/PUT APIs, concurrency-safe initialization and account isolation.
- [x] Add English/Thai E2EE setup with saved-key confirmation/export, recovery, secure storage, interrupted-setup retry and local lock/sign-out handling.
- [x] Reconnect existing desktop installations after login; offer account-scoped secure-store key remembering and confirmed forget-device sign-out. Preserve package pins/checkpoints, explicit first registration and revoked-device rejection.
- [x] Simplify everyday controls to Pause/Resume sync with an encryption badge; show recovery only when needed and move confirmed key removal into Advanced security. Pause before removing keys and preserve consent for new/expanded sync scope.
- [ ] Smoke-test E2EE setup/restart/recovery on packaged macOS and Windows and complete an independent cryptographic protocol review.
- [ ] Smoke-test registration/revocation between packaged desktop clients, including Keychain failure and revoked-installation recovery UX.
- [x] Implement website billing checkout, portal, verified webhooks, reconciliation and entitlement checks, with a native link to website management.
- [x] Integrate desktop subscription status through authenticated `/api/v1/me`: trial/active/cancellation/payment/expired states, browser-return refresh, expiry handling and access recovery for already-enabled sync. Preserve Pause, first-upload consent and independent website/native sessions. Cover billing lifecycle plus encrypted push/pull retention with PostgreSQL, native IPC projection and browser regressions.
- [x] Enforce and test expiring beta grants and Stripe paid/trial access on push, pull and snapshot, retaining cloud data after expiry.
- [x] Configure sandbox THB 49/month and 499/year prices, Stripe keys, all required webhook events, period-end cancellation portal and the confirmed 60-day trial; enable local Docker billing and verify real Checkout/portal creation and local webhook forwarding.
- [ ] Complete sandbox checkout/payment from a website account, renewal, failure, trial end, period-end cancellation and desktop-sync verification before configuring live billing.

Exit criterion: eligible devices can access protected endpoints, and ineligible or revoked sessions are denied consistently.

### 3. First end-to-end sync slice

- [x] Implement transaction categories: names, icons and archive state.
- [x] Add local transactional mutation queue and durable server mutation deduplication.
- [x] Implement encrypted push/pull, dataset and record concurrency, tombstones and cursors.
- [x] Implement explicit first upload and second-device fixed-boundary bootstrap, preserving existing edits.
- [x] Add sync status, pending count, last update, retry/pause and explicit conflict resolution in English/Thai.
- [x] Preserve pending ciphertext across restart and exclude sync ownership/queues from backups and restores.
- [ ] Smoke-test two packaged devices through actual HTTP and secure key storage.
- [ ] Implement compacted snapshots/expired-cursor recovery before any future history pruning; beta history never expires.

Exit criterion: two devices converge after offline edits and network failures without losing accepted data.

### 4. Financial entities

- [x] Add account details and transaction history in dependency order, preserving immutable opening balances/type and deriving balance changes locally.
- [x] Group transfers, salary ledger entries and loan-payment components atomically; preserve historical source labels and protect imported linked-payment deletion.
- [x] Require fresh financial consent, reject conflicting currency and block protocol-1 clients after the first protocol-2 financial record.
- [x] Sync income sources and deductions as one aggregate, retaining stable IDs and local overrides on retained definitions.
- [x] Sync immutable payslips, including zero-net/zero-ledger payments, with all payroll transactions; support cross-device reversal and duplicate-month conflicts.
- [x] Upgrade legacy ledger-only payroll without posting money twice; require income consent and protocol-3 clients after upgrade.
- [x] Sync Outlook income and deduction overrides per source/month, preserving explicit zero, clearing to estimates and offline edits during source deletion; require fresh consent and protocol 4.
- [x] Sync loans/facilities, statements/shared limits, installments/subscriptions/payment plans, all planner data/settings, payoff/default history, reconciliation/verifications, catalogs and logos; upgrade linked payments for native cross-device reversal after dependencies arrive.
- [x] Enforce exact monetary values, ownership, and referential integrity. Implemented for ledger and complete metadata aggregates; packaged cross-device QA remains.
- [x] Implement atomic multi-record financial operations. Implemented for ledger and complete metadata aggregates; packaged cross-device QA remains.
- [x] Add conflict resolution appropriate to financial records and deletion dependencies. Implemented for ledger and complete metadata aggregates; packaged cross-device QA remains.
- [x] Migrate existing local installations without losing identifiers or edits. Implemented for ledger and complete metadata aggregates; packaged cross-device QA remains.

Exit criterion: balances and related records remain consistent across concurrent edits and retries.

### 5. Beta and production readiness

- [x] Add Docker build targets and Compose PostgreSQL/migration/service setup with persistent data, health checks and environment examples.
- [x] Build and run the local Docker stack and auth migration/client registration.
- [x] Expose PostgreSQL on localhost port 5432 (configurable with `POSTGRES_PORT`) and verify host-client access without changing the existing data volume.
- [x] Add automated contract, email/OAuth, desktop account/callback browser and Rust auth regression coverage.
- [x] Add isolated PostgreSQL integration coverage for auth-backed account/device APIs and append-only cloud migrations.
- [x] Verify key-package conflicts/idempotency, revoked access, native tamper rejection, cross-language crypto vectors and browser recovery flows.
- [x] Document local API configuration, desktop sign-in, callback regeneration and scoped Keychain troubleshooting.
- [ ] Deploy/configure the service on Railway and verify production PostgreSQL, HTTPS and Resend delivery.
- [ ] Complete real-email and packaged native credential-store smoke tests; current automated checks do not cover the full deployed flow.
- [ ] Run the validation matrix below against a real test database and desktop clients.
- [ ] Exercise backup restoration, retention pruning, recovery, and schema upgrades.
- [ ] Measure payload sizes, sync latency, database contention, and storage growth.
- [ ] Release to a small premium beta cohort with monitoring and a sync-disable switch.
- [ ] Document support steps and expand rollout after recovery and correctness checks pass.

## Validation matrix

Category and ledger automated coverage now exercises retries, concurrency, offline
reconciliation, snapshot overlap, account isolation, rollback and access expiry.
Packaged two-device validation remains. Financial metadata and billing events have
automated coverage; real Stripe sandbox validation and expired-history recovery
remain pending. Beta history is not pruned.

| Scenario | Expected result |
| --- | --- |
| Same mutation retried after a lost response | One durable effect; same result returned |
| Mutation ID reused with different payload | Rejected without changing records |
| Two devices edit the same base version | One accepted; the other receives a resolvable conflict |
| Delete on one device, edit offline on another | Explicit conflict; no silent resurrection |
| Concurrent server writes | Pull never skips a committed change |
| Crash while applying a pull page | Both data and cursor commit, or neither does |
| Snapshot overlaps ongoing writes | Consistent bootstrap followed by complete incremental changes |
| Cursor or deduplication history expires | Explicit recovery; pending edits are preserved |
| Transfer fails partway through | Entire atomic operation rolls back |
| New local edit during push/pull | New edit remains pending and is not overwritten |
| Account switch with queued mutations | No cross-account upload or data exposure |
| Premium expiry or device revocation | Sync denied; local data remains usable |
| Duplicate/out-of-order billing events | Entitlement reflects verified current subscription state |
| Old supported desktop version | Additive server changes remain compatible |
| Cross-account IDs in requests | Access denied without leaking another user's data |

Use unit tests for protocol rules, PostgreSQL integration tests for concurrency and transaction behavior, and desktop/API end-to-end tests for recovery. Run the existing website typecheck, build, and relevant regression checks when adding routes or changing shared configuration.

## Out of scope for the first release

- Shared household datasets and collaborative permissions.
- Automatic field-level or CRDT merging of financial records.
- Persistent realtime transport and microservice extraction.
- Attachment synchronization unless the desktop schema makes it necessary.

## Reference

- [TanStack Start server routes](https://tanstack.com/start/latest/docs/framework/react/guide/server-routes)

Migration compatibility fix (2026-11-04): restored the exact already-applied
SQLite migration 8 (checksum `735bacdce83d5016...`) and moved the subsequent
review-effect triggers into migration 9. Native regression coverage pins the old
checksum, preserves all data/pending requests on upgrade, and restores migration-8
backups through a staged copy. No existing database checksum is rewritten.
