import Stripe from 'stripe'
import { ApiError } from '../api/http'
import type { BillingConfig } from './config'
import type { BillingPlan } from '../../contracts/v1/billing'

export const STRIPE_API_VERSION = '2026-10-28.endive' as const
export const billingEvents = new Set([
  'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'customer.subscription.paused', 'customer.subscription.resumed', 'customer.subscription.trial_will_end',
  'invoice.paid', 'invoice.payment_failed', 'invoice.payment_action_required', 'invoice.finalization_failed',
  'invoice.marked_uncollectible', 'invoice.voided',
])

export interface SubscriptionState {
  id: string; status: string; priceId: string | null; periodEnd: number | null; cancelAt: number | null; accessUntil: number | null
}
export interface CheckoutState { id: string; url: string | null; status: string | null; expiresAt: number; subscriptionId: string | null }
export interface BillingGateway {
  customer(userId: string, email: string, key: string): Promise<string>
  prices(): Promise<{ id: BillingPlan; amount: number; currency: 'thb'; interval: 'month' | 'year' }[]>
  subscriptions(customer: string): Promise<SubscriptionState[]>
  checkout(customer: string, price: string, trialDays: number, key: string, expiresAt: number): Promise<CheckoutState>
  checkoutStatus(id: string): Promise<CheckoutState>
  findCheckout(customer: string, key: string): Promise<CheckoutState | null>
  portal(customer: string): Promise<string>
  verify(body: Uint8Array, signature: string): Promise<Stripe.Event>
}

/** Only verified supported recurring THB prices and paid invoices grant access. */
export function subscriptionState(subscription: Stripe.Subscription, config: BillingConfig): SubscriptionState {
  const item = subscription.items.data.length === 1 && !subscription.items.has_more ? subscription.items.data[0] : undefined
  const price = item?.price
  const periodEnd = item?.current_period_end ?? null
  const cancelAt = subscription.cancel_at ?? (subscription.cancel_at_period_end ? periodEnd : null)
  const invoice = typeof subscription.latest_invoice === 'object' ? subscription.latest_invoice : null
  const supported = price && config.acceptedPrices.includes(price.id) && price.currency === 'thb' && price.type === 'recurring' && item?.quantity === 1
  let accessUntil: number | null = null
  if (supported && !subscription.pause_collection && periodEnd) {
    if (subscription.status === 'trialing' && subscription.trial_end) accessUntil = Math.min(periodEnd, subscription.trial_end)
    if (subscription.status === 'active' && invoice?.status === 'paid') accessUntil = periodEnd
    if (accessUntil && cancelAt) accessUntil = Math.min(accessUntil, cancelAt)
  }
  return { id: subscription.id, status: subscription.status, priceId: price?.id ?? null, periodEnd, cancelAt, accessUntil }
}

export class StripeGateway implements BillingGateway {
  private stripe: Stripe
  constructor(private config: BillingConfig, client?: Stripe) {
    this.stripe = client ?? new Stripe(config.secret, { apiVersion: STRIPE_API_VERSION, timeout: 10000, maxNetworkRetries: 1 })
  }
  async customer(userId: string, email: string, key: string) {
    const result = await this.stripe.customers.create({ email, metadata: { heyday_user_id: userId } }, { idempotencyKey: `customer:${key}` })
    return result.id
  }
  async prices() {
    return Promise.all((Object.entries(this.config.prices) as [BillingPlan, string | undefined][]).filter((p): p is [BillingPlan, string] => !!p[1]).map(async ([id, value]) => {
      const price = await this.stripe.prices.retrieve(value)
      const interval: 'month' | 'year' = id === 'monthly' ? 'month' : 'year'
      if (!price.active || price.livemode !== this.config.live || price.currency !== 'thb' || price.type !== 'recurring' ||
          price.recurring?.interval !== interval || price.recurring.interval_count !== 1 || price.recurring.usage_type !== 'licensed' ||
          price.billing_scheme !== 'per_unit' || price.unit_amount === null || price.unit_amount <= 0 || price.custom_unit_amount) {
        throw new ApiError('UNAVAILABLE', 'Subscription pricing is not available. Please try again later.')
      }
      return { id, amount: price.unit_amount, currency: 'thb' as const, interval }
    }))
  }
  async subscriptions(customer: string) {
    const states: SubscriptionState[] = []
    for await (const subscription of this.stripe.subscriptions.list({ customer, status: 'all', limit: 100, expand: ['data.latest_invoice'] })) {
      if (subscription.livemode !== this.config.live) throw new Error('Stripe mode mismatch.')
      states.push(subscriptionState(subscription, this.config))
    }
    return states
  }
  async checkout(customer: string, price: string, trialDays: number, key: string, expiresAt: number) {
    return this.session(await this.stripe.checkout.sessions.create({
      mode: 'subscription', customer, line_items: [{ price, quantity: 1 }], allowed_payment_method_types: ['card'], metadata: { heyday_checkout_key: key },
      success_url: `${this.config.origin}/account?checkout=success`, cancel_url: `${this.config.origin}/account?checkout=canceled`,
      expires_at: expiresAt,
      ...(trialDays ? { subscription_data: { trial_period_days: trialDays, trial_settings: { end_behavior: { missing_payment_method: 'cancel' as const } } }, payment_method_collection: 'always' as const } : {}),
    }, { idempotencyKey: `checkout:${key}` }))
  }
  private session(session: Stripe.Checkout.Session): CheckoutState {
    return { id: session.id, url: session.url, status: session.status, expiresAt: session.expires_at,
      subscriptionId: typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null }
  }
  async checkoutStatus(id: string) { return this.session(await this.stripe.checkout.sessions.retrieve(id)) }
  async findCheckout(customer: string, key: string) {
    for await (const session of this.stripe.checkout.sessions.list({ customer, limit: 100 })) {
      if (session.metadata?.heyday_checkout_key === key) return this.session(session)
    }
    return null
  }
  async portal(customer: string) {
    const configuration = this.config.portalConfiguration
      ? await this.stripe.billingPortal.configurations.retrieve(this.config.portalConfiguration)
      : (await this.stripe.billingPortal.configurations.list({ is_default: true, limit: 1 })).data[0]
    if (!configuration?.active || configuration.livemode !== this.config.live || !configuration.features.subscription_cancel.enabled ||
        configuration.features.subscription_cancel.mode !== 'at_period_end') {
      throw new ApiError('UNAVAILABLE', 'Billing management is not ready. Please contact support.')
    }
    const session = await this.stripe.billingPortal.sessions.create({ customer, return_url: `${this.config.origin}/account`, configuration: configuration.id })
    return session.url
  }
  verify(body: Uint8Array, signature: string) { return this.stripe.webhooks.constructEventAsync(Buffer.from(body), signature, this.config.webhookSecret) }
}
