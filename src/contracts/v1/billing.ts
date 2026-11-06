export type BillingPlan = 'monthly' | 'yearly'
export interface BillingSummary {
  account: { email: string }
  enabled: boolean
  plans: { id: BillingPlan; amount: number; currency: 'thb'; interval: 'month' | 'year' }[]
  trialDays: number
  canCheckout: boolean
  canManage: boolean
  subscriptions: { status: string; periodEnd: string | null; cancelAt: string | null }[]
  entitlement: { canSync: boolean; reason: string; accessUntil: string | null }
}
