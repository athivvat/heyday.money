# Website subscriptions with Stripe

Subscription purchase and management live at `/account`. Sign in with the same
email used in the desktop app. The app's **Manage subscription on website** button
opens this page on its configured API origin. Browser sessions authenticate
independently; the URL contains no native tokens, account details, or financial data.

Local sandbox configuration verified on 2026-11-04: **THB 49/month or THB 499/year,
with a 60-day trial**. Both local environment files contain the real sandbox Price
IDs and enable billing and cloud sync. Docker uses `.env.compose`, whose signing secret belongs to
the local Stripe CLI listener; `.env` retains the dashboard webhook's signing secret.
Use the correct signing secret for each endpoint when deploying or changing how
events are delivered. Environment examples still default to disabled billing and no
trial; those are setup defaults, not the selected local configuration.

Real sandbox Checkout creation (zero trial total, payment method required) and portal
creation passed. The temporary uncompleted checkout/customer were cleaned up, with
no payment made. A synthetic `invoice.voided` event reached the local webhook and
returned HTTP 200. A website-account checkout has now produced an active stored
trial. The account page confirms an active trial with its end date; the pending
checkout message appears only until subscription status is confirmed. Resulting native sync
access, renewal/failure, and end-of-trial/cancellation behavior still need the full
sandbox round trip described below. Live payments are not enabled.

## Product behavior

- Currency is **THB**. Configure a monthly and/or yearly fixed recurring Price in
  Stripe; the account page and checkout read its actual amount. The homepage
  advertises the selected offer from `src/pricing.ts`: ฿49/month or ฿499/year with
  a 60-day trial. Update that public offer alongside any Stripe price or trial
  configuration changes. It does not set checkout amounts or trial eligibility.
- `STRIPE_TRIAL_DAYS=0` disables trials by default. A configured trial requires a
  card and is offered only before an account's first subscription. Existing/canceled
  subscribers do not receive another trial. Finishing a trial renews at the selected
  Stripe price unless canceled; Stripe hosts collection and payment authentication.
- An active supported subscription grants access through its current paid period
  only when its latest invoice is paid. A trial grants access only through its end.
- Cancellation is **at period end**. The portal configuration is checked before it
  opens, and an immediate-cancellation configuration is rejected. An operator's
  immediate cancellation in Stripe ends access on reconciliation.
- `past_due`, `unpaid`, `incomplete`, `incomplete_expired`, `paused`, canceled, or
  paused payment collection do not grant access. There is no additional grace period.
- Expiry pauses push, pull, and snapshot. Local use remains available and encrypted
  cloud data is retained without an automatic deletion deadline. Resubscription
  restores sync eligibility; enablement and encryption consent remain separate.
- There are no plan-based device or total-storage quotas. Existing technical
  request-size and rate limits remain. Explicit operator beta grants continue to
  work independently; revoking one does not revoke a paid subscription and vice versa.
- No financial records or keys are sent to Stripe. Billing stores customer,
  subscription, price, status, period dates, and webhook receipt IDs separately.

## Configuration

1. Apply the additive `0008_stripe_billing.sql` with `bun run auth:migrate --apply`
   before running the updated service. Never edit earlier migrations.
2. In a Stripe sandbox, create the Heyday cloud-sync product with fixed, licensed,
   per-unit **THB** prices: interval month/year, interval count 1. At least one price
   is required. Set `STRIPE_PRICE_MONTHLY` and/or `STRIPE_PRICE_YEARLY`. When replacing
   prices, retain old IDs in comma-separated `STRIPE_LEGACY_PRICE_IDS` while their
   subscribers remain eligible. Do not delete an old allowed ID during a price change.
3. Set the server-only `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. Never use
   `VITE_*` variables, browser storage, or committed `.env` files for these values.
4. Configure the [Stripe customer portal](https://docs.stripe.com/customer-management/integrate-customer-portal):
   payment-method updates, invoice history, and subscription cancellation **at period
   end**. Use the default configuration or set `STRIPE_PORTAL_CONFIGURATION_ID`.
   If allowing plan changes, restrict the catalog to these supported prices and
   quantity 1; configure collection/proration deliberately. The app does not choose
   tax treatment or enable discounts; verify Stripe tax and invoice settings before sale.
5. Register a **snapshot** webhook for this Stripe account at
   `https://heyday.money/api/webhooks/billing`, API version `2026-10-28.endive`
   (pinned with SDK `stripe@23.1.0`). Enable:
   - `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`
   - `customer.subscription.created`, `.updated`, `.deleted`, `.paused`, `.resumed`,
     `.trial_will_end`
   - `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`,
     `invoice.finalization_failed`, `invoice.marked_uncollectible`, `invoice.voided`
6. Set `STRIPE_BILLING_ENABLED=true` once configured. Set `CLOUD_SYNC_ENABLED=true`
   to enable sync independently. Keep the correct HTTPS `BETTER_AUTH_URL`; it is the
   fixed origin for return URLs. Sandbox and live keys/prices/webhooks/configurations
   are separate. Set the chosen trial duration only when ready; its default is zero.

Compose passes the same server-only values from `.env.compose`. Rebuild and migrate:

```sh
docker compose --env-file .env.compose up --build -d
```

For a local sandbox webhook, use the [Stripe CLI](https://docs.stripe.com/webhooks#test-your-handler):

```sh
stripe listen --forward-to localhost:3000/api/webhooks/billing
```

Use the CLI's signing secret for local testing. Synthetic `stripe trigger` customers
are unrelated to Heyday accounts and are intentionally ignored. To exercise access,
complete Checkout from an authenticated `/account` using Stripe test payment details.
No real purchases, emails, production deployment, or Stripe configuration are created
by the automated tests.

## APIs and reliability

| Method | Endpoint | Authentication / behavior |
| --- | --- | --- |
| GET | `/api/billing/` | Verified website session; current status, THB prices and sync entitlement |
| POST | `/api/billing/checkout` | Same-origin verified website session; body `{ "plan": "monthly" }` or `yearly` |
| POST | `/api/billing/portal` | Same-origin verified website session; empty object body |
| POST | `/api/webhooks/billing` | Stripe signature over bounded original bytes, timestamp tolerance, mode/account checks |

These billing routes do not accept desktop Bearer authentication. Account, customer,
price ID, and redirect URL cannot be supplied by the browser. Private API responses
use `no-store`; mutations require exact Origin and bounded JSON with no extra fields.
Billing API requests are limited to 30 per account/minute. Native `/api/v1/me`
advertises billing availability and `subscription`/`trial`/`beta_access` entitlement.
All sync operations read the same entitlement function with database-clock expiry.

Customer and checkout operation IDs are persisted before contacting Stripe. Lost
responses retry the same idempotency key and parameters. Lost checkout responses can
also be located by their persisted operation ID in Stripe metadata. Open checkouts
are reused and configured to expire after one hour; selecting a different plan while one is pending asks the user to finish
it or wait for expiry. The provider's session status is checked before replacement,
so local clock differences cannot replace a still-open checkout. An ongoing
subscription blocks another checkout. Customer
creation with an ambiguous response older than 23 hours stops for operator review
because Stripe may prune its idempotency key after 24 hours. Inspect Stripe for the
persisted `customer_key` request and `heyday_user_id` metadata; bind the confirmed
customer to that account after checking ownership instead of generating a new key.

Webhooks use [Stripe signature verification and retry semantics](https://docs.stripe.com/webhooks).
A per-account PostgreSQL lock serializes billing operations. Each supported event
fetches **current** subscriptions from Stripe rather than applying its stale event
snapshot. Ownership comes exclusively from the persisted customer binding. Events
for unrelated customers are ignored. Subscription state and the event receipt commit
atomically; failure returns a non-success response for retry. Duplicate receipts are
acknowledged without applying them again. No raw webhook body or payment details are
stored or logged. Opening/refreshing `/account` also reconciles current Stripe state;
a checkout return URL never grants entitlement.

For missed deliveries, `bun run billing:reconcile` refreshes all known customers
without creating subscriptions or payments. It reports aggregate success/failure
counts and exits nonzero on failures. Run it after webhook outages; configure a
scheduled job in deployment if desired (no schedule is enabled by this change).
The optional Compose profile uses the migration image and the same credentials:

```sh
docker compose --env-file .env.compose --profile billing run --rm --build billing-reconcile
```

Monitor webhook delivery failures and reconciliation failures. A missed renewal can
temporarily pause sync at the saved paid-period boundary until reconciliation; it
cannot extend access indefinitely. Disabling billing prevents purchases and webhook
processing; saved access expires normally. The independent sync switch pauses all sync.
Stripe dispute/refund policy and automated fraud actions are separate future product
decisions; use subscription cancellation for access revocation when needed.

## Verification and activation checklist

Automated API tests cover signature/body/timestamp rejection, session/CSRF/ownership
validation and entitlement policy. Isolated PostgreSQL schemas cover customer and
checkout lost responses, reuse, concurrency, rollback, duplicate/out-of-order events,
payment failure/recovery, cancellation, expiry, trial reuse prevention, beta grants,
and paid access for push/pull/snapshot. Browser tests mock billing/auth responses and
cover login return, checkout errors, portal navigation, expiry, and narrow light/dark
layouts. Test prices in those fixtures are examples, not production pricing.

Before taking payments, configure actual THB prices and verify the sandbox round trip:
checkout/payment authentication → verified webhook → desktop manual sync; renewal and
failed renewal; portal cancellation → paid-period end; trial end if enabled; expired
account → resubscribe; webhook retry/outage recovery. Verify invoices, currency/tax
display and portal policy. Then configure and test live-mode credentials separately.
