import { AsyncLocalStorage } from 'node:async_hooks'

const deliveries = new AsyncLocalStorage<{ failed: boolean; requestId?: string }>()

/** Better Auth catches background-task errors even when it awaits delivery.
 * Keep failure state per HTTP request so a rejected send cannot report success.
 */
export async function withEmailDeliveryCheck<T>(action: () => Promise<T>, requestId?: string): Promise<T> {
  return deliveries.run({ failed: false, requestId }, async () => {
    const result = await action()
    if (deliveries.getStore()?.failed) throw new Error('Unable to deliver verification email.')
    return result
  })
}

export function emailDeliveryFailed(error: unknown) {
  const state = deliveries.getStore()
  if (state) state.failed = true
  const info = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const known = ['validation_error', 'restricted_api_key', 'invalid_api_key', 'missing_api_key', 'rate_limit_exceeded', 'daily_quota_exceeded', 'monthly_quota_exceeded']
  const category = typeof info.name === 'string' && known.includes(info.name) ? info.name : 'delivery_error'
  const status = typeof info.statusCode === 'number' && info.statusCode >= 400 && info.statusCode <= 599 ? info.statusCode : undefined
  // Never log provider messages, recipient addresses, codes, keys or email bodies.
  console.error(JSON.stringify({ event: 'auth_email_delivery_failed', requestId: state?.requestId, provider: 'resend', category, status }))
}
