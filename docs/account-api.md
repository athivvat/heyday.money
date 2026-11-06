# Account and device API

These endpoints are implemented in the TanStack Start service. They manage account
and installation metadata and encrypted key packages. Category sync has separate
[protected endpoints and explicit opt-in](sync-api.md).
Apply `bun run auth:migrate --apply` before serving the new routes. The command
also applies append-only SQL files in `migrations/` under a transaction lock, with
checksums recorded in `cloud_migrations`. Do not edit applied migration files.
Docker Compose's migration job runs the same command before the service starts.

## Authentication

Send `Authorization: Bearer <access_token>` from the existing public
`heyday-desktop-beta` Authorization Code + S256 PKCE flow. Browser cookies, ID
tokens and refresh tokens do not authorize these endpoints. The server-only
Better Auth verifier checks the provider's current token/client/session state,
issuer, native client, scopes and expiry. This first version accepts the current
session-bound opaque access tokens only; resource-bound JWTs and DPoP require a
separate protocol update. No token or OAuth session ID is returned in the device API.

New desktop authorizations create a separate server-side session before issuing the
authorization code. Browser sign-out invalidates the browser cookie and session;
the app's access tokens, refresh and device binding continue working. Each native
authorization gets its own session even when it reuses an existing browser login.
Desktop token revocation and device revocation leave the website signed in.
The desktop session preserves the source login's expiry (currently up to seven days);
browser activity cannot extend it, and refresh cannot restore an expired session.
The server keeps its session token private and gives the app only OAuth credentials.

Existing shared sessions are not rewritten or restored. After deploying this fix,
sign out and sign in once in the app to get an independent session. A browser logout
that already invalidated an old app login requires a new login too. Encryption keys,
financial records and subscriptions are not changed by this fix.

All responses are `private, no-store` with an `X-Request-Id`. Errors use the shared
`{ code, message, requestId, details? }` envelope. Missing credentials produce
`AUTH_REQUIRED` (401); invalid/expired credentials produce `AUTH_EXPIRED` (401).
An account has an operational limit of 120 API requests per minute (429 with
`Retry-After: 60`), independent of any paid plan. There is no device/storage plan quota.

## GET /api/v1/me

Idempotently provisions an account-to-dataset metadata mapping and returns:

```json
{
  "account": { "id": "authenticated-user-id", "email": "user@example.com" },
  "dataset": { "id": "dataset-uuid", "keyStatus": "not_enrolled" },
  "device": null,
  "entitlement": { "canSync": false, "reason": "not_configured", "accessUntil": null },
  "billing": { "enabled": false, "subscriptions": [] },
  "capabilities": { "apiVersion": 1, "devices": true, "sync": false, "syncProtocol": 2, "billing": false, "keyEnrollment": true },
  "limits": { "devices": null, "storageBytes": null, "devicePageSize": 100, "requestsPerMinute": 120 }
}
```

After registration, `device` contains the current device object described below.
The dataset ID is not an encryption key. Billing is disabled by default, and no trial
or premium eligibility is inferred from signing in. `CLOUD_SYNC_ENABLED=true`
changes capability `sync` to true. A current operator beta grant sets entitlement
`canSync:true`, reason `beta_access` and `accessUntil`. Verified Stripe subscriptions
can grant `subscription` or `trial` access; without an eligible grant the reason is
`premium_required`. Capability `billing` is true when Stripe configuration is enabled
and valid. Management lives on website `/account`, not in the native API. See
[billing](billing.md). Capability availability is separate from entitlement.
`billing.subscriptions` is a read-only projection of the current account's verified
Stripe state: `{ status, periodEnd, cancelAt }`, with UTC ISO dates or null. It
contains no customer/subscription IDs, prices, payment details or financial data.
Webhooks, website account reconciliation and the operator reconciliation command
update this projection; `/me` does not contact Stripe. Native clients use
`entitlement.canSync` and `accessUntil` for access, never infer it from a subscription
status string. The server rechecks access on every sync request. An older response
without billing details remains supported by the desktop app.
`dataset.keyStatus` becomes `enrolled` after storing a wrapped key package. This
does not prove the current device has unlocked it. See [E2EE protocol](e2ee.md)
for the implemented GET/PUT `/api/v1/encryption/keys` endpoints and recovery flow.

## POST /api/v1/devices

Content type: `application/json`. Maximum body size: 2,048 bytes.

```json
{
  "installationId": "c240f005-002b-4d41-9709-3c8532bb7c8a",
  "name": "My MacBook",
  "platform": "macos"
}
```

Use a locally persisted random lowercase UUID for `installationId`, a name of
1–80 characters without control characters, and `macos`, `windows` or `linux`.
Unknown fields (including owner/session IDs) are rejected. Installation IDs are
owner-scoped idempotency keys, not credentials or hardware fingerprints.

Returns 200 with a device object. Concurrent identical retries return the same
device ID. The server binds the verified OAuth session to this installation;
the session cannot register another installation. Repeating the installation ID
with different name/platform returns `CONFLICT` (409); rename is not implemented.
A new authenticated session can join an existing active installation. A revoked
installation cannot be reactivated by registration (`DEVICE_REVOKED`, 403).
Explicit re-enrollment UX remains future work; clients must not silently generate
a new installation ID in response to revocation.

Device response shape:

```json
{
  "id": "server-device-uuid",
  "name": "My MacBook",
  "platform": "macos",
  "createdAt": "2026-11-04T00:00:00.000Z",
  "lastSeenAt": "2026-11-04T00:00:00.000Z",
  "revokedAt": null,
  "current": true
}
```

## GET /api/v1/devices?limit=50&cursor=...

Returns `{ devices: Device[], nextCursor: string | null }`. Pages are ordered by
device UUID; `limit` defaults to 50 and is bounded to 1–100. Pass `nextCursor`
unchanged for the next page. Requests reject unknown/repeated query parameters.
Every query is scoped to the authenticated account; a supplied cursor does not
grant access to another account. Revoked devices remain visible, and `current`
identifies the session's device. `lastSeenAt` reflects use of this API, not a heartbeat.

## DELETE /api/v1/devices/:deviceId

Returns 200 `{ "revoked": true }`. Unknown and other-account IDs both return
`NOT_FOUND` (404). Revocation is idempotent when called by another valid session.
Self-revocation succeeds once and blocks subsequent requests from that session.

Within one transaction, the service marks the device revoked, expires every
bound auth session, and revokes/expires its opaque access and refresh tokens.
It retains expired session rows so provider foreign-key cleanup cannot detach
tokens from the revoked session. Any token issued by an in-flight refresh still
refers to an expired session and cannot authorize this API. Requests serialize
against revocation and recheck session validity inside the transaction.
For new independent desktop sessions, revocation does not affect the browser login.
Legacy shared sessions retain their old behavior until the app signs in again.
Revocation does not erase local financial data, cloud dataset metadata or other
devices' sessions.

Device registration itself is session/device access management; the separate
Encryption settings flow creates or recovers keys. The desktop exposes Manage devices under Settings →
Heyday account, with explicit registration, paginated lists and confirmed revoke
actions. Rust owns the authenticated API requests. A stable UUID and registration
name are saved outside the financial database/backups, scoped by origin/account
and debug/release mode. Later sign-ins automatically bind the new session to this
saved installation; a first registration remains explicit. A forgotten installation
requires explicit registration again using the same identity, and revoked/corrupt
identities are never silently replaced. Rename and explicit
re-enrollment remain future work.

## Verification

`bun run test:api` runs the existing isolated contract/auth checks. For real
PostgreSQL coverage, set a test-only `TEST_DATABASE_URL` and run
`bun run test:postgres`. The integration test creates and removes a random schema
and never migrates the normal application schema. It covers migration replay,
real provider login/refresh, independent browser/desktop logout, invalid/expired credentials, disabled clients,
concurrent registration, ownership, pagination, rate limiting, multi-session
revocation and rollback after a simulated database failure. Encryption checks cover
registered-device access, concurrent initialization, exact retries, owner isolation
and access after revocation. Email delivery is
substituted; no real email is sent. Without `TEST_DATABASE_URL`, this test is skipped.

The provider verification uses Better Auth's supported
[server-side capability API](https://better-auth.com/docs/plugins/oauth-provider).
