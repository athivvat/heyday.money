import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calendarDate, money, recordId, version } from '../../src/contracts/v1/common.ts'
import { base64url, encryptedRecord, recordAdditionalData } from '../../src/contracts/v1/encrypted-record.ts'
import { apiResponse, readJson } from '../../src/server/api/http.ts'

test('money preserves SQLite extremes and rejects lossy or ambiguous encodings', () => {
  for (const input of ['-9223372036854775808', '9223372036854775807', '9007199254740993', '0']) {
    assert.equal(money(input), input)
  }
  for (const input of [1, 1.5, '1.5', '-0', '01', '+1', '1e3', '9223372036854775808', '-9223372036854775809']) {
    assert.throws(() => money(input))
  }
  assert.equal(version('0'), '0')
  assert.throws(() => version('-1'))
})

test('identifiers retain desktop seeds; dates match the Rust calendar rules', () => {
  for (const id of ['default-fee-interest', 'planner-expense-0', '0123456789abcdef0123456789abcdef']) {
    assert.equal(recordId(id), id)
  }
  for (const date of ['2000-02-29', '2024-02-29', '0001-01-01']) assert.equal(calendarDate(date), date)
  for (const date of ['1900-02-29', '2026-02-29', '0000-01-01', '2026-04-31', '2026-1-01']) {
    assert.throws(() => calendarDate(date))
  }
})

test('encrypted envelopes reject plaintext, unsupported formats and noncanonical encodings', () => {
  const envelope = {
    format: 'heyday-record-v1', algorithm: 'A256GCM', keyId: 'key-1',
    nonce: Buffer.alloc(12).toString('base64url'), ciphertext: Buffer.alloc(16).toString('base64url'),
  }
  assert.deepEqual(encryptedRecord(envelope), envelope)
  for (const change of [{ name: 'secret' }, { algorithm: 'none' }, { nonce: 'AA' }, { ciphertext: 'AA' }]) {
    assert.throws(() => encryptedRecord({ ...envelope, ...change }))
  }
  assert.throws(() => base64url('AB', 1, 1, 'test'))
  assert.equal(base64url('AA', 1, 1, 'test'), 'AA')
  assert.throws(() => base64url('AA==', 1, 1, 'test'))
})

test('GCM authentication binds dataset, record, mutation, version, operation and key', async () => {
  const context = { datasetId: 'dataset-1', recordId: 'default-fee-interest', mutationId: 'mutation-1', baseVersion: '0', operation: 'put' as const }
  const aad = recordAdditionalData(context, 'key-1')
  assert.equal(new TextDecoder().decode(aad), '["heyday-record-v1","A256GCM","dataset-1","default-fee-interest","mutation-1","0","put","key-1"]')
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode('{"name":"Private category"}')
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, plaintext)
  const result = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, ciphertext)
  assert.deepEqual(new Uint8Array(result), plaintext)
  for (const change of [{ datasetId: 'dataset-2' }, { recordId: 'record-2' }, { mutationId: 'mutation-2' }, { baseVersion: '1' }, { operation: 'delete' as const }]) {
    await assert.rejects(crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: recordAdditionalData({ ...context, ...change }, 'key-1'), tagLength: 128 }, key, ciphertext))
  }
  await assert.rejects(crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: recordAdditionalData(context, 'key-2'), tagLength: 128 }, key, ciphertext))
})

test('HTTP errors are private, correlated and do not leak internal exceptions', async () => {
  const response = await apiResponse(async () => { throw new Error('postgres://secret') })
  const body = await response.json()
  assert.equal(response.status, 500)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(body.requestId, response.headers.get('x-request-id'))
  assert.equal(JSON.stringify(body).includes('secret'), false)
  const invalid = await apiResponse(async () => money(1))
  assert.equal(invalid.status, 400)
  assert.deepEqual((await invalid.json()).details, [{ field: 'amount' }])
})

test('JSON reader bounds actual stream bytes and rejects malformed UTF-8', async () => {
  const request = (body: BodyInit) => new Request('https://example.test', {
    method: 'POST', body, headers: { 'Content-Type': 'application/json', 'Content-Length': '1' },
  })
  assert.deepEqual(await readJson(request('{"ok":true}'), 11), { ok: true })
  await assert.rejects(readJson(request('{"ok":true}'), 10), { code: 'PAYLOAD_TOO_LARGE' })
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(8))
    controller.enqueue(new Uint8Array(8))
    controller.close()
  } })
  await assert.rejects(readJson(new Request('https://example.test', {
    method: 'POST', body: stream, duplex: 'half', headers: { 'Content-Type': 'application/json' },
  } as RequestInit), 10), { code: 'PAYLOAD_TOO_LARGE' })
  await assert.rejects(readJson(request(new Uint8Array([34, 255, 34])), 10))
  await assert.rejects(readJson(request('{'), 10))
})
