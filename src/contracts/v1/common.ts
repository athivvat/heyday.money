/** Shared wire primitives. No server secrets, database types, or JS number money. */
export class ValidationError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export function object(value: unknown, field = 'body'): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(field, 'Expected an object.')
  }
  return value as Record<string, unknown>
}

export function exactFields(value: Record<string, unknown>, fields: readonly string[], field = 'body') {
  if (Object.keys(value).some(key => !fields.includes(key))) {
    throw new ValidationError(field, 'Unexpected field.')
  }
}

/** Preserve both generated hex IDs and existing seeded desktop IDs. */
export function recordId(value: unknown, field = 'recordId'): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new ValidationError(field, 'Expected a stable identifier of 1–128 ASCII characters.')
  }
  return value
}

function integerString(value: unknown, minimum: bigint, maximum: bigint, field: string): string {
  if (typeof value !== 'string' || value.length > 20 || !/^(0|-?[1-9][0-9]*)$/.test(value)) {
    throw new ValidationError(field, 'Expected a canonical decimal integer string.')
  }
  const parsed = BigInt(value)
  if (parsed < minimum || parsed > maximum) throw new ValidationError(field, 'Integer is out of range.')
  return value
}

/** SQLite i64 minor units. Domain-specific positivity rules run on the desktop. */
export function money(value: unknown, field = 'amount'): string {
  return integerString(value, -(2n ** 63n), 2n ** 63n - 1n, field)
}

/** Zero is the create-only precondition; committed versions start at one. */
export function version(value: unknown, field = 'version'): string {
  return integerString(value, 0n, 2n ** 63n - 1n, field)
}

/** Calendar date, deliberately independent of timezone and Date normalization. */
export function calendarDate(value: unknown, field = 'date'): string {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) {
    throw new ValidationError(field, 'Expected YYYY-MM-DD.')
  }
  const [year, month, day] = value.split('-').map(Number)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (year === 0 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
    throw new ValidationError(field, 'Invalid calendar date.')
  }
  return value
}

export const errorStatus = {
  AUTH_REQUIRED: 401,
  AUTH_EXPIRED: 401,
  PREMIUM_REQUIRED: 403,
  DEVICE_REVOKED: 403,
  DEVICE_REQUIRED: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  CONFLICT: 409,
  MUTATION_ID_REUSED: 409,
  KEY_CHANGED: 409,
  CURSOR_EXPIRED: 410,
  MUTATION_EXPIRED: 410,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  CLIENT_UPGRADE_REQUIRED: 426,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
} as const

export type ErrorCode = keyof typeof errorStatus
export interface ErrorEnvelope {
  code: ErrorCode
  message: string
  requestId: string
  details?: { field: string }[]
}
