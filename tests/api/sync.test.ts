import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash, createHmac, hkdfSync } from 'node:crypto'
import { commitData, mutation } from '../../src/contracts/v1/sync'

const fixture=JSON.parse(readFileSync(new URL('../fixtures/sync-v1.json',import.meta.url),'utf8'))
test('sync envelope rejects plaintext, ambiguous versions, weak digests and unbounded ciphertext',()=>{
  const valid=mutation(fixture.change.request)
  assert.deepEqual(valid,fixture.change.request)
  for(const value of [ {...valid,amount:'100'}, {...valid,recoveryKey:'secret'}, {...valid,protocol:6}, {...valid,recordId:'planner-expense-0'}, {...valid,baseVersion:'01'}, {...valid,commitMac:'x'}, {...valid,previous:{...valid.previous,owner:'someone'}}, {...valid,payload:{...valid.payload,ciphertext:'A'.repeat(20000)}}, {...valid,payload:{...valid.payload,salt:'AA'}}, {...valid,payload:{...valid.payload,format:'heyday-record-v1'}} ]) assert.throws(()=>mutation(value))
})
test('Web Crypto decrypts derived record keys and verifies the cross-language history MAC',async()=>{
  const m=mutation(fixture.change.request),root=Buffer.from(fixture.rootKey,'base64url')
  const derive=(info:unknown,salt=Buffer.alloc(0))=>Buffer.from(hkdfSync('sha256',root,salt,Buffer.from(JSON.stringify(info)),32))
  const digest=createHash('sha256').update(commitData(m)).digest()
  assert.equal(digest.toString('hex'),m.commitHash)
  assert.equal(createHmac('sha256',derive(['heyday-sync-mac-v1',m.datasetId,m.payload.keyId])).update(digest).digest('base64url'),m.commitMac)
  assert.equal(createHmac('sha256',derive(['heyday-record-id-v1',m.datasetId,m.payload.keyId])).update(JSON.stringify(['category',fixture.localId])).digest('base64url'),m.recordId)
  const key=await crypto.subtle.importKey('raw',derive(['heyday-record-key-v2',m.datasetId,m.recordId,m.mutationId,m.payload.keyId],Buffer.from(m.payload.salt,'base64url')),'AES-GCM',false,['decrypt'])
  const aad=Buffer.from(JSON.stringify(['heyday-record-v2','A256GCM-HKDF-SHA256',m.datasetId,m.recordId,m.mutationId,m.baseVersion,m.operation,m.payload.keyId,m.payload.salt]))
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(m.payload.nonce,'base64url'),additionalData:aad,tagLength:128},key,Buffer.from(m.payload.ciphertext,'base64url'))
  assert.equal(Buffer.from(bytes).toString(),fixture.plaintext)
})

test('protocol 3 authenticates its version and bounds complete income aggregates',async()=>{
  const f=JSON.parse(readFileSync(new URL('../fixtures/sync-v3.json',import.meta.url),'utf8'))
  const m=mutation(f.change.request)
  assert.equal(createHash('sha256').update(commitData(m)).digest('hex'),m.commitHash)
  assert.notEqual(commitData({...m,protocol:2}),commitData(m))
  const root=Buffer.from(f.rootKey,'base64url')
  const derive=(info:unknown,salt=Buffer.alloc(0))=>Buffer.from(hkdfSync('sha256',root,salt,Buffer.from(JSON.stringify(info)),32))
  assert.equal(createHmac('sha256',derive(['heyday-record-id-v1',m.datasetId,m.payload.keyId])).update(JSON.stringify(['income','public-test-income'])).digest('base64url'),m.recordId)
  assert.equal(createHmac('sha256',derive(['heyday-sync-mac-v1',m.datasetId,m.payload.keyId])).update(Buffer.from(m.commitHash,'hex')).digest('base64url'),m.commitMac)
  const key=await crypto.subtle.importKey('raw',derive(['heyday-record-key-v2',m.datasetId,m.recordId,m.mutationId,m.payload.keyId],Buffer.from(m.payload.salt,'base64url')),'AES-GCM',false,['decrypt'])
  const aad=Buffer.from(JSON.stringify(['heyday-record-v2','A256GCM-HKDF-SHA256',m.datasetId,m.recordId,m.mutationId,m.baseVersion,m.operation,m.payload.keyId,m.payload.salt]))
  assert.equal(Buffer.from(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(m.payload.nonce,'base64url'),additionalData:aad,tagLength:128},key,Buffer.from(m.payload.ciphertext,'base64url'))).toString(),f.plaintext)
  const large={...m,payload:{...m.payload,ciphertext:Buffer.alloc(2_097_152).toString('base64url')}}
  assert.equal(mutation(large).protocol,3)
  assert.throws(()=>mutation({...large,protocol:2}))
  assert.throws(()=>mutation({...large,payload:{...large.payload,ciphertext:Buffer.alloc(2_097_153).toString('base64url')}}))
})

test('protocol 4 authenticates income forecast identity and rejects downgrade',async()=>{
  const f=JSON.parse(readFileSync(new URL('../fixtures/sync-v4.json',import.meta.url),'utf8'))
  const m=mutation(f.change.request)
  assert.equal(createHash('sha256').update(commitData(m)).digest('hex'),m.commitHash)
  assert.notEqual(commitData({...m,protocol:2}),commitData(m))
  const root=Buffer.from(f.rootKey,'base64url')
  const derive=(info:unknown,salt=Buffer.alloc(0))=>Buffer.from(hkdfSync('sha256',root,salt,Buffer.from(JSON.stringify(info)),32))
  assert.equal(createHmac('sha256',derive(['heyday-record-id-v1',m.datasetId,m.payload.keyId])).update(JSON.stringify(['income-plan','income_2026-11_public-test-income'])).digest('base64url'),m.recordId)
  assert.equal(createHmac('sha256',derive(['heyday-sync-mac-v1',m.datasetId,m.payload.keyId])).update(Buffer.from(m.commitHash,'hex')).digest('base64url'),m.commitMac)
  const key=await crypto.subtle.importKey('raw',derive(['heyday-record-key-v2',m.datasetId,m.recordId,m.mutationId,m.payload.keyId],Buffer.from(m.payload.salt,'base64url')),'AES-GCM',false,['decrypt'])
  const aad=Buffer.from(JSON.stringify(['heyday-record-v2','A256GCM-HKDF-SHA256',m.datasetId,m.recordId,m.mutationId,m.baseVersion,m.operation,m.payload.keyId,m.payload.salt]))
  assert.equal(Buffer.from(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(m.payload.nonce,'base64url'),additionalData:aad,tagLength:128},key,Buffer.from(m.payload.ciphertext,'base64url'))).toString(),f.plaintext)
  const large={...m,payload:{...m.payload,ciphertext:Buffer.alloc(2_097_152).toString('base64url')}}
  assert.equal(mutation(large).protocol,4)
  assert.throws(()=>mutation({...large,protocol:2}))
  assert.throws(()=>mutation({...large,payload:{...large.payload,ciphertext:Buffer.alloc(2_097_153).toString('base64url')}}))
})

test('protocol 5 authenticates complete financial identity and rejects downgrade',async()=>{
  const f=JSON.parse(readFileSync(new URL('../fixtures/sync-v5.json',import.meta.url),'utf8'))
  const m=mutation(f.change.request)
  assert.equal(createHash('sha256').update(commitData(m)).digest('hex'),m.commitHash)
  assert.notEqual(commitData({...m,protocol:2}),commitData(m))
  const root=Buffer.from(f.rootKey,'base64url')
  const derive=(info:unknown,salt=Buffer.alloc(0))=>Buffer.from(hkdfSync('sha256',root,salt,Buffer.from(JSON.stringify(info)),32))
  assert.equal(createHmac('sha256',derive(['heyday-record-id-v1',m.datasetId,m.payload.keyId])).update(JSON.stringify(['metadata','opening:1'])).digest('base64url'),m.recordId)
  assert.equal(createHmac('sha256',derive(['heyday-sync-mac-v1',m.datasetId,m.payload.keyId])).update(Buffer.from(m.commitHash,'hex')).digest('base64url'),m.commitMac)
  const key=await crypto.subtle.importKey('raw',derive(['heyday-record-key-v2',m.datasetId,m.recordId,m.mutationId,m.payload.keyId],Buffer.from(m.payload.salt,'base64url')),'AES-GCM',false,['decrypt'])
  const aad=Buffer.from(JSON.stringify(['heyday-record-v2','A256GCM-HKDF-SHA256',m.datasetId,m.recordId,m.mutationId,m.baseVersion,m.operation,m.payload.keyId,m.payload.salt]))
  assert.equal(Buffer.from(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(m.payload.nonce,'base64url'),additionalData:aad,tagLength:128},key,Buffer.from(m.payload.ciphertext,'base64url'))).toString(),f.plaintext)
  const large={...m,payload:{...m.payload,ciphertext:Buffer.alloc(2_097_152).toString('base64url')}}
  assert.equal(mutation(large).protocol,5)
  assert.throws(()=>mutation({...large,protocol:2}))
  assert.throws(()=>mutation({...large,payload:{...large.payload,ciphertext:Buffer.alloc(2_097_153).toString('base64url')}}))
})
