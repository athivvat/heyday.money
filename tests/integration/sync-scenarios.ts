import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Pool } from 'pg'
import { commitData, ZERO_HASH, type Head, type Mutation } from '../../src/contracts/v1/sync'
import { DeviceService, type DesktopIdentity } from '../../src/server/devices/service'
import { SyncService } from '../../src/server/sync/service'
import { syncHandler } from '../../src/server/sync/handler'

export async function syncScenarios(pool:Pool,verify:(input:{body:{token:string}})=>Promise<DesktopIdentity>,alice:string,other:string,bob:string,datasetId:string,keyId:string) {
  const fixture=JSON.parse(readFileSync(new URL('../fixtures/sync-v1.json',import.meta.url),'utf8'))
  const service=new SyncService(new DeviceService(pool),true),handle=syncHandler(service,verify)
  const a=await verify({body:{token:alice}}),b=await verify({body:{token:bob}})
  const call=(token:string,action:'push'|'pull'|'snapshot',body?:unknown,query=`?datasetId=${datasetId}`,protocol=1)=>handle(new Request(`http://localhost:3000/api/v1/sync/${action}${query}`,{method:action==='push'?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','X-Heyday-Sync':String(protocol)},...(body?{body:JSON.stringify(body)}:{})}),action)
  const make=(previous:Head={sequence:'0',hash:ZERO_HASH},baseVersion='0',recordId=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')):Mutation=>{
    // Server tests intentionally treat ciphertext as opaque. Real encryption/MAC
    // interoperability is covered separately; the server cannot verify a client MAC.
    const m:Mutation={...fixture.change.request,datasetId,mutationId:randomUUID(),recordId,baseVersion,previous,payload:{...fixture.change.request.payload,keyId},commitHash:''}
    m.commitHash=createHash('sha256').update(commitData(m)).digest('hex');return m
  }
  const first=make()
  assert.equal((await call(alice,'push',first)).status,403)
  for(const id of [a.userId,b.userId])await pool.query("INSERT INTO cloud_sync_entitlements(user_id,access_until) VALUES($1,now()+interval '1 hour')",[id])
  assert.equal((await call(bob,'pull')).status,404)
  assert.equal((await call(alice,'push',{...first,name:'plaintext financial name'})).status,400)
  const raced=await Promise.all([call(alice,'push',first),call(other,'push',make())])
  const values=await Promise.all(raced.map(r=>r.json()))
  assert.deepEqual(values.map(v=>v.kind).sort(),['accepted','conflict'])
  const accepted=values.find(v=>v.kind==='accepted').change
  assert.equal((await (await call(other,'push',accepted.request)).json()).kind,'accepted')
  assert.equal((await pool.query('SELECT count(*) FROM cloud_sync_changes WHERE dataset_id=$1',[datasetId])).rows[0].count,'1')
  const reused={...accepted.request,commitMac:Buffer.alloc(32,2).toString('base64url')}
  assert.equal((await call(other,'push',reused)).status,409)
  const initial=await (await call(alice,'snapshot')).json()
  assert.equal(initial.changes.length,1)
  assert.equal(initial.hasMore,false)
  let head:Head={sequence:accepted.sequence,hash:accepted.request.commitHash}
  const stale=make(head,'0',accepted.request.recordId)
  assert.equal((await (await call(other,'push',stale)).json()).kind,'conflict')
  // More than one page, while preserving a prior immutable bootstrap boundary.
  for(let i=0;i<52;i++){
    const m=make(head)
    const response=await call(alice,'push',m);assert.equal(response.status,200)
    const result=await response.json();assert.equal(result.kind,'accepted')
    head={sequence:result.change.sequence,hash:m.commitHash}
  }
  const frozen=await (await call(other,'snapshot',undefined,`?datasetId=${datasetId}&boundary=${initial.boundary}`)).json()
  assert.equal(frozen.changes.length,1);assert.equal(frozen.boundary,initial.boundary)
  const page=await (await call(other,'pull')).json()
  assert.equal(page.changes.length,50);assert.equal(page.hasMore,true)
  const next=await (await call(other,'pull',undefined,`?datasetId=${datasetId}&cursor=${page.cursor}&boundary=${page.boundary}`)).json()
  assert.deepEqual(next.changes.map((c:{sequence:string})=>c.sequence),['51','52','53'])
  assert.equal(next.hasMore,false)
  assert.equal((await call(bob,'pull',undefined,`?datasetId=${datasetId}&cursor=${page.cursor}`)).status,404)
  assert.equal((await call(alice,'pull',undefined,`?datasetId=${datasetId}&cursor=not-a-cursor`)).status,400)
  // Failure after inserting immutable history must roll back the record and head.
  await pool.query("CREATE FUNCTION reject_sync_head() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$")
  await pool.query('CREATE TRIGGER reject_sync BEFORE UPDATE ON cloud_sync_state FOR EACH ROW EXECUTE FUNCTION reject_sync_head()')
  const retry=make(head)
  assert.equal((await call(other,'push',retry)).status,500)
  assert.equal((await pool.query('SELECT sequence::text FROM cloud_sync_state WHERE dataset_id=$1',[datasetId])).rows[0].sequence,head.sequence)
  assert.equal((await pool.query('SELECT count(*) FROM cloud_sync_changes WHERE dataset_id=$1 AND mutation_id=$2',[datasetId,retry.mutationId])).rows[0].count,'0')
  await pool.query('DROP TRIGGER reject_sync ON cloud_sync_state')
  assert.equal((await (await call(other,'push',retry)).json()).kind,'accepted')
  await pool.query("UPDATE cloud_sync_entitlements SET access_until=now()-interval '1 second' WHERE user_id=$1",[a.userId])
  for(const action of ['push','pull','snapshot'] as const)assert.equal((await call(other,action,action==='push'?retry:undefined)).status,403)
  assert.equal((await pool.query('SELECT count(*) FROM cloud_sync_changes WHERE dataset_id=$1',[datasetId])).rows[0].count,'54')
  // Paid subscription access uses the same gate for all three operations. Expiry
  // retains encrypted records, and resubscription resumes exact pending retries.
  await pool.query('INSERT INTO billing_accounts(user_id,customer_key) VALUES($1,$2)',[a.userId,randomUUID()])
  await pool.query("INSERT INTO billing_subscriptions(subscription_id,user_id,status,access_until) VALUES('sub_sync_test',$1,'active',now()+interval '1 hour')",[a.userId])
  for(const action of ['push','pull','snapshot'] as const)assert.equal((await call(other,action,action==='push'?retry:undefined)).status,200)
  await pool.query("UPDATE billing_subscriptions SET access_until=now()-interval '1 second' WHERE user_id=$1",[a.userId])
  for(const action of ['push','pull','snapshot'] as const)assert.equal((await call(other,action,action==='push'?retry:undefined)).status,403)
  await pool.query('DELETE FROM cloud_api_usage') // Separate billing scenarios from the remaining protocol checks.
  await pool.query("UPDATE cloud_sync_entitlements SET access_until=now()+interval '1 hour' WHERE user_id=$1",[a.userId])
  assert.equal((await (await call(other,'push',retry)).json()).kind,'accepted')
  // A ledger record upgrades the dataset, and byte pagination must preserve whole operations.
  head={sequence:'54',hash:retry.commitHash}
  const ledger:Mutation={...make(head),protocol:2,payload:{...retry.payload,ciphertext:Buffer.alloc(250_000,7).toString('base64url')}}
  ledger.commitHash=createHash('sha256').update(commitData(ledger)).digest('hex')
  assert.equal((await call(other,'push',ledger)).status,413)
  const ledgerResponse=await call(other,'push',ledger,undefined,2);assert.equal(ledgerResponse.status,200)
  const ledgerAccepted=await ledgerResponse.json();assert.equal(ledgerAccepted.kind,'accepted')
  for(const action of ['pull','snapshot'] as const){const old=await call(other,action);assert.equal(old.status,426);assert.equal((await old.json()).code,'CLIENT_UPGRADE_REQUIRED')}
  assert.equal((await call(other,'push',retry)).status,426)
  assert.equal((await (await call(other,'push',ledger,undefined,2)).json()).kind,'accepted')
  head={sequence:ledgerAccepted.change.sequence,hash:ledger.commitHash}
  for(let i=0;i<3;i++){
    const m:Mutation={...make(head),protocol:2,payload:ledger.payload};m.commitHash=createHash('sha256').update(commitData(m)).digest('hex')
    const response=await call(other,'push',m,undefined,2);assert.equal(response.status,200);const accepted=await response.json();assert.equal(accepted.kind,'accepted');head={sequence:accepted.change.sequence,hash:m.commitHash}
  }
  let cursor=next.cursor,total=0
  for(let pages=0;pages<5;pages++){
    const response=await call(other,'pull',undefined,`?datasetId=${datasetId}&cursor=${cursor}`,2)
    assert.equal(response.status,200);const raw=await response.text();assert.ok(Buffer.byteLength(raw)<1_048_576)
    const page=JSON.parse(raw);assert.ok(page.changes.length>0);total+=page.changes.length;cursor=page.cursor
    if(!page.hasMore)break
  }
  assert.equal(total,5)
  // Entitlement continues to protect protocol 2 and exact retries after upgrade.
  await pool.query("UPDATE cloud_sync_entitlements SET revoked_at=now() WHERE user_id=$1",[a.userId])
  assert.equal((await call(other,'pull',undefined,undefined,2)).status,403)
  await pool.query("UPDATE cloud_sync_entitlements SET revoked_at=NULL WHERE user_id=$1",[a.userId])
  // Full income aggregates upgrade the minimum client and retain bounded, whole-record pages.
  const income:Mutation={...make(head),protocol:3,payload:{...retry.payload,ciphertext:Buffer.alloc(2_097_152,8).toString('base64url')}}
  income.commitHash=createHash('sha256').update(commitData(income)).digest('hex')
  assert.equal((await call(other,'push',income,undefined,2)).status,413)
  const v3=await (await call(other,'push',income,undefined,3)).json();assert.equal(v3.kind,'accepted')
  for(const action of ['pull','snapshot'] as const)assert.equal((await call(other,action,undefined,undefined,2)).status,426)
  assert.equal((await (await call(other,'push',income,undefined,3)).json()).kind,'accepted')
  const response=await call(other,'pull',undefined,`?datasetId=${datasetId}&cursor=${cursor}`,3)
  assert.equal(response.status,200);const raw=await response.text();assert.ok(Buffer.byteLength(raw)<4_194_304)
  const complete=JSON.parse(raw);assert.equal(complete.changes.length,1);assert.equal(complete.changes[0].request.mutationId,income.mutationId);assert.equal(complete.hasMore,false)
  await pool.query("UPDATE cloud_sync_entitlements SET revoked_at=now() WHERE user_id=$1",[a.userId])
  for(const action of ['push','pull','snapshot'] as const)assert.equal((await call(other,action,action==='push'?income:undefined,undefined,3)).status,403)
  await pool.query("UPDATE cloud_sync_entitlements SET revoked_at=NULL WHERE user_id=$1",[a.userId])
  // Forecast overrides gate v3 clients; new clients can still retry exact older requests.
  head={sequence:v3.change.sequence,hash:income.commitHash}
  const forecast:Mutation={...make(head),protocol:4}
  forecast.commitHash=createHash('sha256').update(commitData(forecast)).digest('hex')
  assert.equal((await call(other,'push',forecast,undefined,3)).status,426)
  const v4=await (await call(other,'push',forecast,undefined,4)).json();assert.equal(v4.kind,'accepted')
  for(const action of ['pull','snapshot'] as const)assert.equal((await call(other,action,undefined,undefined,3)).status,426)
  assert.equal((await (await call(other,'push',income,undefined,4)).json()).kind,'accepted')
  assert.equal((await (await call(other,'push',forecast,undefined,4)).json()).kind,'accepted')
  const plans=await (await call(other,'pull',undefined,`?datasetId=${datasetId}&cursor=${complete.cursor}`,4)).json()
  assert.equal(plans.changes.length,1);assert.equal(plans.changes[0].request.mutationId,forecast.mutationId);assert.equal(plans.hasMore,false)
  await pool.query("UPDATE cloud_sync_entitlements SET revoked_at=now() WHERE user_id=$1",[a.userId])
  for(const action of ['push','pull','snapshot'] as const)assert.equal((await call(other,action,action==='push'?forecast:undefined,undefined,4)).status,403)
  await pool.query("UPDATE cloud_sync_entitlements SET revoked_at=NULL WHERE user_id=$1",[a.userId])
  // Reset the isolated test counter before the next compatibility matrix.
  await pool.query('DELETE FROM cloud_api_usage')
  // Complete financial metadata requires v5, while preserving older exact retries.
  head={sequence:v4.change.sequence,hash:forecast.commitHash}
  const metadata:Mutation={...make(head),protocol:5}
  metadata.commitHash=createHash('sha256').update(commitData(metadata)).digest('hex')
  assert.equal((await call(other,'push',metadata,undefined,4)).status,426)
  const v5=await (await call(other,'push',metadata,undefined,5)).json();assert.equal(v5.kind,'accepted')
  for(const version of [1,2,3,4])for(const action of ['pull','snapshot'] as const)assert.equal((await call(other,action,undefined,undefined,version)).status,426)
  assert.equal((await (await call(other,'push',forecast,undefined,5)).json()).kind,'accepted')
  assert.equal((await (await call(other,'push',metadata,undefined,5)).json()).kind,'accepted')
  const all=await (await call(other,'pull',undefined,`?datasetId=${datasetId}&cursor=${plans.cursor}`,5)).json()
  assert.equal(all.changes.length,1);assert.equal(all.changes[0].request.mutationId,metadata.mutationId);assert.equal(all.hasMore,false)
  await pool.query("UPDATE cloud_sync_entitlements SET revoked_at=now() WHERE user_id=$1",[a.userId])
  for(const action of ['push','pull','snapshot'] as const)assert.equal((await call(other,action,action==='push'?metadata:undefined,undefined,5)).status,403)
  await pool.query("UPDATE cloud_sync_entitlements SET revoked_at=NULL WHERE user_id=$1",[a.userId])
  // Device scenarios continue below; reset only the isolated test's request counter.
  await pool.query('DELETE FROM cloud_api_usage')
  return { handle, retry }
}
