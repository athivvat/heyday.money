import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type Stripe from 'stripe'
import { ApiError } from '../api/http'
import type { DesktopIdentity } from '../devices/service'
import type { BillingConfig } from './config'
import { billingEvents, type BillingGateway, type SubscriptionState } from './gateway'
import { syncEntitlement } from './entitlement'
import type { BillingPlan, BillingSummary } from '../../contracts/v1/billing'

interface BillingAccount {
  customer_id: string | null; customer_key: string; customer_started_at: Date | null; customer_email: string | null
  trial_used: boolean; checkout_key: string | null; checkout_started_at: Date | null
  checkout_price_id: string | null; checkout_trial_days: number | null; checkout_session_id: string | null
}
const ongoing = (status: string) => !['canceled', 'incomplete_expired'].includes(status)

export class BillingService {
  constructor(private pool: Pool, private config: BillingConfig | null, private gateway: BillingGateway | null,
    private syncEnabled = process.env.CLOUD_SYNC_ENABLED === 'true') {}

  private async locked<T>(userId: string, action: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect()
    const key = `heyday-billing:${userId}`
    let locked = false
    let broken = false
    try {
      locked = (await db.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [key])).rows[0].locked
      if (!locked) throw new ApiError('RATE_LIMITED', 'Billing is already updating. Please try again shortly.')
      return await action(db)
    } finally {
      try { if (locked) await db.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]) }
      catch { broken = true }
      db.release(broken)
    }
  }

  private async account<T>(identity: DesktopIdentity, action: (db: PoolClient, email: string) => Promise<T>) {
    const quota = await this.pool.query(`INSERT INTO billing_api_usage(user_id,window_start,requests)
      VALUES($1,date_trunc('minute',now()),1) ON CONFLICT(user_id) DO UPDATE SET
      requests=CASE WHEN billing_api_usage.window_start=EXCLUDED.window_start THEN billing_api_usage.requests+1 ELSE 1 END,
      window_start=EXCLUDED.window_start RETURNING requests`, [identity.userId])
    if (quota.rows[0].requests > 30) throw new ApiError('RATE_LIMITED', 'Too many billing requests. Please try again shortly.')
    return this.locked(identity.userId, async db => {
      const user = (await db.query(`SELECT u.email FROM "user" u JOIN "session" s ON s."userId"=u.id
        WHERE u.id=$1 AND s.id=$2 AND s."expiresAt">clock_timestamp() AND u."emailVerified"=true`, [identity.userId, identity.sessionId])).rows[0]
      if (!user) throw new ApiError('AUTH_EXPIRED', 'Sign in again to manage your subscription.')
      return action(db, user.email)
    })
  }

  private async row(db: PoolClient, userId: string): Promise<BillingAccount | undefined> {
    return (await db.query('SELECT * FROM billing_accounts WHERE user_id=$1', [userId])).rows[0]
  }

  /** Fetch current provider state under the customer lock; never apply stale event snapshots. */
  private async reconcile(db: PoolClient, userId: string, customer: string, event?: Stripe.Event) {
    const subscriptions = await this.gateway!.subscriptions(customer)
    await db.query('BEGIN')
    try {
      await db.query('DELETE FROM billing_subscriptions WHERE user_id=$1', [userId])
      for (const sub of subscriptions) await db.query(`INSERT INTO billing_subscriptions
        (subscription_id,user_id,status,price_id,period_end,cancel_at,access_until) VALUES($1,$2,$3,$4,to_timestamp($5),to_timestamp($6),to_timestamp($7))`,
      [sub.id, userId, sub.status, sub.priceId, sub.periodEnd, sub.cancelAt, sub.accessUntil])
      if (subscriptions.length) await db.query('UPDATE billing_accounts SET trial_used=true,updated_at=now() WHERE user_id=$1', [userId])
      if (event) await db.query('INSERT INTO billing_events(event_id,event_type) VALUES($1,$2) ON CONFLICT DO NOTHING', [event.id, event.type])
      await db.query('COMMIT')
    } catch (error) { await db.query('ROLLBACK'); throw error }
    return subscriptions
  }

  summary(identity: DesktopIdentity): Promise<BillingSummary> {
    return this.account(identity, async (db, email) => {
      const row = await this.row(db, identity.userId)
      let subscriptions: SubscriptionState[] = []
      if (this.gateway && row?.customer_id) subscriptions = await this.reconcile(db, identity.userId, row.customer_id)
      // Existing subscribers can manage billing even if a sale price was retired.
      const plans = this.gateway && !subscriptions.some(s => ongoing(s.status)) ? await this.gateway.prices() : []
      return {
        account: { email }, enabled: !!this.config, plans,
        trialDays: !row?.trial_used && !subscriptions.length ? this.config?.trialDays ?? 0 : 0,
        canCheckout: !!this.config && !subscriptions.some(s => ongoing(s.status)), canManage: !!this.config && !!row?.customer_id,
        subscriptions: subscriptions.map(s => ({ status: s.status, periodEnd: s.periodEnd ? new Date(s.periodEnd * 1000).toISOString() : null,
          cancelAt: s.cancelAt ? new Date(s.cancelAt * 1000).toISOString() : null })),
        entitlement: await syncEntitlement(db, identity.userId, this.syncEnabled),
      }
    })
  }

  checkout(identity: DesktopIdentity, plan: BillingPlan) {
    if (!this.config || !this.gateway) throw new ApiError('UNAVAILABLE', 'Subscriptions are not available yet.')
    const config = this.config, gateway = this.gateway
    const price = config.prices[plan]
    if (!price) throw new ApiError('VALIDATION_FAILED', 'That subscription plan is not available.')
    return this.account(identity, async (db, email) => {
      await gateway.prices() // Fail closed on inactive, incorrect currency, amount, or interval.
      await db.query('INSERT INTO billing_accounts(user_id,customer_key) VALUES($1,$2) ON CONFLICT DO NOTHING', [identity.userId, randomUUID()])
      let row = (await this.row(db, identity.userId))!
      if (!row.customer_id) {
        if (!row.customer_started_at) {
          await db.query('UPDATE billing_accounts SET customer_started_at=now(),customer_email=$2 WHERE user_id=$1', [identity.userId, email])
          row = (await this.row(db, identity.userId))!
        }
        // Stripe idempotency keys may be pruned after 24 hours. Never risk creating a
        // second customer after an old ambiguous response; operator reconciliation is needed.
        if (Date.now() - row.customer_started_at!.getTime() > 23 * 3600_000) throw new ApiError('CONFLICT', 'Billing setup needs support. Please contact us before trying again.')
        const customer = await gateway.customer(identity.userId, row.customer_email!, row.customer_key)
        await db.query('UPDATE billing_accounts SET customer_id=$2,updated_at=now() WHERE user_id=$1', [identity.userId, customer])
        row.customer_id = customer
      }
      const subscriptions = await this.reconcile(db, identity.userId, row.customer_id)
      if (subscriptions.some(s => ongoing(s.status))) throw new ApiError('CONFLICT', 'You already have a subscription. Use Manage billing to make changes.')
      let reuse = !!(row.checkout_key && row.checkout_started_at && Date.now() - row.checkout_started_at.getTime() < 3600_000)
      if (row.checkout_key) {
        // Provider state, not our clock, decides whether an earlier checkout can
        // still be paid. Locate lost responses before replacing their operation ID.
        const previous = row.checkout_session_id ? await gateway.checkoutStatus(row.checkout_session_id)
          : await gateway.findCheckout(row.customer_id, row.checkout_key)
        if (previous) {
          await db.query('UPDATE billing_accounts SET checkout_session_id=$2 WHERE user_id=$1', [identity.userId, previous.id])
          if (previous.status === 'open' && previous.url) {
            if (row.checkout_price_id !== price) throw new ApiError('CONFLICT', 'Another checkout is open. Finish that checkout or try a different plan after one hour.')
            return { url: previous.url }
          }
          const ended = previous.subscriptionId && subscriptions.some(s => s.id === previous.subscriptionId && !ongoing(s.status))
          if (previous.status !== 'expired' && !(previous.status === 'complete' && ended)) {
            throw new ApiError('CONFLICT', 'Checkout is still being confirmed. Refresh your subscription status before trying again.')
          }
          reuse = false
        }
      }
      if (reuse) {
        if (row.checkout_price_id !== price) throw new ApiError('CONFLICT', 'Another checkout is open. Finish that checkout or try a different plan after one hour.')
      } else {
        // Fixed one-hour expiry also bounds sessions whose create response was lost.
        await db.query(`UPDATE billing_accounts SET checkout_key=$2,checkout_started_at=date_trunc('second',clock_timestamp()),
          checkout_price_id=$3,checkout_trial_days=$4,checkout_session_id=NULL WHERE user_id=$1`,
        [identity.userId, randomUUID(), price, !row.trial_used && !subscriptions.length ? config.trialDays : 0])
        row = (await this.row(db, identity.userId))!
      }
      const session = await gateway.checkout(row.customer_id!, row.checkout_price_id!, row.checkout_trial_days!, row.checkout_key!, Math.floor(row.checkout_started_at!.getTime() / 1000) + 3600)
      await db.query('UPDATE billing_accounts SET checkout_session_id=$2 WHERE user_id=$1', [identity.userId, session.id])
      if (session.status !== 'open' || !session.url) throw new ApiError('CONFLICT', 'Checkout has finished or expired. Refresh your subscription status before trying again.')
      return { url: session.url }
    })
  }

  portal(identity: DesktopIdentity) {
    if (!this.config || !this.gateway) throw new ApiError('UNAVAILABLE', 'Billing management is not available yet.')
    return this.account(identity, async db => {
      const row = await this.row(db, identity.userId)
      if (!row?.customer_id) throw new ApiError('NOT_FOUND', 'There is no billing account to manage yet.')
      return { url: await this.gateway!.portal(row.customer_id) }
    })
  }

  /** Operator job for missed webhooks; no unauthenticated HTTP route exposes this. */
  async refreshCustomer(userId: string) {
    if (!this.config || !this.gateway) throw new ApiError('UNAVAILABLE', 'Billing is disabled.')
    return this.locked(userId, async db => {
      const row = await this.row(db, userId)
      if (row?.customer_id) await this.reconcile(db, userId, row.customer_id)
    })
  }

  async webhook(event: Stripe.Event) {
    if (!this.config || !this.gateway) throw new ApiError('UNAVAILABLE', 'Billing is disabled.')
    if (event.livemode !== this.config.live || event.account) throw new ApiError('VALIDATION_FAILED', 'Unexpected Stripe account or mode.')
    if (!billingEvents.has(event.type)) return { received: true }
    const object = event.data.object as unknown as { customer?: string | { id: string } | null }
    const customer = typeof object.customer === 'string' ? object.customer : object.customer?.id
    if (!customer) return { received: true }
    // Identity comes only from our persisted customer binding, never email or event metadata.
    const owner = (await this.pool.query('SELECT user_id FROM billing_accounts WHERE customer_id=$1', [customer])).rows[0]
    if (!owner) return { received: true }
    return this.locked(owner.user_id, async db => {
      if ((await db.query('SELECT 1 FROM billing_events WHERE event_id=$1', [event.id])).rowCount) return { received: true }
      await this.reconcile(db, owner.user_id, customer, event)
      return { received: true }
    })
  }
}
