import { test } from 'node:test'
import assert from 'node:assert/strict'
import Stripe from 'stripe'
import { billingConfig } from '../../src/server/billing/config'
import { StripeGateway, subscriptionState } from '../../src/server/billing/gateway'
import { billingHandler, webhookHandler } from '../../src/server/billing/handler'
import type { BillingService } from '../../src/server/billing/service'

const env = { STRIPE_BILLING_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_example', STRIPE_WEBHOOK_SECRET: 'whsec_example',
  BETTER_AUTH_URL: 'https://heyday.example', STRIPE_PRICE_MONTHLY: 'price_month', STRIPE_PRICE_YEARLY: 'price_year' }
const config = billingConfig(env)!

test('billing is opt-in, THB prices are server configured, and trials default off', () => {
  assert.equal(billingConfig({}), null)
  assert.equal(config.trialDays, 0)
  assert.equal(config.live, false)
  for (const change of [{ STRIPE_SECRET_KEY: '' }, { STRIPE_WEBHOOK_SECRET: 'bad' }, { STRIPE_TRIAL_DAYS: '731' },
    { STRIPE_TRIAL_DAYS: '-1' }, { STRIPE_PRICE_MONTHLY: 'client-price' }, { BETTER_AUTH_URL: 'https://heyday.example/evil' }]) {
    assert.throws(() => billingConfig({ ...env, ...change }))
  }
  assert.equal(billingConfig({ ...env, STRIPE_TRIAL_DAYS: '14' })!.trialDays, 14)
})

test('only paid, eligible Stripe subscriptions or unexpired trials grant bounded access', () => {
  const subscription = { id: 'sub_1', status: 'active', items: { data: [{ quantity: 1, current_period_end: 2000,
    price: { id: 'price_month', currency: 'thb', type: 'recurring' } }] }, latest_invoice: { status: 'paid' },
    pause_collection: null, cancel_at: null, cancel_at_period_end: false } as unknown as Stripe.Subscription
  assert.equal(subscriptionState(subscription, config).accessUntil, 2000)
  assert.equal(subscriptionState({ ...subscription, cancel_at_period_end: true }, config).accessUntil, 2000)
  assert.equal(subscriptionState({ ...subscription, cancel_at: 1500 }, config).accessUntil, 1500)
  for (const status of ['past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'canceled', 'paused'] as const) {
    assert.equal(subscriptionState({ ...subscription, status }, config).accessUntil, null)
  }
  assert.equal(subscriptionState({ ...subscription, status: 'trialing', trial_end: 1800 }, config).accessUntil, 1800)
  assert.equal(subscriptionState({ ...subscription, latest_invoice: 'in_unexpanded' }, config).accessUntil, null)
  assert.equal(subscriptionState({ ...subscription, latest_invoice: { status: 'open' } as Stripe.Invoice }, config).accessUntil, null)
  assert.equal(subscriptionState({ ...subscription, pause_collection: { behavior: 'void' } }, config).accessUntil, null)
  const foreign = structuredClone(subscription)
  foreign.items.data[0].price.id = 'price_other'
  assert.equal(subscriptionState(foreign, config).accessUntil, null)
  foreign.items.data[0].price.id = 'price_month'; foreign.items.data[0].price.currency = 'usd'
  assert.equal(subscriptionState(foreign, config).accessUntil, null)
})

test('website billing requires verified cookie sessions, same-origin POST, and rejects ownership/price injection', async () => {
  const calls: unknown[] = []
  const service = { checkout: (...args: unknown[]) => { calls.push(args); return { url: 'https://checkout.stripe.com/example' } } } as unknown as BillingService
  const handle = billingHandler(service, async headers => headers.get('cookie') === 'session=verified'
    ? { user: { id: 'alice', emailVerified: true }, session: { id: 'session-alice' } } : null, config.origin)
  const request = (body: unknown, origin: string | null = config.origin, cookie = 'session=verified') => new Request(`${config.origin}/api/billing/checkout`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}), cookie, authorization: 'Bearer not-a-browser-session' }, body: JSON.stringify(body),
  })
  for (const origin of [null, 'https://evil.example']) assert.equal((await handle(request({ plan: 'monthly' }, origin), 'checkout')).status, 400)
  assert.equal((await handle(request({ plan: 'monthly' }, config.origin, ''), 'checkout')).status, 401)
  assert.equal((await handle(request({ plan: 'monthly', userId: 'bob' }), 'checkout')).status, 400)
  assert.equal((await handle(request({ plan: 'monthly', priceId: 'price_cheap' }), 'checkout')).status, 400)
  assert.equal((await handle(request({ plan: 'monthly', returnUrl: 'https://evil.example' }), 'checkout')).status, 400)
  const result = await handle(request({ plan: 'monthly' }), 'checkout')
  assert.equal(result.status, 200)
  assert.equal(result.headers.get('cache-control'), 'private, no-store')
  assert.deepEqual(calls, [[{ userId: 'alice', sessionId: 'session-alice' }, 'monthly']])
})

test('Stripe SDK verifies exact raw webhook bytes, rejects tampering, stale signatures, and oversized streams', async () => {
  const stripe = new Stripe(config.secret)
  let calls = 0
  const service = { webhook: async () => { calls++; return { received: true } } } as unknown as BillingService
  const handle = webhookHandler(service, new StripeGateway(config))
  const payload = JSON.stringify({ id: 'evt_example', object: 'event', type: 'customer.subscription.updated', livemode: false,
    data: { object: { customer: 'cus_example' } } })
  const signed = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: config.webhookSecret })
  const request = (body = payload, signature = signed) => new Request(`${config.origin}/api/webhooks/billing`, { method: 'POST', headers: { 'stripe-signature': signature }, body })
  assert.equal((await handle(request())).status, 200)
  assert.equal((await handle(request(`${payload} `))).status, 400)
  const stale = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: config.webhookSecret, timestamp: Math.floor(Date.now() / 1000) - 600 })
  assert.equal((await handle(request(payload, stale))).status, 400)
  assert.equal((await handle(request('x'.repeat(1024 * 1024 + 1)))).status, 413)
  assert.equal(calls, 1)
})

test('Stripe SDK requests restrict currency, checkout payment methods and cancellation timing', async () => {
  let currency = 'thb', cancellation = 'at_period_end'
  const requests: { path: string; body: URLSearchParams; key: string | null }[] = []
  const client = new Stripe(config.secret, { httpClient: Stripe.createFetchHttpClient(async (input, init) => {
    const url = new URL(String(input)), body = new URLSearchParams(String(init?.body ?? ''))
    requests.push({ path: url.pathname, body, key: new Headers(init?.headers).get('idempotency-key') })
    if (url.pathname.startsWith('/v1/prices/')) return Response.json({ id: url.pathname.split('/').at(-1), active: true, livemode: false,
      currency, type: 'recurring', recurring: { interval: url.pathname.endsWith('month') ? 'month' : 'year', interval_count: 1, usage_type: 'licensed' }, billing_scheme: 'per_unit', unit_amount: 9900 })
    if (url.pathname === '/v1/checkout/sessions') return Response.json({ id: 'cs_example', url: 'https://checkout.stripe.com/example', status: 'open', expires_at: 2000 })
    if (url.pathname === '/v1/billing_portal/configurations') return Response.json({ data: [{ id: 'bpc_default', active: true, livemode: false, features: { subscription_cancel: { enabled: true, mode: cancellation } } }] })
    if (url.pathname === '/v1/billing_portal/sessions') return Response.json({ url: 'https://billing.stripe.com/example' })
    throw new Error('Unexpected Stripe request')
  }) })
  const gateway = new StripeGateway(config, client)
  assert.equal((await gateway.prices())[0].currency, 'thb')
  currency = 'usd'
  await assert.rejects(gateway.prices(), { code: 'UNAVAILABLE' })
  await gateway.checkout('cus_alice', 'price_month', 0, 'stable-key', 2000)
  const checkout = requests.find(r => r.path === '/v1/checkout/sessions')!
  assert.equal(checkout.body.get('allowed_payment_method_types[0]'), 'card')
  assert.equal(checkout.body.get('customer'), 'cus_alice')
  assert.equal(checkout.body.get('line_items[0][price]'), 'price_month')
  assert.equal(checkout.body.get('subscription_data[trial_period_days]'), null)
  assert.equal(checkout.body.get('success_url'), `${config.origin}/account?checkout=success`)
  assert.equal(checkout.key, 'checkout:stable-key')
  assert.equal(await gateway.portal('cus_alice'), 'https://billing.stripe.com/example')
  cancellation = 'immediately'
  await assert.rejects(gateway.portal('cus_alice'), { code: 'UNAVAILABLE' })
  assert.equal(requests.filter(r => r.path === '/v1/billing_portal/sessions').length, 1)
})
