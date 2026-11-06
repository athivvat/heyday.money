import { exactFields, object, recordId, ValidationError } from './common'
import { base64url } from './encrypted-record'
import { uuid } from './devices'
import { head, type Head } from './sync'

/** Only this recovery-wrapped key leaves the desktop. No raw key fields accepted. */
export interface KeyEnvelope {
  format: 'heyday-key-v1'
  algorithm: 'A256GCM'
  kdf: 'HKDF-SHA256'
  datasetId: string
  keyId: string
  salt: string
  nonce: string
  ciphertext: string
}
export interface KeyRotation {
  format: 'heyday-rotation-v1'
  previousKey: KeyEnvelope
  key: KeyEnvelope
  head: Head
  history: { salt: string; nonce: string; ciphertext: string }
  proof: string
}
export interface KeyState { datasetId: string; key: KeyEnvelope | null; rotation?: KeyRotation | null; keyManagementVersion?: 2 }

export function keyRotation(value: unknown): KeyRotation {
  const body = object(value)
  exactFields(body, ['format', 'previousKey', 'key', 'head', 'history', 'proof'])
  if (body.format !== 'heyday-rotation-v1') throw new ValidationError('format', 'Unsupported key rotation.')
  const history = object(body.history)
  exactFields(history, ['salt', 'nonce', 'ciphertext'])
  const previousKey = keyEnvelope(body.previousKey), key = keyEnvelope(body.key)
  if (key.datasetId !== previousKey.datasetId || key.keyId === previousKey.keyId) throw new ValidationError('key', 'Rotation requires a new key for the same dataset.')
  return { format: body.format, previousKey, key, head: head(body.head), history: {
    salt: base64url(history.salt, 32, 32, 'salt'), nonce: base64url(history.nonce, 12, 12, 'nonce'),
    ciphertext: base64url(history.ciphertext, 16, 131072, 'ciphertext'),
  }, proof: base64url(body.proof, 32, 32, 'proof') }
}

export function keyEnvelope(value: unknown): KeyEnvelope {
  const body = object(value)
  exactFields(body, ['format', 'algorithm', 'kdf', 'datasetId', 'keyId', 'salt', 'nonce', 'ciphertext'])
  if (body.format !== 'heyday-key-v1' || body.algorithm !== 'A256GCM' || body.kdf !== 'HKDF-SHA256') throw new ValidationError('key', 'Unsupported key envelope.')
  return {
    format: body.format, algorithm: body.algorithm, kdf: body.kdf,
    datasetId: uuid(body.datasetId, 'datasetId'), keyId: recordId(body.keyId, 'keyId'),
    salt: base64url(body.salt, 32, 32, 'salt'), nonce: base64url(body.nonce, 12, 12, 'nonce'),
    ciphertext: base64url(body.ciphertext, 48, 48, 'ciphertext'),
  }
}

export function recoveryAdditionalData(accountId: string, key: KeyEnvelope): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify([key.format, key.algorithm, key.kdf, accountId, key.datasetId, key.keyId, key.salt]))
}
export function recoveryKeyInfo(accountId: string, key: KeyEnvelope): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(['heyday-recovery-v1', accountId, key.datasetId, key.keyId]))
}
