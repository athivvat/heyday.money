import { errorStatus, ValidationError, type ErrorCode, type ErrorEnvelope } from '../../contracts/v1/common'

export class ApiError extends Error {
  constructor(public readonly code: ErrorCode, message: string) { super(message) }
}

export function privateJson(body: unknown, requestId: string, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId },
  })
}

/** Never echo unexpected exception messages, SQL, credentials, or request bodies. */
export async function apiResponse(handler: (requestId: string) => Promise<unknown>): Promise<Response> {
  const requestId = crypto.randomUUID()
  try {
    return privateJson(await handler(requestId), requestId)
  } catch (error) {
    const code = error instanceof ValidationError ? 'VALIDATION_FAILED'
      : error instanceof ApiError ? error.code : 'INTERNAL_ERROR'
    const body: ErrorEnvelope = {
      code,
      message: error instanceof ValidationError || error instanceof ApiError
        ? error.message : 'An unexpected error occurred.',
      requestId,
      ...(error instanceof ValidationError ? { details: [{ field: error.field }] } : {}),
    }
    return privateJson(body, requestId, errorStatus[code])
  }
}

/** Bound actual streamed bytes, including when Content-Length is absent or false. */
export async function readJson(request: Request, maximumBytes: number): Promise<unknown> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new Error('Invalid body limit.')
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new ApiError('UNSUPPORTED_MEDIA_TYPE', 'Expected application/json.')
  }
  const reader = request.body?.getReader()
  if (!reader) throw new ValidationError('body', 'Expected a JSON body.')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maximumBytes) {
        await reader.cancel()
        throw new ApiError('PAYLOAD_TOO_LARGE', 'Request body is too large.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new ValidationError('body', 'Expected valid UTF-8 JSON.')
  }
}
