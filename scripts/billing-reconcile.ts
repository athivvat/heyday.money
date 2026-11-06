import { Pool } from 'pg'
import { billingConfig } from '../src/server/billing/config'
import { StripeGateway } from '../src/server/billing/gateway'
import { BillingService } from '../src/server/billing/service'

// Safe to repeat or schedule: same per-account lock and current-state reconciliation
// as webhooks. Never creates customers/subscriptions or charges a payment method.
async function main() {
  const config = billingConfig(process.env)
  if (!config || !process.env.DATABASE_URL) throw new Error('Configure billing and DATABASE_URL first.')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000 })
  pool.on('error', () => console.error('Billing database connection error.'))
  let refreshed = 0, failed = 0, after = ''
  try {
    const service = new BillingService(pool, config, new StripeGateway(config))
    while (true) {
      const batch = (await pool.query('SELECT user_id FROM billing_accounts WHERE customer_id IS NOT NULL AND user_id>$1 ORDER BY user_id LIMIT 100', [after])).rows
      if (!batch.length) break
      for (const row of batch) {
        try { await service.refreshCustomer(row.user_id); refreshed++ }
        catch { failed++ } // No provider payload, identity, or credentials in logs.
        after = row.user_id
      }
    }
    console.log(JSON.stringify({ event: 'billing_reconciliation', refreshed, failed }))
    if (failed) process.exitCode = 1
  } finally { await pool.end() }
}
main().catch(() => { console.error('Billing reconciliation failed. Check server configuration and connectivity.'); process.exitCode = 1 })
