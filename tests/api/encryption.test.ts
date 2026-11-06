import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { keyEnvelope, keyRotation, recoveryAdditionalData, recoveryKeyInfo } from '../../src/contracts/v1/encryption'
import { encryptedRecord, recordAdditionalData } from '../../src/contracts/v1/encrypted-record'

test('key envelopes accept only bounded ciphertext metadata and reject plaintext keys', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/e2ee-v1.json', import.meta.url), 'utf8'))
  const envelope = keyEnvelope(fixture.envelope)
  for (const extra of ['recoveryKey', 'dataKey', 'userId', 'deviceId', 'plaintext']) assert.throws(() => keyEnvelope({ ...envelope, [extra]: 'secret' }))
  for (const field of ['nonce', 'salt', 'ciphertext']) assert.throws(() => keyEnvelope({ ...envelope, [field]: envelope[field as 'nonce'] + '=' }))
  assert.throws(() => keyEnvelope({ ...envelope, ciphertext: Buffer.alloc(47).toString('base64url') }))
  assert.throws(() => keyEnvelope({ ...envelope, kdf: 'password' }))
})

test('rotation envelopes bound ciphertext, bind both epochs and reject plaintext or reused keys', () => {
  const f=JSON.parse(readFileSync(new URL('../fixtures/key-rotation-v1.json',import.meta.url),'utf8'))
  assert.deepEqual(keyRotation(f.rotation),f.rotation)
  for(const field of ['recoveryKey','dataKey','userId','plaintext']) assert.throws(()=>keyRotation({...f.rotation,[field]:'secret'}))
  assert.throws(()=>keyRotation({...f.rotation,key:f.rotation.previousKey}))
  assert.throws(()=>keyRotation({...f.rotation,key:{...f.rotation.key,datasetId:'00000000-0000-4000-8000-000000000000'}}))
  assert.throws(()=>keyRotation({...f.rotation,head:{sequence:'01',hash:'0'.repeat(64)}}))
  assert.throws(()=>keyRotation({...f.rotation,history:{...f.rotation.history,ciphertext:Buffer.alloc(131073).toString('base64url')}}))
  assert.throws(()=>keyRotation({...f.rotation,proof:f.rotation.proof+'='}))
})

test('Web Crypto independently verifies the rotation archive and old-key transition proof', async () => {
  const f=JSON.parse(readFileSync(new URL('../fixtures/key-rotation-v1.json',import.meta.url),'utf8'))
  const r=keyRotation(f.rotation), bytes=(value:string)=>new Uint8Array(Buffer.from(value,'base64url')), json=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value))
  const e=(key:typeof r.key)=>[key.format,key.algorithm,key.kdf,key.datasetId,key.keyId,key.salt,key.nonce,key.ciphertext]
  const input=await crypto.subtle.importKey('raw',bytes(f.newKey),'HKDF',false,['deriveKey'])
  const key=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:bytes(r.history.salt),info:json(['heyday-key-history-v1',f.owner,r.key.datasetId,r.key.keyId])},input,{name:'AES-GCM',length:256},false,['decrypt'])
  const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(r.history.nonce),additionalData:json(['heyday-key-history-v1',f.owner,e(r.key)])},key,bytes(r.history.ciphertext))
  assert.deepEqual(JSON.parse(new TextDecoder().decode(plaintext)),f.history)
  const old=await crypto.subtle.importKey('raw',bytes(f.oldKey),'HKDF',false,['deriveKey'])
  const proofKey=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new Uint8Array(),info:new TextEncoder().encode('heyday-control-mac-v1')},old,{name:'HMAC',hash:'SHA-256',length:256},false,['verify'])
  const data=json([r.format,f.owner,e(r.previousKey),e(r.key),r.head.sequence,r.head.hash,r.history.salt,r.history.nonce,r.history.ciphertext])
  assert.equal(await crypto.subtle.verify('HMAC',proofKey,bytes(r.proof),data),true)
  data[0]^=1
  assert.equal(await crypto.subtle.verify('HMAC',proofKey,bytes(r.proof),data),false)
})

test('Web Crypto key wrapping and financial records match the native interoperability vectors', async () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/e2ee-v1.json', import.meta.url), 'utf8'))
  const bytes = (value: string) => new Uint8Array(Buffer.from(value, 'base64url'))
  const envelope = keyEnvelope(fixture.envelope)
  const input = await crypto.subtle.importKey('raw', bytes(fixture.recoveryKey), 'HKDF', false, ['deriveKey'])
  const wrapping = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: bytes(envelope.salt), info: recoveryKeyInfo(fixture.owner, envelope) }, input, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
  const dataKey = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(envelope.nonce), additionalData: recoveryAdditionalData(fixture.owner, envelope) }, wrapping, bytes(envelope.ciphertext))
  assert.equal(Buffer.from(dataKey).toString('base64url'), fixture.dataKey)
  await assert.rejects(crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(envelope.nonce), additionalData: recoveryAdditionalData('other-owner', envelope) }, wrapping, bytes(envelope.ciphertext)))
  const record = encryptedRecord(fixture.record)
  const aes = await crypto.subtle.importKey('raw', dataKey, 'AES-GCM', false, ['decrypt'])
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(record.nonce), additionalData: recordAdditionalData(fixture.context, record.keyId) }, aes, bytes(record.ciphertext))
  assert.equal(new TextDecoder().decode(plaintext), fixture.plaintext)
})
