-- Billing metadata only; encrypted financial data and beta grants are untouched.
CREATE TABLE billing_accounts (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  customer_key uuid NOT NULL,
  customer_id text UNIQUE,
  customer_started_at timestamptz,
  customer_email text,
  trial_used boolean NOT NULL DEFAULT false,
  checkout_key uuid,
  checkout_started_at timestamptz,
  checkout_price_id text,
  checkout_trial_days integer,
  checkout_session_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE billing_subscriptions (
  subscription_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES billing_accounts(user_id) ON DELETE CASCADE,
  status text NOT NULL,
  price_id text,
  period_end timestamptz,
  cancel_at timestamptz,
  access_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_subscriptions_owner ON billing_subscriptions(user_id);

-- Record receipts only after current Stripe state and entitlement commit together.
CREATE TABLE billing_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE billing_api_usage (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  requests integer NOT NULL
);
