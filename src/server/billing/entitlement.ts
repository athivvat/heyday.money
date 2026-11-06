import type { PoolClient } from 'pg'
import type { BillingSummary } from '../../contracts/v1/billing'

/** Read-only projection of provider-verified state. Never returns Stripe identifiers. */
export async function subscriptionSummary(db: PoolClient, userId: string): Promise<BillingSummary['subscriptions']> {
  const result = await db.query<{ status: string; period_end: Date | null; cancel_at: Date | null }>(
    'SELECT status, period_end, cancel_at FROM billing_subscriptions WHERE user_id=$1 ORDER BY subscription_id', [userId])
  return result.rows.map(row => ({ status: row.status, periodEnd: row.period_end?.toISOString() ?? null, cancelAt: row.cancel_at?.toISOString() ?? null }))
}

/** Shared by desktop account status, website status, and every sync operation. */
export async function syncEntitlement(db: PoolClient, userId: string, enabled: boolean) {
  const result = await db.query<{ access_until: Date; reason: 'beta_access' | 'subscription' | 'trial' }>(`
    SELECT access_until, reason FROM (
      SELECT access_until, 'beta_access' AS reason FROM cloud_sync_entitlements
        WHERE user_id=$1 AND revoked_at IS NULL
      UNION ALL
      SELECT access_until, CASE WHEN status='trialing' THEN 'trial' ELSE 'subscription' END AS reason
        FROM billing_subscriptions WHERE user_id=$1
    ) grants WHERE access_until > clock_timestamp() ORDER BY access_until DESC LIMIT 1`, [userId])
  const grant = result.rows[0]
  return { canSync: enabled && !!grant, reason: !enabled ? 'not_configured' as const : grant?.reason ?? 'premium_required' as const,
    accessUntil: grant?.access_until.toISOString() ?? null }
}
