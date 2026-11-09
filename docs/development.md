# Development

Run `bun install`, then `bun run dev` and open http://localhost:3000.

`bun run build` builds the TanStack Start app. `bun run typecheck` checks TypeScript. `bun run preview` previews the production build.

Global CSS is imported directly in `src/routes/__root.tsx`, so Start's client asset
manifest supplies the stylesheet URL for both server rendering and navigation.
Keep this as a side-effect import: the previous `styles.css?url` import produced a
different server CSS hash in Linux/Docker builds, causing a 404 and oversized images
until JavaScript loaded the client stylesheet. See [Start's CSS patterns](https://tanstack.com/start/latest/docs/framework/react/guide/css-styling).
Run `bunx playwright test tests/navigation.spec.ts` against the built Docker site
(default `http://127.0.0.1:3000`, or `HEYDAY_WEB_TEST_URL`) to check stylesheet
availability without JavaScript and Account/login return navigation.

`bun run test:api` checks cloud contracts, HTTP, authentication and cryptographic
interoperability. Better Auth, account/device and encrypted-key endpoints require
environment setup and migrations. All current financial entities sync with E2EE in desktop beta.5, including
loans, planner data, card statements, reconciliation and logos. Website Stripe billing is implemented and disabled until configured; see [billing setup and validation](billing.md). See [sync API and beta
access setup](sync-api.md) for the feature flag, expiring operator grants and tests.
See [E2EE setup/recovery](e2ee.md) and [cloud sync status](cloud-sync.md)
for the desktop schema review, confirmed encryption decision and remaining work.

## Docker Compose

Run these commands from `site/` with Docker Desktop or Docker Engine running:

```sh
cp .env.compose.example .env.compose
openssl rand -hex 32
openssl rand -hex 32
```

Set the two generated values as `POSTGRES_PASSWORD` and `BETTER_AUTH_SECRET` in
`.env.compose`. Set `RESEND_API_KEY` and `AUTH_EMAIL_FROM` to your Resend key and
verified sender. Beta login is email-only; Google and Apple are disabled.
Environment files are ignored by Git and excluded from Docker builds.

```sh
docker compose --env-file .env.compose up --build -d --wait
docker compose --env-file .env.compose ps -a
docker compose --env-file .env.compose logs --tail=100 service migrate
```

Open `http://localhost:3000`. To change the published port, change both `APP_PORT`
and the port in `BETTER_AUTH_URL`. The services are:

- `db`: PostgreSQL 17 with the `postgres-data` named volume, published on
  `127.0.0.1:5432` for local database clients. Set `POSTGRES_PORT` in `.env.compose`
  to change the host port; the app still connects to `db:5432` internally.
- `migrate`: a one-shot Better Auth schema migration job, started after PostgreSQL
  is healthy. A migration failure prevents the service from starting.
- `service`: the compiled TanStack Start/Nitro website and API, running as a
  non-root user on Node.js. Its health check verifies HTTP service availability.

To open the website from another computer on the same network, set
`APP_BIND_ADDRESS=0.0.0.0` in `.env.compose`, then recreate only the service:

```sh
docker compose --env-file .env.compose up -d --no-deps service
```

Browse to `http://<server-LAN-IP>:3000`. The default bind address remains
`127.0.0.1`; this setting changes only the web service's published interface.
It does not change the auth origin. LAN HTTP sign-in/sync is not supported by the
current auth or native-origin validators, even when the homepage is reachable.

For two-device development using the existing HTTP localhost account/database,
forward port 3000 over SSH from the second computer. SSH access must already be
enabled on the server computer. Replace the username and LAN address:

```sh
ssh -o ExitOnForwardFailure=yes -N -L 127.0.0.1:3000:127.0.0.1:3000 YOUR_USERNAME@192.168.1.143
```

Keep the tunnel running and use `http://localhost:3000` on both computers. Build
the native app on each with `HEYDAY_API_URL=http://localhost:3000` and run
`bun run desktop:dev`. An SSH tunnel works with the default localhost-only Docker
binding too. For packaged/release testing, use a shared HTTPS service and set both
`BETTER_AUTH_URL` and the apps' compile-time `HEYDAY_API_URL` to that same origin.

To connect with TablePlus, DBeaver or another database client, use host
`127.0.0.1`, port `5432` (or `POSTGRES_PORT`), database `heyday`, user `heyday`,
and the existing `POSTGRES_PASSWORD` from your local `.env.compose`. The port is
bound to localhost. Reapply Compose after changing the port; the existing named
volume and database password are preserved.

The local Compose setup explicitly allows an HTTP **loopback** auth origin while
running the production build. It cannot enable public HTTP origins. For Railway,
use an HTTPS `BETTER_AUTH_URL` and omit `AUTH_ALLOW_INSECURE_LOCALHOST`. The default
Dockerfile target is the service image; it respects Railway's `PORT` variable.
The separate `migrate` build target contains the Bun migration runner for a
deployment job. Do not use the final service image as a migration runner.

On an existing database, preview migrations before upgrading:

```sh
docker compose --env-file .env.compose build
docker compose --env-file .env.compose run --rm migrate bun scripts/auth-migrate.ts
```

The next `up` applies the reviewed changes through the migration job. Back up the
database before schema upgrades. PostgreSQL initialization variables only take
effect on a new volume; editing `POSTGRES_PASSWORD` does not rotate an existing
database user's password.

Stop the stack with `docker compose --env-file .env.compose down`. Data remains in
the named volume. `down --volumes` deletes that data, so do not use it for a routine
stop. This setup runs account, device, key and category-sync APIs. Category sync
requires `CLOUD_SYNC_ENABLED=true` plus an explicit beta grant; login grants none.
The migration image includes `scripts/sync-access.ts` (see [setup](sync-api.md)).
Billing remains pending. Complete financial sync requires service migration 0007 and an updated desktop beta.5 build.

The build uses a frozen Bun lockfile and Linux-built artifacts, following the
[Bun Docker guide](https://bun.sh/guides/ecosystem/docker). Startup dependencies
follow [Docker Compose health and completion conditions](https://docs.docker.com/compose/how-tos/startup-order/).

Validated locally with an isolated Compose project: Linux image builds, PostgreSQL
startup, auth and OAuth tables, a seeded PKCE-only native client, repeatable auth migrations, HTTP health checks,
English/Thai pages, social preview PNG and the unauthenticated session endpoint.
Validation used test credentials and sent no email. Live OAuth and Resend delivery
still require your provider configuration.

## Authentication on Railway

The account/device API is documented in [account-api.md](account-api.md).
`bun run auth:migrate --apply` now applies both Better Auth and append-only
account/device/key/sync SQL migrations; run it before deploying updated routes. The
Compose migration image bundles those SQL files. Run `bun run test:postgres`
with a test-only `TEST_DATABASE_URL` for isolated PostgreSQL integration coverage.

Better Auth is mounted at `/api/auth/*` using its TanStack Start integration.
Set the variables in `.env.example` in Railway (or a local ignored `.env`). Never
prefix secrets with `VITE_`. Use an HTTPS public origin for `BETTER_AUTH_URL` in
production. Supply a PostgreSQL `DATABASE_URL`, high-entropy `BETTER_AUTH_SECRET`,
Resend API key and verified sender address. No secrets are required to build the
website. Missing configuration makes auth return a redacted 503 response.

Replace the example `AUTH_EMAIL_FROM` with an address on your verified Resend
domain; `signin@example.com` cannot deliver real login codes. The sending-only
Resend key is sufficient for delivery but cannot list domains or delivery history.
After changing `.env.compose`, recreate the service with
`docker compose --env-file .env.compose up -d service` (a restart alone keeps the
old environment). Rejected deliveries return a 503 instead of displaying a
successful send. Logs include a request ID and safe provider error category/status,
without email addresses, codes, message bodies or credentials. A provider acceptance
still does not guarantee inbox delivery; use Resend's dashboard for delivery events.

Beta exposes only email-code login. Google/Apple credentials are ignored, and
social sign-in requests are rejected. No social-provider setup is required.

Run `bun run auth:migrate` against the intended database to preview schema changes.
After reviewing the SQL and taking a backup for an existing database, run
`bun run auth:migrate --apply` as an explicit deployment step. Migrations never
run on web requests or during builds. This uses the pinned Better Auth version's
migration planner, including the database-backed rate-limit table. Do not run
multiple migration jobs concurrently.

The migration job also seeds the fixed public client `heyday-desktop-beta`, with
S256 PKCE required, no client secret, and `http://127.0.0.1/callback` as its native
loopback URI (the provider permits ephemeral ports). Only this first-party client
skips consent. Dynamic and user-managed client registration are disabled. Reruns
preserve existing client revocations and administrator edits.

The email-code API accepts `POST /api/auth/email-otp/send-verification-otp` with
`{ "email": "user@example.com", "type": "sign-in" }`, followed by
`POST /api/auth/sign-in/email-otp` with `{ "email": "user@example.com", "otp": "123456" }`.
Codes expire after five minutes, are hashed in storage and allow three attempts.
`GET /api/auth/get-session` and `POST /api/auth/sign-out` use the resulting cookie.
Use same-origin requests and retain Better Auth's Origin/CSRF protection.
Implicit account linking is disabled.

The `/login` page sends and verifies codes through Better Auth's client plugins,
which carry the provider's signed OAuth query across login. The desktop opens
`/api/auth/oauth2/authorize` and exchanges the loopback callback's authorization
code at `/api/auth/oauth2/token`; refresh and revocation use the same provider.
Tokens remain in the OS credential store. The page has no analytics and uses a
no-referrer policy. Device binding and key recovery are separate implemented flows;
authentication does not grant premium entitlement or decrypt financial data.

To connect the desktop debug app to Docker, run
`HEYDAY_API_URL=http://localhost:3000 bun run desktop:dev` from `../app` and choose
Settings > Heyday account. Production desktop builds require an HTTPS server
origin; set the compile-time `HEYDAY_API_URL` to your Railway origin when building.

Tests exercise the real Better Auth handler with isolated SQLite and fake email
transport: email login, code replay rejection, required PKCE, wrong verifier
rejection, refresh and revocation. Docker checks cover PostgreSQL migration and
the registered client. Railway proxy/rate-limit behavior, real Resend delivery,
and native credential-store/browser smoke tests remain environment checks.
No messages are sent by the test suite.

With Google Chrome installed and the development server running, `bunx playwright test --workers=1` verifies theme persistence, system preference, download notifications, mobile overflow, and reduced motion. Screenshots are saved in `test-results/`.

The page uses TanStack Start, React, Tailwind CSS v4, and Bun. Framework setup follows the [TanStack Start documentation](https://tanstack.com/start/latest/docs/framework/react/build-from-scratch).

Layout, responsive rules, typography, colors, and component styling use Tailwind utilities in `src/components/Landing.tsx`. `src/styles.css` contains the Tailwind theme tokens, base defaults, and animation keyframes/motion paths. The `dark:` variant follows `data-theme`; the `short:` variant adjusts layouts below 740px viewport height. Shared feature cards use the `FeatureNote` component.

The day/night switch follows the system preference until the visitor chooses a mode, then saves that choice locally. Animations respect reduced-motion preferences.

The macOS button fetches the newest published release, including prereleases, from `https://api.github.com/repos/heyday-money/heyday/releases?per_page=1` when clicked and downloads its DMG (preferring a universal installer). If separate architecture installers are available, no DMG is present, or the request fails or exceeds 10 seconds, it opens the releases page. Windows still shows a coming-soon notification. No GitHub token is required; the repository and releases must be public for the API lookup to succeed.

## Vercel deployment

The Nitro Vite plugin is configured between TanStack Start and React, following [Vercel's TanStack Start guide](https://vercel.com/docs/frameworks/full-stack/tanstack-start). Nitro automatically selects the Vercel preset on Vercel.

Import this repository into Vercel and select the directory containing `package.json` as the project root. Use `bun install --frozen-lockfile` for installation and `bun run build` for the build command. Leave the output directory at the framework default; do not override it to `dist`.

To verify Vercel output locally without deploying, run `NITRO_PRESET=vercel bun run build`. This generates `.vercel/output/` with static assets and the server function. A normal local `bun run build` generates `.output/` for `bun run preview`.

## Languages

English is served at `/` (no `/en` prefix), and Thai at `/th`. The EN/TH links in the footer switch routes; the chosen language stays in the URL on reload and can be shared. Page copy is in `src/i18n.ts`, with localized titles, descriptions, accessibility labels, and document language. Both routes use `src/components/Landing.tsx`.

## House windows

`HouseWindows.tsx` overlays three registered window regions on the original island. The lit sashes slide up for open, unlit daytime windows and down at night; reduced-motion settings make the change immediate. The generated daytime layer is in `public/images/island-day-windows.png`; only its window regions are rendered, preserving the original island and transparency. Created with the built-in imagegen tool using this prompt: “Preserve the original 1536×1024 island and window alignment. Change only the three windows to open vertical sash windows with raised lower sashes, pale blue upper glass, dark unlit interiors, and original wooden frames. No yellow light; preserve all other geometry.”

## Social preview

`/api/og` generates a 1200 × 630 PNG using `@vercel/og` and a PNG copy (`src/heyday-money.png`) of the supplied `src/heyday-money.webp`. The PNG conversion is needed by this renderer; the original WebP is preserved. The original card is embedded in the server bundle, so generation needs no external image fetch or font download. Replace the PNG copy to update the preview. On macOS, regenerate it with `sips -s format png src/heyday-money.webp --out src/heyday-money.png`. Responses cache for one hour in browsers and one day on the CDN.

Both `/` and `/th` include server-rendered Open Graph and Twitter large-image tags with localized titles/descriptions, canonical URLs, and the shared preview. The production origin is `https://heyday.money` in `languageHead` in `src/i18n.ts`. Preview the image at `http://127.0.0.1:3000/api/og`. `@vercel/og` is pinned to 0.8.5 because 1.0.2 ships without the required `hb.wasm` asset. Implementation follows [Vercel’s OG image generation guide](https://vercel.com/docs/og-image-generation).


## Desktop beta.5 ledger sync

The local Docker service is updated through migration `0008_stripe_billing.sql`. Both images
were rebuilt, the migration job completed successfully, and the API/database are
healthy. Rebuild/restart the desktop to load its beta.5 SQLite migration. Existing
category connections require **Add accounts and transactions** confirmation, and financial
connections require **Add income and payroll** confirmation. Active beta grants or
verified Stripe paid/trial access are required; migration or login alone grants no access.

Protocol 3 adds income/deduction aggregates and full payslips while retaining
protocol-1 categories and protocol-2 accounts/ordinary ledger groups. See [sync-api.md](sync-api.md) for bounds, compatibility,
protocol-5 complete metadata and linked-payment management.
Tests use synthetic data in an isolated PostgreSQL schema; no customer payloads
or recovery keys are used. Packaged two-device HTTP/keyring verification remains.

## Income forecast sync

Desktop SQLite migration `0007_income_planner_sync.sql` and service PostgreSQL
migration `0006_income_planner_sync.sql` add protocol-4 income/deduction overrides.
Rebuild/restart the desktop, then choose **Cloud sync → Add income forecasts**.
Existing consent does not upload those forecasts automatically. Source-linked
monthly amounts and cleared overrides sync; protocol 5 adds the other planner settings.
Protocol-3 and older clients must update after the first accepted forecast record.

## Complete financial sync

Apply `0007_complete_sync.sql` with the existing migration runner, or run
`docker compose --env-file .env.compose up --build -d`. The desktop also needs
rebuilding/restarting for SQLite `0008_complete_sync.sql`; existing users confirm
**Add remaining financial data**. Keep the current key and database volume.
Protocol 5 carries encrypted metadata; no plaintext financial tables are added.
Updated clients retry older pending ciphertext unchanged; older apps must update
after the first v5 record. PostgreSQL remains exposed only at `127.0.0.1:5432`
unless `POSTGRES_PORT` selects a different local port.

Tests use disposable PostgreSQL and synthetic identities with a fake email sender.
No real grant, customer upload or OTP email is created by the regression suite.
