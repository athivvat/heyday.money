import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { getMigrations } from 'better-auth/db/migration'
import { authOptions } from '../../src/server/auth/options'
import { migrateCloud } from '../../src/server/db/migrate'
import { DeviceService } from '../../src/server/devices/service'
import { deviceHandler } from '../../src/server/devices/handler'
import { SyncService } from '../../src/server/sync/service'
import { syncHandler } from '../../src/server/sync/handler'
import { commitData, ZERO_HASH, type Head, type Mutation } from '../../src/contracts/v1/sync'
import type { KeyRotation } from '../../src/contracts/v1/encryption'

test('PostgreSQL rotation CAS, retries, epoch enforcement, isolation, expiry and rollback', {skip:!process.env.TEST_DATABASE_URL}, async()=>{
  const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL}), schema=`rotation_test_${randomUUID().replaceAll('-','')}`
  await admin.query(`CREATE SCHEMA "${schema}"`)
  const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:6,options:`-c search_path=${schema}`})
  try {
    const options=authOptions({url:'http://localhost:3000',secret:'rotation-test-secret-01234567890123456789',databaseUrl:'',resendApiKey:'',emailFrom:''},pool,async()=>{})
    await (await getMigrations(options)).runMigrations(); await migrateCloud(pool,true); await migrateCloud(pool,true)
    for(const id of ['alice','bob']) {
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,true,now(),now())',[id,`${id}@example.test`])
      for(const suffix of ['one','two','unregistered']) await pool.query('INSERT INTO "session"(id,"userId",token,"expiresAt","createdAt","updatedAt") VALUES($1,$2,$1,now()+interval \'1 hour\',now(),now())',[`${id}-${suffix}`,id])
    }
    const identities={alice:{userId:'alice',sessionId:'alice-one'},other:{userId:'alice',sessionId:'alice-two'},bob:{userId:'bob',sessionId:'bob-one'},unregistered:{userId:'alice',sessionId:'alice-unregistered'}}
    const verify=async({body}:{body:{token:string}})=>identities[body.token as keyof typeof identities]
    const devices=new DeviceService(pool),sync=new SyncService(devices,true),handle=deviceHandler(devices,verify),syncHttp=syncHandler(sync,verify)
    const call=(token:string,input:unknown)=>handle(new Request('http://localhost:3000/api/v1/encryption/keys',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(input)}),'rotate-key')
    for(const identity of [identities.alice,identities.other,identities.bob]) await devices.register(identity,{installationId:randomUUID(),name:'Test device',platform:'macos'})
    const dataset=(await devices.me(identities.alice)).dataset.id
    const fixture=JSON.parse(readFileSync(new URL('../fixtures/key-rotation-v1.json',import.meta.url),'utf8'))
    const first={...fixture.rotation.previousKey,datasetId:dataset}
    await devices.keys(identities.alice,first)
    const makeRotation=(previousKey=first,head:Head={sequence:'0',hash:ZERO_HASH}):KeyRotation=>({...fixture.rotation,previousKey,key:{...fixture.rotation.key,keyId:randomUUID(),datasetId:dataset},head})
    // No premium is required to replace keys. The server treats crypto as opaque;
    // the native/Web Crypto tests verify all MACs, archives and recovered roots.
    const candidate=makeRotation()
    assert.equal((await call('unregistered',candidate)).status,403)
    assert.equal((await call('bob',candidate)).status,409)
    assert.equal((await call('alice',{...candidate,recoveryKey:'never-accepted'})).status,400)
    const raced=await Promise.all([call('alice',candidate),call('other',makeRotation())])
    assert.deepEqual(raced.map(r=>r.status).sort(),[200,409])
    let state=await devices.keys(identities.alice), winner=state.rotation!
    assert.equal((await call('other',winner)).status,200)
    assert.deepEqual((await devices.keys(identities.other)).rotation,winner)
    assert.equal((await call('alice',{...winner,proof:Buffer.alloc(32).toString('base64url')})).status,409)
    assert.equal((await devices.keys(identities.bob)).key,null)
    assert.equal((await pool.query('SELECT count(*) FROM cloud_key_rotations')).rows[0].count,'1')
    const fixtureMutation=JSON.parse(readFileSync(new URL('../fixtures/sync-v1.json',import.meta.url),'utf8')).change.request
    function mutation(keyId:string,previous:Head={sequence:'0',hash:ZERO_HASH},baseVersion='0'):Mutation {
      const m:Mutation={...fixtureMutation,datasetId:dataset,mutationId:randomUUID(),baseVersion,previous,payload:{...fixtureMutation.payload,keyId}}
      m.commitHash=createHash('sha256').update(commitData(m)).digest('hex');return m
    }
    await pool.query("INSERT INTO cloud_sync_entitlements(user_id,access_until) VALUES('alice',now()+interval '1 hour')")
    await assert.rejects(sync.page(identities.alice,new URL(`http://localhost/?datasetId=${dataset}`),5),{code:'CLIENT_UPGRADE_REQUIRED'})
    await assert.rejects(sync.push(identities.alice,mutation(first.keyId),5,2),{code:'KEY_CHANGED'})
    const request=mutation(winner.key.keyId), accepted=await sync.push(identities.alice,request,5,2)
    assert.equal(accepted.kind,'accepted')
    const head={sequence:'1',hash:request.commitHash}
    assert.equal((await call('alice',makeRotation(winner.key))).status,409,'stale head cannot rotate')
    const next=makeRotation(winner.key,head)
    // Prove a DB failure rolls back both the retry receipt and the current key.
    await pool.query("CREATE FUNCTION fail_key_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$")
    await pool.query('CREATE TRIGGER fail_rotation BEFORE UPDATE ON cloud_keys FOR EACH ROW EXECUTE FUNCTION fail_key_update()')
    assert.equal((await call('alice',next)).status,500)
    assert.equal((await pool.query('SELECT count(*) FROM cloud_key_rotations')).rows[0].count,'1')
    assert.deepEqual((await devices.keys(identities.alice)).key,winner.key)
    await pool.query('DROP TRIGGER fail_rotation ON cloud_keys')
    assert.equal((await call('alice',next)).status,200)
    state=await devices.keys(identities.alice); assert.deepEqual(state.key,next.key)
    const oldRetry=await call('other',winner); assert.equal(oldRetry.status,200); assert.deepEqual((await oldRetry.json()).key,next.key)
    assert.deepEqual((await devices.keys(identities.alice)).key,next.key,'old rotation retry never rolls back')
    assert.deepEqual(await sync.push(identities.other,request,5,2),accepted,'old accepted mutation still has an exact retry receipt')
    await assert.rejects(sync.push(identities.other,mutation(winner.key.keyId,head,'1'),5,2),{code:'KEY_CHANGED'})
    assert.equal((await sync.push(identities.alice,mutation(next.key.keyId,head,'1'),5,2)).kind,'accepted')
    const page=await syncHttp(new Request(`http://localhost/api/v1/sync/pull?datasetId=${dataset}`,{headers:{authorization:'Bearer alice','X-Heyday-Sync':'5','X-Heyday-Keys':'2'}}),'pull')
    assert.equal(page.status,200); assert.equal((await page.json()).changes.length,2)
    await pool.query("UPDATE cloud_sync_entitlements SET access_until=now()-interval '1 second'")
    await assert.rejects(sync.page(identities.alice,new URL(`http://localhost/?datasetId=${dataset}`),5,2),{code:'PREMIUM_REQUIRED'})
    assert.deepEqual((await devices.keys(identities.alice)).key,next.key)
    const dev=(await devices.me(identities.other)).device!
    await devices.revoke(identities.alice,dev.id)
    assert.equal((await call('other',next)).status,401)
  } finally { await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end() }
})
