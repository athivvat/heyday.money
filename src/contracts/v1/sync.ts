import { exactFields, object, recordId, ValidationError, version } from './common'
import { uuid } from './devices'
import { base64url } from './encrypted-record'

export const ZERO_HASH = '0'.repeat(64)
export const SYNC_PAGE_SIZE = 50
export interface Head { sequence: string; hash: string }
export interface SyncEnvelope {
  format: 'heyday-record-v2'; algorithm: 'A256GCM-HKDF-SHA256'; keyId: string
  salt: string; nonce: string; ciphertext: string
}
export interface Mutation {
  protocol: 1 | 2 | 3 | 4 | 5; datasetId: string; mutationId: string; recordId: string; baseVersion: string
  previous: Head; operation: 'put' | 'delete'; payload: SyncEnvelope; commitHash: string; commitMac: string
}
export interface Change { sequence: string; version: string; request: Mutation }
export interface SyncPage { datasetId: string; head: Head; boundary: string; changes: Change[]; cursor: string; hasMore: boolean }
export type PushResult = { kind: 'accepted'; change: Change } | { kind: 'conflict'; head: Head; current: Change | null }

export function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new ValidationError('hash', 'Expected a SHA-256 digest.')
  return value
}
export function head(value: unknown): Head {
  const input = object(value, 'head'); exactFields(input, ['sequence', 'hash'], 'head')
  return { sequence: version(input.sequence, 'sequence'), hash: hash(input.hash) }
}
export function mutation(value: unknown): Mutation {
  const input = object(value)
  exactFields(input, ['protocol', 'datasetId', 'mutationId', 'recordId', 'baseVersion', 'previous', 'operation', 'payload', 'commitHash', 'commitMac'])
  if ((input.protocol !== 1 && input.protocol !== 2 && input.protocol !== 3 && input.protocol !== 4 && input.protocol !== 5) || !['put', 'delete'].includes(String(input.operation))) throw new ValidationError('protocol', 'Unsupported sync protocol or operation.')
  const payload = object(input.payload, 'payload')
  exactFields(payload, ['format', 'algorithm', 'keyId', 'salt', 'nonce', 'ciphertext'], 'payload')
  if (payload.format !== 'heyday-record-v2' || payload.algorithm !== 'A256GCM-HKDF-SHA256') throw new ValidationError('payload', 'Unsupported encryption format.')
  const result: Mutation = {
    protocol: input.protocol as 1 | 2 | 3 | 4 | 5, datasetId: uuid(input.datasetId, 'datasetId'), mutationId: recordId(input.mutationId, 'mutationId'),
    recordId: base64url(input.recordId, 32, 32, 'recordId'), baseVersion: version(input.baseVersion, 'baseVersion'),
    previous: head(input.previous), operation: input.operation as 'put' | 'delete',
    payload: { format: payload.format, algorithm: payload.algorithm, keyId: recordId(payload.keyId, 'keyId'),
      salt: base64url(payload.salt, 32, 32, 'salt'), nonce: base64url(payload.nonce, 12, 12, 'nonce'), ciphertext: base64url(payload.ciphertext, 16, input.protocol === 1 ? 8192 : input.protocol === 2 ? 262144 : 2_097_152, 'ciphertext') },
    commitHash: hash(input.commitHash), commitMac: base64url(input.commitMac, 32, 32, 'commitMac'),
  }
  if (BigInt(result.previous.sequence) >= 9223372036854775807n || BigInt(result.baseVersion) >= 9223372036854775807n) throw new ValidationError('version', 'Version exhausted.')
  return result
}

/** Compact JSON arrays are the canonical byte representation in Rust and TS. */
export function commitData(m: Mutation): string {
  return JSON.stringify([`heyday-sync-v${m.protocol}`, m.datasetId, (BigInt(m.previous.sequence) + 1n).toString(), m.previous.hash,
    m.recordId, m.mutationId, m.baseVersion, m.operation, m.payload.keyId, m.payload.salt, m.payload.nonce, m.payload.ciphertext])
}
