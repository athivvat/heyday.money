import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { betterAuth } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import type Stripe from 'stripe'
import { authOptions } from '../../src/server/auth/options'
import { migrateCloud } from '../../src/server/db/migrate'
import { billingConfig } from '../../src/server/billing/config'
import { BillingService } from '../../src/server/billing/service'
import { billingHandler } from '../../src/server/billing/handler'
import type { BillingGateway, CheckoutState, SubscriptionState } from '../../src/server/billing/gateway'
import { syncEntitlement } from '../../src/server/billing/entitlement'
import { DeviceService } from '../../src/server/devices/service'
import { SyncService } from '../../src/server/sync/service'
import { commitData, type Mutation } from '../../src/contracts/v1/sync'

test('PostgreSQL website billing: retries, ownership, verified renewal, cancellation, expiry and recovery', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  const schema = `billing_test_${randomUUID().replaceAll('-', '')}`
  await admin.query(`CREATE SCHEMA "${schema}"`)
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 6, options: `-c search_path=${schema}` })
  const origin = 'http://localhost:3000'
  const codes = new Map<string, string>()
  const options = authOptions({ url: origin, secret: 'test-billing-secret-01234567890123456789', databaseUrl: '', resendApiKey: '', emailFrom: '' }, pool,
    async ({ email, otp }) => { codes.set(email, otp) })
  options.rateLimit.enabled = false
  try {
    await (await getMigrations(options)).runMigrations()
    await migrateCloud(pool, true)
    const auth = betterAuth(options)
    async function login(email: string) {
      const post = (path: string, body: unknown) => auth.handler(new Request(`${origin}/api/auth${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) }))
      await post('/email-otp/send-verification-otp', { email, type: 'sign-in' })
      const response = await post('/sign-in/email-otp', { email, otp: codes.get(email) })
      assert.equal(response.status, 200)
      const cookie = response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
      const session = (await auth.api.getSession({ headers: new Headers({ cookie }) }))!
      assert.ok(session)
      return { cookie, identity: { userId: session.user.id, sessionId: session.session.id } }
    }
    const alice = await login('billing-alice@example.test'), bob = await login('billing-bob@example.test')
    const config = billingConfig({ STRIPE_BILLING_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_example', STRIPE_WEBHOOK_SECRET: 'whsec_example',
      BETTER_AUTH_URL: origin, STRIPE_PRICE_MONTHLY: 'price_month', STRIPE_PRICE_YEARLY: 'price_year', STRIPE_TRIAL_DAYS: '14' })!
    const subscriptions = new Map<string, SubscriptionState[]>()
    const sessions = new Map<string, CheckoutState>()
    const checkoutKeys: string[] = [], customerKeys: string[] = [], trialDays: number[] = [], portalCustomers: string[] = []
    let loseCustomer = true, loseCheckout = true, stripeUnavailable = false, lookupLag = true
    const gateway: BillingGateway = {
      customer: async (_user, _email, key) => { customerKeys.push(key); if (loseCustomer) { loseCustomer = false; throw new Error('Lost customer response') } return `cus_${key}` },
      prices: async () => [{ id: 'monthly', amount: 9900, currency: 'thb', interval: 'month' }, { id: 'yearly', amount: 99000, currency: 'thb', interval: 'year' }],
      subscriptions: async customer => { if (stripeUnavailable) throw new Error('Stripe unavailable'); return subscriptions.get(customer) ?? [] },
      checkout: async (_customer, _price, days, key, expiresAt) => {
        checkoutKeys.push(key); trialDays.push(days)
        const session = { id: `cs_${key}`, url: `https://checkout.stripe.com/${key}`, status: 'open', expiresAt, subscriptionId: null }
        sessions.set(session.id, session)
        if (loseCheckout) { loseCheckout = false; throw new Error('Lost checkout response') }
        return session
      },
      checkoutStatus: async id => sessions.get(id)!,
      findCheckout: async (_customer, key) => { if (lookupLag) { lookupLag = false; return null } return sessions.get(`cs_${key}`) ?? null },
      portal: async customer => { portalCustomers.push(customer); return 'https://billing.stripe.com/session' },
      verify: () => { throw new Error('Verified separately by SDK tests') },
    }
    const service = new BillingService(pool, config, gateway, true)
    const handle = billingHandler(service, headers => auth.api.getSession({ headers }), origin)
    const call = (who: typeof alice, action: 'summary' | 'checkout' | 'portal', body = {}) => handle(new Request(`${origin}/api/billing/`, {
      method: action === 'summary' ? 'GET' : 'POST', headers: { cookie: who.cookie, origin, 'content-type': 'application/json' },
      ...(action === 'summary' ? {} : { body: JSON.stringify(body) }),
    }), action)
    assert.equal((await (await call(alice, 'summary')).json()).entitlement.canSync, false)
    assert.equal((await call(alice, 'checkout', { plan: 'monthly' })).status, 500) // Lost customer response.
    assert.equal((await call(alice, 'checkout', { plan: 'monthly' })).status, 500) // Lost checkout response.
    const checkout = await call(alice, 'checkout', { plan: 'monthly' })
    assert.equal(checkout.status, 200)
    assert.equal(new Set(customerKeys).size, 1)
    assert.equal(new Set(checkoutKeys).size, 1)
    assert.deepEqual(trialDays, [14, 14])
    assert.equal((await call(alice, 'checkout', { plan: 'yearly' })).status, 409)
    const repeat = await call(alice, 'checkout', { plan: 'monthly' })
    assert.deepEqual(await repeat.json(), await checkout.json())
    assert.equal(checkoutKeys.length, 2) // Reuses the existing open session, no third create.
    await pool.query("UPDATE billing_accounts SET checkout_started_at=now()-interval '2 hours' WHERE user_id=$1", [alice.identity.userId])
    assert.equal((await call(alice, 'checkout', { plan: 'monthly' })).status, 200)
    assert.equal(checkoutKeys.length, 2) // A fast local clock never replaces a still-open Stripe checkout.
    const lock = await pool.connect()
    const lockKey = `heyday-billing:${alice.identity.userId}`
    try {
      await lock.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [lockKey])
      assert.equal((await call(alice, 'checkout', { plan: 'monthly' })).status, 429)
      assert.equal(checkoutKeys.length, 2)
    } finally { await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lockKey]); lock.release() }
    const customer = (await pool.query('SELECT customer_id FROM billing_accounts WHERE user_id=$1', [alice.identity.userId])).rows[0].customer_id
    const now = Math.floor(Date.now() / 1000), end = now + 3600
    const paid: SubscriptionState = { id: 'sub_alice', status: 'active', priceId: 'price_month', periodEnd: end, cancelAt: null, accessUntil: end }
    subscriptions.set(customer, [paid])
    for (const session of sessions.values()) { session.status = 'complete'; session.subscriptionId = paid.id }
    const event = (id: string, type = 'customer.subscription.updated', owner = customer) => ({ id, type, livemode: false,
      data: { object: { customer: owner, status: 'trialing', metadata: { heyday_user_id: bob.identity.userId } } } } as unknown as Stripe.Event)
    await service.webhook(event('evt_paid'))
    const entitled = async (id = alice.identity.userId) => { const db = await pool.connect(); try { return await syncEntitlement(db, id, true) } finally { db.release() } }
    const devices = new DeviceService(pool)
    const desktop = () => devices.me(alice.identity)
    const syncEnabled = process.env.CLOUD_SYNC_ENABLED === 'true'
    const activeDesktop = await desktop()
    assert.equal(activeDesktop.entitlement.canSync, syncEnabled)
    assert.deepEqual(activeDesktop.billing.subscriptions, [{ status: 'active', periodEnd: new Date(end * 1000).toISOString(), cancelAt: null }])
    assert.equal(JSON.stringify(activeDesktop).includes(customer), false)
    assert.equal(JSON.stringify(activeDesktop).includes(paid.id), false)
    assert.deepEqual((await devices.me(bob.identity)).billing.subscriptions, [])
    assert.equal((await devices.me(bob.identity)).entitlement.canSync, false)
    await devices.register(alice.identity, { installationId: randomUUID(), name: 'Billing integration fixture', platform: 'macos' })
    const datasetId = activeDesktop.dataset.id
    const key = { ...JSON.parse(readFileSync(new URL('../fixtures/e2ee-v1.json', import.meta.url), 'utf8')).envelope, datasetId }
    await devices.keys(alice.identity, key)
    const sync = new SyncService(devices, true)
    const request = JSON.parse(readFileSync(new URL('../fixtures/sync-v1.json', import.meta.url), 'utf8')).change.request
    const mutation: Mutation = { ...request, datasetId, mutationId: randomUUID(), payload: { ...request.payload, keyId: key.keyId }, commitHash: '' }
    mutation.commitHash = createHash('sha256').update(commitData(mutation)).digest('hex')
    const pull = () => sync.page(alice.identity, new URL(`http://localhost:3000/api/v1/sync/pull?datasetId=${datasetId}`))
    assert.equal((await sync.push(alice.identity, mutation)).kind, 'accepted')
    assert.deepEqual((await pull()).changes[0].request, mutation)
    assert.equal((await entitled()).reason, 'subscription')
    assert.equal((await entitled(bob.identity.userId)).canSync, false) // Event metadata cannot reassign ownership.
    assert.equal((await call(bob, 'portal')).status, 404)
    assert.equal((await call(alice, 'portal')).status, 200)
    assert.deepEqual(portalCustomers, [customer])
    assert.equal((await call(alice, 'checkout', { plan: 'monthly' })).status, 409)
    await service.webhook(event('evt_paid'))
    assert.equal((await pool.query('SELECT count(*) FROM billing_events')).rows[0].count, '1')
    subscriptions.set(customer, [{ ...paid, cancelAt: end }])
    await service.webhook(event('evt_cancel_scheduled'))
    assert.equal((await entitled()).canSync, true)
    assert.equal((await desktop()).entitlement.canSync, syncEnabled)
    assert.equal((await desktop()).billing.subscriptions[0].cancelAt, new Date(end * 1000).toISOString())
    assert.equal((await pull()).changes.length, 1)
    subscriptions.set(customer, [{ ...paid, status: 'past_due', accessUntil: null }])
    await pool.query("CREATE FUNCTION reject_billing_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$")
    await pool.query('CREATE TRIGGER reject_receipt BEFORE INSERT ON billing_events FOR EACH ROW EXECUTE FUNCTION reject_billing_receipt()')
    await assert.rejects(service.webhook(event('evt_payment_failed', 'invoice.payment_failed')))
    assert.equal((await entitled()).canSync, true) // Receipt failure rolls back entitlement too.
    await pool.query('DROP TRIGGER reject_receipt ON billing_events')
    await service.webhook(event('evt_payment_failed', 'invoice.payment_failed'))
    assert.equal((await entitled()).canSync, false)
    assert.equal((await desktop()).entitlement.canSync, false)
    assert.equal((await desktop()).billing.subscriptions[0].status, 'past_due')
    await assert.rejects(pull(), { code: 'PREMIUM_REQUIRED' })
    await assert.rejects(sync.push(alice.identity, mutation), { code: 'PREMIUM_REQUIRED' })
    assert.equal((await pool.query('SELECT count(*) FROM cloud_sync_records WHERE dataset_id=$1', [datasetId])).rows[0].count, '1')
    // A late earlier event must fetch current state, not apply its stale active snapshot.
    await service.webhook(event('evt_late_paid', 'invoice.paid'))
    assert.equal((await entitled()).canSync, false)
    subscriptions.set(customer, [paid])
    stripeUnavailable = true
    await assert.rejects(service.webhook(event('evt_retry')))
    assert.equal((await pool.query("SELECT 1 FROM billing_events WHERE event_id='evt_retry'")).rowCount, 0)
    stripeUnavailable = false
    await service.webhook(event('evt_retry'))
    assert.equal((await entitled()).canSync, true)
    assert.equal((await desktop()).entitlement.canSync, syncEnabled)
    subscriptions.set(customer, [{ ...paid, status: 'trialing', accessUntil: now + 300 }])
    assert.deepEqual((await pull()).changes[0].request, mutation)
    await service.refreshCustomer(alice.identity.userId) // Operator job uses the same reconciler.
    assert.equal((await entitled()).reason, 'trial')
    assert.equal((await desktop()).billing.subscriptions[0].status, 'trialing')
    assert.equal((await desktop()).entitlement.reason, syncEnabled ? 'trial' : 'not_configured')
    // Access expires at the DB clock even without an end-of-period webhook.
    await pool.query("UPDATE billing_subscriptions SET access_until=now()-interval '1 second'")
    assert.equal((await entitled()).canSync, false)
    assert.equal((await desktop()).entitlement.canSync, false)
    await assert.rejects(pull(), { code: 'PREMIUM_REQUIRED' })
    subscriptions.set(customer, [{ ...paid, status: 'canceled', accessUntil: null }])
    await service.webhook(event('evt_ended', 'customer.subscription.deleted'))
    assert.equal((await entitled()).canSync, false)
    await pool.query("UPDATE billing_accounts SET checkout_started_at=now()-interval '2 hours' WHERE user_id=$1", [alice.identity.userId])
    assert.equal((await call(alice, 'checkout', { plan: 'monthly' })).status, 200)
    assert.equal(trialDays.at(-1), 0) // No repeated trial after cancellation.
    await pool.query("INSERT INTO cloud_sync_entitlements(user_id,access_until) VALUES($1,now()+interval '1 day')", [alice.identity.userId])
    assert.equal((await entitled()).reason, 'beta_access') // Independent operator grants survive Stripe cancellation.
    await assert.rejects(service.webhook({ ...event('evt_live'), livemode: true }), { code: 'VALIDATION_FAILED' })
    await pool.query('DELETE FROM "session" WHERE id=$1', [alice.identity.sessionId])
    assert.equal((await call(alice, 'portal')).status, 401)
  } finally {
    await pool.end()
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`)
    await admin.end()
  }
})
