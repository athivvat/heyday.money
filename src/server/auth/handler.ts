import '@tanstack/react-start/server-only'
import { getAuth } from './index'
import { privateJson } from '../api/http'
import { withEmailDeliveryCheck } from './delivery'

/** Better Auth owns its OAuth/error contracts; preserve redirects and Set-Cookie. */
export async function handleAuth(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID()
  try {
    let bounded = request
    if (request.body) {
      const reader = request.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 65_536) {
            await reader.cancel()
            return privateJson({ code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.', requestId }, requestId, 413)
          }
          chunks.push(value)
        }
      } finally { reader.releaseLock() }
      const body = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
      bounded = new Request(request.url, { method: request.method, headers: request.headers, body, signal: request.signal })
    }
    const response = await withEmailDeliveryCheck(() => getAuth().handler(bounded), requestId)
    if (response.status >= 500) throw new Error('Authentication failed.')
    response.headers.set('Cache-Control', 'private, no-store')
    response.headers.set('X-Request-Id', requestId)
    return response
  } catch {
    console.error(JSON.stringify({ event: 'auth_unavailable', requestId }))
    return privateJson({ code: 'UNAVAILABLE', message: 'Sign-in is temporarily unavailable.', requestId }, requestId, 503)
  }
}
