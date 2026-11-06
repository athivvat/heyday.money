import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { AccountInfo, Device, DevicePage, DeviceRegistration } from '../../contracts/v1/devices'
import { ApiError } from '../api/http'
import type { KeyEnvelope, KeyRotation, KeyState } from '../../contracts/v1/encryption'
import { ZERO_HASH } from '../../contracts/v1/sync'
import { subscriptionSummary, syncEntitlement } from '../billing/entitlement'
import { billingAvailable } from '../billing/config'

export interface DesktopIdentity { userId: string; sessionId: string }
interface DeviceRow {
  id: string; name: string; platform: DeviceRegistration['platform'];
  created_at: Date; last_seen_at: Date; revoked_at: Date | null
}
const wire = (row: DeviceRow, currentId?: string): Device => ({
  id: row.id, name: row.name, platform: row.platform, createdAt: row.created_at.toISOString(),
  lastSeenAt: row.last_seen_at.toISOString(), revokedAt: row.revoked_at?.toISOString() ?? null, current: row.id === currentId,
})

export class DeviceService {
  constructor(private pool: Pool) {}

  async account<T>(identity: DesktopIdentity, action: (db: PoolClient, email: string, current?: DeviceRow) => Promise<T>): Promise<T> {
    // One bounded row per account; consume quota even if the operation is rejected.
    const usage = await this.pool.query(`INSERT INTO cloud_api_usage(user_id, window_start, requests)
      VALUES ($1, date_trunc('minute', now()), 1) ON CONFLICT (user_id) DO UPDATE SET
      requests = CASE WHEN cloud_api_usage.window_start = EXCLUDED.window_start THEN cloud_api_usage.requests + 1 ELSE 1 END,
      window_start = EXCLUDED.window_start RETURNING requests`, [identity.userId])
    if (usage.rows[0].requests > 120) throw new ApiError('RATE_LIMITED', 'Too many account requests. Try again shortly.')
    const db = await this.pool.connect()
    try {
      await db.query('BEGIN')
      // Serialize all account/device mutations and reads against revocation, including
      // requests whose token was checked just before another request revoked it.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`heyday-account:${identity.userId}`])
      const user = await db.query(`SELECT u.email FROM "user" u JOIN "session" s ON s."userId" = u.id
        WHERE u.id = $1 AND s.id = $2 AND s."expiresAt" > now() AND u."emailVerified" = true`, [identity.userId, identity.sessionId])
      if (!user.rowCount) throw new ApiError('AUTH_EXPIRED', 'Sign in again to continue.')
      await db.query('INSERT INTO cloud_accounts(user_id, dataset_id) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING', [identity.userId, randomUUID()])
      const bound = await db.query<DeviceRow>(`SELECT d.* FROM cloud_device_sessions s JOIN cloud_devices d ON d.id = s.device_id AND d.user_id = s.user_id
        WHERE s.session_id = $1 AND s.user_id = $2`, [identity.sessionId, identity.userId])
      const current = bound.rows[0]
      if (current?.revoked_at) throw new ApiError('DEVICE_REVOKED', 'This device has been revoked. Sign in again on a new installation.')
      if (current) {
        const seen = await db.query('UPDATE cloud_devices SET last_seen_at = now() WHERE id = $1 RETURNING last_seen_at', [current.id])
        current.last_seen_at = seen.rows[0].last_seen_at
      }
      const result = await action(db, user.rows[0].email, current)
      await db.query('COMMIT')
      return result
    } catch (error) {
      await db.query('ROLLBACK')
      throw error
    } finally { db.release() }
  }

  me(identity: DesktopIdentity): Promise<AccountInfo> {
    return this.account(identity, async (db, email, current) => {
      const dataset = await db.query('SELECT a.dataset_id, k.user_id IS NOT NULL AS enrolled FROM cloud_accounts a LEFT JOIN cloud_keys k USING (user_id) WHERE a.user_id = $1', [identity.userId])
      const syncEnabled = process.env.CLOUD_SYNC_ENABLED === 'true'
      const entitlement = await syncEntitlement(db, identity.userId, syncEnabled)
      return {
        account: { id: identity.userId, email }, dataset: { id: dataset.rows[0].dataset_id, keyStatus: dataset.rows[0].enrolled ? 'enrolled' : 'not_enrolled' },
        device: current ? wire(current, current.id) : null,
        entitlement,
        billing: { enabled: billingAvailable(process.env), subscriptions: await subscriptionSummary(db, identity.userId) },
        capabilities: { apiVersion: 1, devices: true, sync: syncEnabled, syncProtocol: 2, billing: billingAvailable(process.env), keyEnrollment: true },
        limits: { devices: null, storageBytes: null, devicePageSize: 100, requestsPerMinute: 120 },
      }
    })
  }

  keys(identity: DesktopIdentity, proposed?: KeyEnvelope): Promise<KeyState> {
    return this.account(identity, async (db, _email, current) => {
      if (!current) throw new ApiError('DEVICE_REQUIRED', 'Register this device before setting up encryption.')
      const datasetId = (await db.query('SELECT dataset_id FROM cloud_accounts WHERE user_id = $1', [identity.userId])).rows[0].dataset_id as string
      if (proposed) {
        if (proposed.datasetId !== datasetId) throw new ApiError('CONFLICT', 'The encryption package does not match this dataset.')
        await db.query('INSERT INTO cloud_keys(user_id, dataset_id, envelope) VALUES ($1, $2, $3::jsonb) ON CONFLICT (user_id) DO NOTHING', [identity.userId, datasetId, JSON.stringify(proposed)])
        const matching = await db.query('SELECT 1 FROM cloud_keys WHERE user_id = $1 AND envelope = $2::jsonb', [identity.userId, JSON.stringify(proposed)])
        if (!matching.rowCount) throw new ApiError('CONFLICT', 'Encryption is already configured. Recover the existing key instead.')
      }
      const row = (await db.query('SELECT envelope, rotation FROM cloud_keys WHERE user_id = $1', [identity.userId])).rows[0]
      return { datasetId, key: row?.envelope ?? null, rotation: row?.rotation ?? null, keyManagementVersion: 2 }
    })
  }

  rotateKey(identity: DesktopIdentity, input: KeyRotation): Promise<KeyState> {
    return this.account(identity, async (db, _email, current) => {
      if (!current) throw new ApiError('DEVICE_REQUIRED', 'Register this device before changing encryption.')
      const row = (await db.query('SELECT dataset_id, envelope, rotation FROM cloud_keys WHERE user_id=$1', [identity.userId])).rows[0]
      if (!row || row.dataset_id !== input.key.datasetId) throw new ApiError('CONFLICT', 'Encryption is not configured for this dataset.')
      const receipt = (await db.query('SELECT request=$3::jsonb AS matches FROM cloud_key_rotations WHERE user_id=$1 AND key_id=$2', [identity.userId, input.key.keyId, JSON.stringify(input)])).rows[0]
      if (receipt) {
        if (!receipt.matches) throw new ApiError('CONFLICT', 'This encryption key was already used.')
        // Return current state: an old retry must never roll back a later rotation.
        return { datasetId: row.dataset_id, key: row.envelope, rotation: row.rotation, keyManagementVersion: 2 }
      }
      const matches = await db.query('SELECT 1 FROM cloud_keys WHERE user_id=$1 AND envelope=$2::jsonb', [identity.userId, JSON.stringify(input.previousKey)])
      if (!matches.rowCount) throw new ApiError('CONFLICT', 'Encryption changed on another device. Recover the latest key.')
      const reused = await db.query("SELECT 1 FROM cloud_key_rotations WHERE user_id=$1 AND (key_id=$2 OR request->'previousKey'->>'keyId'=$2)", [identity.userId, input.key.keyId])
      if (reused.rowCount) throw new ApiError('CONFLICT', 'This encryption key was already used.')
      const head = (await db.query('SELECT sequence::text, hash FROM cloud_sync_state WHERE user_id=$1', [identity.userId])).rows[0] ?? { sequence: '0', hash: ZERO_HASH }
      if (head.sequence !== input.head.sequence || head.hash !== input.head.hash) throw new ApiError('CONFLICT', 'Cloud history changed. Refresh and prepare a new recovery key.')
      await db.query('INSERT INTO cloud_key_rotations(user_id,key_id,request) VALUES($1,$2,$3::jsonb)', [identity.userId, input.key.keyId, JSON.stringify(input)])
      await db.query('UPDATE cloud_keys SET envelope=$2::jsonb, rotation=$3::jsonb WHERE user_id=$1', [identity.userId, JSON.stringify(input.key), JSON.stringify(input)])
      return { datasetId: row.dataset_id, key: input.key, rotation: input, keyManagementVersion: 2 }
    })
  }

  register(identity: DesktopIdentity, input: DeviceRegistration): Promise<Device> {
    return this.account(identity, async (db, _email, current) => {
      const existing = await db.query<DeviceRow>('SELECT * FROM cloud_devices WHERE user_id = $1 AND installation_id = $2', [identity.userId, input.installationId])
      let device = existing.rows[0]
      if (current && current.id !== device?.id) throw new ApiError('CONFLICT', 'This session is already bound to another installation.')
      if (device?.revoked_at) throw new ApiError('DEVICE_REVOKED', 'This installation has been revoked.')
      if (device && (device.name !== input.name || device.platform !== input.platform)) throw new ApiError('CONFLICT', 'This installation is already registered with different details.')
      if (!device) {
        device = (await db.query<DeviceRow>(`INSERT INTO cloud_devices(id, user_id, installation_id, name, platform)
          VALUES ($1, $2, $3, $4, $5) RETURNING *`, [randomUUID(), identity.userId, input.installationId, input.name, input.platform])).rows[0]
      }
      await db.query('INSERT INTO cloud_device_sessions(session_id, user_id, device_id) VALUES ($1, $2, $3) ON CONFLICT (session_id) DO NOTHING', [identity.sessionId, identity.userId, device.id])
      device = (await db.query<DeviceRow>('UPDATE cloud_devices SET last_seen_at = now() WHERE id = $1 RETURNING *', [device.id])).rows[0]
      return wire(device, device.id)
    })
  }

  list(identity: DesktopIdentity, query: { cursor: string | null; limit: number }): Promise<DevicePage> {
    return this.account(identity, async (db, _email, current) => {
      const result = await db.query<DeviceRow>(`SELECT * FROM cloud_devices WHERE user_id = $1
        AND ($2::uuid IS NULL OR id > $2::uuid) ORDER BY id LIMIT $3`, [identity.userId, query.cursor, query.limit + 1])
      const page = result.rows.slice(0, query.limit)
      return { devices: page.map(d => wire(d, current?.id)), nextCursor: result.rows.length > query.limit ? page.at(-1)!.id : null }
    })
  }

  revoke(identity: DesktopIdentity, deviceId: string): Promise<{ revoked: true }> {
    return this.account(identity, async db => {
      const device = await db.query('UPDATE cloud_devices SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1 AND id = $2 RETURNING id', [identity.userId, deviceId])
      if (!device.rowCount) throw new ApiError('NOT_FOUND', 'Device not found.')
      const sessions = `SELECT session_id FROM cloud_device_sessions WHERE user_id = $1 AND device_id = $2`
      // Retain expired sessions rather than deleting them: OAuth's SET NULL FK must
      // not turn a revoked session-bound credential into an unbound token.
      await db.query(`UPDATE "session" SET "expiresAt" = now() WHERE "userId" = $1 AND id IN (${sessions})`, [identity.userId, deviceId])
      for (const table of ['oauthAccessToken', 'oauthRefreshToken']) {
        await db.query(`UPDATE "${table}" SET revoked = COALESCE(revoked, now()), "expiresAt" = LEAST("expiresAt", now())
          WHERE "userId" = $1 AND "sessionId" IN (${sessions})`, [identity.userId, deviceId])
      }
      return { revoked: true }
    })
  }
}
