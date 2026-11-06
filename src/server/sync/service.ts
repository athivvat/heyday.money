import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import { ApiError } from '../api/http'
import { DeviceService, type DesktopIdentity } from '../devices/service'
import { commitData, head, SYNC_PAGE_SIZE, ZERO_HASH, type Change, type Head, type Mutation, type PushResult, type SyncPage } from '../../contracts/v1/sync'
import { exactFields, object, ValidationError } from '../../contracts/v1/common'
import { uuid } from '../../contracts/v1/devices'
import { syncEntitlement } from '../billing/entitlement'

interface Row { sequence: string; version: string; request: Mutation }
const change = (row: Row): Change => ({ sequence: row.sequence, version: row.version, request: row.request })
function cursor(datasetId: string, value: Head): string { return Buffer.from(JSON.stringify({ datasetId, ...value })).toString('base64url') }
function parseCursor(value: string, datasetId: string): Head {
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new ValidationError('cursor', 'Invalid cursor.')
  try {
    const decoded = Buffer.from(value, 'base64url')
    if (decoded.toString('base64url') !== value) throw new Error()
    const data = object(JSON.parse(decoded.toString('utf8')))
    exactFields(data, ['datasetId', 'sequence', 'hash'])
    if (data.datasetId !== datasetId) throw new Error()
    return head({ sequence: data.sequence, hash: data.hash })
  } catch { throw new ValidationError('cursor', 'Invalid cursor for this dataset.') }
}

export class SyncService {
  constructor(private accounts: DeviceService, private enabled = process.env.CLOUD_SYNC_ENABLED === 'true') {}
  private run<T>(identity: DesktopIdentity, datasetId: string, protocol: number, action: (db: PoolClient, state: Head, keyId: string) => Promise<T>, keysVersion = 1): Promise<T> {
    if (!this.enabled) throw new ApiError('UNAVAILABLE', 'Cloud sync is disabled on this service.')
    return this.accounts.account(identity, async (db, _email, device) => {
      if (!device) throw new ApiError('DEVICE_REQUIRED', 'Register this device before syncing.')
      const account = (await db.query('SELECT a.dataset_id, k.envelope, k.rotation FROM cloud_accounts a LEFT JOIN cloud_keys k USING(user_id) WHERE a.user_id=$1', [identity.userId])).rows[0]
      if (account.dataset_id !== datasetId) throw new ApiError('NOT_FOUND', 'Dataset not found.')
      if (!account.envelope) throw new ApiError('CONFLICT', 'Set up encryption before syncing.')
      if (account.rotation && keysVersion < 2) throw new ApiError('CLIENT_UPGRADE_REQUIRED', 'Update the app to use rotated encryption keys.')
      const entitled = await syncEntitlement(db, identity.userId, this.enabled)
      if (!entitled.canSync) throw new ApiError('PREMIUM_REQUIRED', 'Sync access has ended or has not been granted. Your cloud data is retained.')
      await db.query('INSERT INTO cloud_sync_state(user_id,dataset_id) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING', [identity.userId, datasetId])
      const state = (await db.query<Head & { protocol: number }>('SELECT sequence::text,hash,protocol FROM cloud_sync_state WHERE user_id=$1 FOR UPDATE', [identity.userId])).rows[0]
      if (state.protocol > protocol) throw new ApiError('CLIENT_UPGRADE_REQUIRED', 'Update the app to sync this dataset.')
      return action(db, { sequence: state.sequence, hash: state.hash }, account.envelope.keyId)
    })
  }

  push(identity: DesktopIdentity, input: Mutation, protocol = 1, keysVersion = 1): Promise<PushResult> {
    return this.run(identity, input.datasetId, protocol, async (db, state, keyId) => {
      if (input.protocol > protocol) throw new ApiError('CLIENT_UPGRADE_REQUIRED', 'Update the app to sync this dataset.')
      if (createHash('sha256').update(commitData(input)).digest('hex') !== input.commitHash) throw new ValidationError('commitHash', 'The commit digest does not match.')
      const retry = await db.query<Row & { matches: boolean }>('SELECT sequence::text,version::text,request,request=$3::jsonb AS matches FROM cloud_sync_changes WHERE dataset_id=$1 AND mutation_id=$2', [input.datasetId, input.mutationId, JSON.stringify(input)])
      if (retry.rows[0]) {
        if (!retry.rows[0].matches) throw new ApiError('MUTATION_ID_REUSED', 'Mutation ID was already used with different contents.')
        return { kind: 'accepted', change: change(retry.rows[0]) }
      }
      if (input.payload.keyId !== keyId) throw new ApiError('KEY_CHANGED', 'Encryption changed. Recover the latest key before syncing.')
      const current = (await db.query<Row>('SELECT c.sequence::text,c.version::text,c.request FROM cloud_sync_records r JOIN cloud_sync_changes c USING(dataset_id,sequence) WHERE r.dataset_id=$1 AND r.record_id=$2', [input.datasetId, input.recordId])).rows[0]
      if (input.previous.sequence !== state.sequence || input.previous.hash !== state.hash || input.baseVersion !== (current?.version ?? '0')) {
        return { kind: 'conflict', head: state, current: current ? change(current) : null }
      }
      const sequence = (BigInt(state.sequence) + 1n).toString()
      const version = (BigInt(input.baseVersion) + 1n).toString()
      await db.query('INSERT INTO cloud_sync_changes(dataset_id,sequence,mutation_id,record_id,version,hash,request) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)', [input.datasetId, sequence, input.mutationId, input.recordId, version, input.commitHash, JSON.stringify(input)])
      await db.query('INSERT INTO cloud_sync_records(dataset_id,record_id,version,sequence) VALUES($1,$2,$3,$4) ON CONFLICT(dataset_id,record_id) DO UPDATE SET version=EXCLUDED.version,sequence=EXCLUDED.sequence', [input.datasetId, input.recordId, version, sequence])
      await db.query('UPDATE cloud_sync_state SET sequence=$2,hash=$3,protocol=GREATEST(protocol,$4) WHERE user_id=$1', [identity.userId, sequence, input.commitHash, input.protocol])
      return { kind: 'accepted', change: { sequence, version, request: input } }
    }, keysVersion)
  }

  page(identity: DesktopIdentity, url: URL, protocol = 1, keysVersion = 1): Promise<SyncPage> {
    for (const key of url.searchParams.keys()) {
      if (!['datasetId', 'cursor', 'boundary'].includes(key) || url.searchParams.getAll(key).length !== 1) throw new ValidationError('query', 'Unexpected or repeated parameter.')
    }
    const datasetId = uuid(url.searchParams.get('datasetId'), 'datasetId')
    const after = url.searchParams.has('cursor') ? parseCursor(url.searchParams.get('cursor')!, datasetId) : { sequence: '0', hash: ZERO_HASH }
    const boundary = url.searchParams.has('boundary') ? parseCursor(url.searchParams.get('boundary')!, datasetId) : null
    return this.run(identity, datasetId, protocol, async (db, latest) => {
      const target = boundary ?? latest
      for (const point of [after, target]) {
        const known = point.sequence === '0' ? ZERO_HASH : (await db.query('SELECT hash FROM cloud_sync_changes WHERE dataset_id=$1 AND sequence=$2', [datasetId, point.sequence])).rows[0]?.hash
        if (point.hash !== known) throw new ApiError('CONFLICT', 'The saved sync checkpoint is not present. Sync stopped.')
      }
      if (BigInt(after.sequence) > BigInt(target.sequence) || BigInt(target.sequence) > BigInt(latest.sequence)) throw new ApiError('CONFLICT', 'Invalid sync boundary.')
      const rows = (await db.query<Row>('SELECT sequence::text,version::text,request FROM cloud_sync_changes WHERE dataset_id=$1 AND sequence > $2 AND sequence <= $3 ORDER BY cloud_sync_changes.sequence LIMIT $4', [datasetId, after.sequence, target.sequence, SYNC_PAGE_SIZE])).rows
      // Bound the encoded response as well as record count. A financial operation
      // is never split between pages. Protocol-3 desktops accept 4 MiB; older ones accept 1 MiB.
      let bytes = 0
      const bounded = rows.filter(row => { bytes += Buffer.byteLength(JSON.stringify(change(row))); return bytes <= (protocol >= 3 ? 3_145_728 : 800_000) })
      const last = bounded.at(-1)
      const end = last ? { sequence: last.sequence, hash: last.request.commitHash } : after
      return { datasetId, head: latest, boundary: cursor(datasetId, target), changes: bounded.map(change), cursor: cursor(datasetId, end), hasMore: BigInt(end.sequence) < BigInt(target.sequence) }
    }, keysVersion)
  }
}
