import { ApiError, apiResponse, readJson } from '../api/http'
import { exactFields, object, ValidationError } from '../../contracts/v1/common'
import type { BillingService } from './service'
import type { BillingGateway } from './gateway'

type Session = { user: { id: string; emailVerified: boolean }; session: { id: string } } | null
export function billingHandler(service: BillingService, session: (headers: Headers) => Promise<Session>, origin: string) {
  return async (request: Request, action: 'summary' | 'checkout' | 'portal') => {
    const response = await apiResponse(async () => {
      // Website cookie sessions only. Do not turn desktop tokens into billing credentials.
      if (action !== 'summary' && (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site')) {
        throw new ApiError('VALIDATION_FAILED', 'Use the Heyday website to manage billing.')
      }
      const current = await session(request.headers)
      if (!current?.user.emailVerified) throw new ApiError('AUTH_REQUIRED', 'Sign in to manage your subscription.')
      const identity = { userId: current.user.id, sessionId: current.session.id }
      if (action === 'summary') return service.summary(identity)
      const body = object(await readJson(request, 1024))
      exactFields(body, action === 'checkout' ? ['plan'] : [])
      if (action === 'portal') return service.portal(identity)
      if (body.plan !== 'monthly' && body.plan !== 'yearly') throw new ValidationError('plan', 'Choose a subscription plan.')
      return service.checkout(identity, body.plan)
    })
    if (response.status === 429) response.headers.set('Retry-After', '60')
    return response
  }
}

export function webhookHandler(service: BillingService, gateway: BillingGateway | null) {
  return (request: Request) => apiResponse(async () => {
    if (!gateway) throw new ApiError('UNAVAILABLE', 'Billing is disabled.')
    const signature = request.headers.get('stripe-signature')
    if (!signature || signature.length > 4096) throw new ValidationError('signature', 'Invalid webhook signature.')
    const reader = request.body?.getReader()
    if (!reader) throw new ValidationError('body', 'Expected a webhook body.')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 1024 * 1024) { await reader.cancel(); throw new ApiError('PAYLOAD_TOO_LARGE', 'Webhook body is too large.') }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    let event
    try { event = await gateway.verify(Buffer.concat(chunks), signature) }
    catch { throw new ValidationError('signature', 'Invalid webhook signature.') }
    return service.webhook(event)
  })
}
