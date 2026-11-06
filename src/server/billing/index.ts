import '@tanstack/react-start/server-only'
import { getAuth } from '../auth'
import { getPool } from '../db/pool'
import { billingConfig } from './config'
import { StripeGateway } from './gateway'
import { BillingService } from './service'
import { billingHandler, webhookHandler } from './handler'
import { apiResponse } from '../api/http'

function dependencies() {
  const config = billingConfig(process.env)
  const gateway = config ? new StripeGateway(config) : null
  return { gateway, service: new BillingService(getPool(), config, gateway) }
}
export async function handleBilling(request: Request, action: 'summary' | 'checkout' | 'portal') {
  try {
    const { service } = dependencies()
    return await billingHandler(service, headers => getAuth().api.getSession({ headers }), new URL(process.env.BETTER_AUTH_URL!).origin)(request, action)
  } catch { return apiResponse(async () => { throw new Error('Billing configuration unavailable.') }) }
}
export async function handleBillingWebhook(request: Request) {
  try {
    const { service, gateway } = dependencies()
    return await webhookHandler(service, gateway)(request)
  } catch { return apiResponse(async () => { throw new Error('Billing configuration unavailable.') }) }
}
