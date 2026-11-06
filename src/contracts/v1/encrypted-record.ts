import { exactFields, object, recordId, ValidationError, version } from './common'

export const MAX_CIPHERTEXT_BYTES = 64 * 1024

/** Draft v1 payload: ciphertext includes the 16-byte GCM authentication tag. */
export interface EncryptedRecord {
  format: 'heyday-record-v1'
  algorithm: 'A256GCM'
  keyId: string
  nonce: string
  ciphertext: string
}

/** Canonical unpadded base64url prevents equivalent encodings in retry fingerprints. */
export function base64url(value: unknown, minimum: number, maximum: number, field: string): string {
  if (typeof value !== 'string' || value.length > Math.ceil(maximum * 4 / 3) ||
      !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new ValidationError(field, 'Expected bounded unpadded base64url.')
  }
  const bytes = Math.floor(value.length * 3 / 4)
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const last = alphabet.indexOf(value[value.length - 1])
  const remainder = value.length % 4
  if (bytes < minimum || bytes > maximum || (remainder === 2 && (last & 15) !== 0) ||
      (remainder === 3 && (last & 3) !== 0)) {
    throw new ValidationError(field, 'Invalid base64url length or padding bits.')
  }
  return value
}

export function encryptedRecord(value: unknown): EncryptedRecord {
  const input = object(value, 'payload')
  exactFields(input, ['format', 'algorithm', 'keyId', 'nonce', 'ciphertext'], 'payload')
  if (input.format !== 'heyday-record-v1' || input.algorithm !== 'A256GCM') {
    throw new ValidationError('payload', 'Unsupported encrypted record format.')
  }
  return {
    format: input.format,
    algorithm: input.algorithm,
    keyId: recordId(input.keyId, 'payload.keyId'),
    nonce: base64url(input.nonce, 12, 12, 'payload.nonce'),
    ciphertext: base64url(input.ciphertext, 16, MAX_CIPHERTEXT_BYTES, 'payload.ciphertext'),
  }
}

export interface RecordContext {
  datasetId: string
  recordId: string
  mutationId: string
  baseVersion: string
  operation: 'put' | 'delete'
}

/** UTF-8 JSON array, fixed ordering; implement identically in the desktop client.
 * Deletion also carries an encrypted tombstone so its intent is authenticated.
 * Server-assigned committed version is excluded because it is unknown at encryption.
 */
export function recordAdditionalData(context: RecordContext, keyId: string): Uint8Array<ArrayBuffer> {
  if (context.operation !== 'put' && context.operation !== 'delete') {
    throw new ValidationError('operation', 'Unsupported operation.')
  }
  return new TextEncoder().encode(JSON.stringify([
    'heyday-record-v1', 'A256GCM', recordId(context.datasetId, 'datasetId'),
    recordId(context.recordId), recordId(context.mutationId, 'mutationId'),
    version(context.baseVersion, 'baseVersion'), context.operation, recordId(keyId, 'keyId'),
  ]))
}
