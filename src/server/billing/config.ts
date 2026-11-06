export interface BillingConfig {
  secret: string
  webhookSecret: string
  origin: string
  prices: { monthly?: string; yearly?: string }
  acceptedPrices: string[]
  trialDays: number
  portalConfiguration?: string
  live: boolean
}

export function billingConfig(env: Record<string, string | undefined>): BillingConfig | null {
  if (env.STRIPE_BILLING_ENABLED !== 'true') return null
  const required = (name: string) => {
    const value = env[name]?.trim()
    if (!value) throw new Error(`Missing ${name}`)
    return value
  }
  const secret = required('STRIPE_SECRET_KEY')
  if (!/^[sr]k_(test|live)_/.test(secret)) throw new Error('Invalid STRIPE_SECRET_KEY.')
  const webhookSecret = required('STRIPE_WEBHOOK_SECRET')
  if (!webhookSecret.startsWith('whsec_')) throw new Error('Invalid STRIPE_WEBHOOK_SECRET.')
  const url = new URL(required('BETTER_AUTH_URL'))
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Billing requires an HTTPS origin or HTTP localhost.')
  }
  const prices = { monthly: env.STRIPE_PRICE_MONTHLY?.trim() || undefined, yearly: env.STRIPE_PRICE_YEARLY?.trim() || undefined }
  const acceptedPrices = [...new Set([...Object.values(prices).filter((p): p is string => !!p),
    ...(env.STRIPE_LEGACY_PRICE_IDS?.split(',').map(p => p.trim()).filter(Boolean) ?? [])])]
  if (!Object.values(prices).some(Boolean) || acceptedPrices.some(p => !/^price_[a-zA-Z0-9]+$/.test(p))) throw new Error('Configure valid Stripe recurring Price IDs.')
  if (prices.monthly && prices.monthly === prices.yearly) throw new Error('Monthly and yearly prices must differ.')
  const trial = env.STRIPE_TRIAL_DAYS?.trim() || '0'
  if (!/^(0|[1-9][0-9]{0,2})$/.test(trial) || Number(trial) > 730) throw new Error('STRIPE_TRIAL_DAYS must be 0–730.')
  return { secret, webhookSecret, origin: url.origin, prices, acceptedPrices, trialDays: Number(trial),
    portalConfiguration: env.STRIPE_PORTAL_CONFIGURATION_ID?.trim() || undefined, live: secret.includes('_live_') }
}

/** A misconfigured purchase flow must not break login, devices, or existing sync. */
export function billingAvailable(env: Record<string, string | undefined>) {
  try { return !!billingConfig(env) } catch { return false }
}
