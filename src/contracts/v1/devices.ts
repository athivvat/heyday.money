import { exactFields, object, ValidationError } from './common'
import type { BillingSummary } from './billing'

export interface DeviceRegistration { installationId: string; name: string; platform: 'macos' | 'windows' | 'linux' }
export interface Device { id: string; name: string; platform: DeviceRegistration['platform']; createdAt: string; lastSeenAt: string; revokedAt: string | null; current: boolean }
export interface DevicePage { devices: Device[]; nextCursor: string | null }
export interface AccountInfo {
  account: { id: string; email: string }
  dataset: { id: string; keyStatus: 'not_enrolled' | 'enrolled' }
  device: Device | null
  entitlement: { canSync: boolean; reason: 'not_configured' | 'beta_access' | 'subscription' | 'trial' | 'premium_required'; accessUntil: string | null }
  billing: { enabled: boolean; subscriptions: BillingSummary['subscriptions'] }
  capabilities: { apiVersion: 1; devices: true; sync: boolean; syncProtocol: 2; billing: boolean; keyEnrollment: true }
  limits: { devices: null; storageBytes: null; devicePageSize: 100; requestsPerMinute: 120 }
}

export function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    throw new ValidationError(field, 'Expected a lowercase UUID.')
  }
  return value
}

export function deviceRegistration(value: unknown): DeviceRegistration {
  const body = object(value)
  exactFields(body, ['installationId', 'name', 'platform'])
  const installationId = uuid(body.installationId, 'installationId')
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(body.name)) {
    throw new ValidationError('name', 'Expected a device name of 1–80 characters without control characters.')
  }
  if (body.platform !== 'macos' && body.platform !== 'windows' && body.platform !== 'linux') throw new ValidationError('platform', 'Unsupported desktop platform.')
  return { installationId, name: body.name.trim(), platform: body.platform }
}

export function devicePageQuery(url: URL): { cursor: string | null; limit: number } {
  for (const key of url.searchParams.keys()) {
    if (!['cursor', 'limit'].includes(key) || url.searchParams.getAll(key).length !== 1) throw new ValidationError('query', 'Unexpected or repeated query parameter.')
  }
  const rawLimit = url.searchParams.get('limit') ?? '50'
  if (!/^[1-9][0-9]{0,2}$/.test(rawLimit) || Number(rawLimit) > 100) throw new ValidationError('limit', 'Expected a page size from 1 to 100.')
  const cursor = url.searchParams.get('cursor')
  return { cursor: cursor === null ? null : uuid(cursor, 'cursor'), limit: Number(rawLimit) }
}
