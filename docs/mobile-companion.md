# Mobile companion server support

Phase 6 adds a separate public native OAuth client `heyday-mobile-beta` with the
exact redirect `money.heyday.mobile:/oauth/callback`, required S256 PKCE and the
existing email-code login. Desktop's client and dynamic loopback ports are
unchanged. Both reviewed clients use independent native sessions and the same
server-only opaque-token verification. No dynamic registration or new token
scopes are enabled.

Run the normal `bun run auth:migrate --apply` deployment job. It seeds the mobile
client without overwriting existing administrator changes/revocations and applies
append-only migration `0010_mobile_devices.sql`. This expands the device platform
constraint to include `ios` and `android`; existing migrations, encrypted records,
keys and sync headers are unchanged. Registration and sync still use existing
ownership, revocation and subscription enforcement.

Deploy this before the mobile beta. Desktop also needs its device-list allowlist
and display update so it can manage phones. The mobile application remains in its
separate private repository and is never needed to build or deploy this service.

Validation: the real-provider API tests exercise both native clients' PKCE,
callback, refresh, independent sessions and revocation. The PostgreSQL integration
test now migrates all ten cloud migrations and registers iOS/Android sessions.
Run `bun run test:api` and `TEST_DATABASE_URL=... bun run test:postgres` before rollout.
The latter requires a dedicated test database; tests isolate their own schemas.

Subscription expiry denies cloud sync without deleting ciphertext. Mobile's beta
keeps local reads/expense recording and pending writes available after expiry; no
store purchase flow or additional server grace entitlement is introduced.
