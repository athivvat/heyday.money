import { Pool } from 'pg'

// Operator-only CLI. There is deliberately no client-facing grant endpoint.
const args = process.argv.slice(2)
const email = args[args.indexOf('--email') + 1]
const revoke = args.includes('--revoke')
const until = args[args.indexOf('--until') + 1]
let pool: Pool | undefined
try {
  if (!args.includes('--email') || !email || (!revoke && (!args.includes('--until') || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(until ?? '') || !Number.isFinite(Date.parse(until)) || Date.parse(until) <= Date.now()))) throw new Error()
  if (!process.env.DATABASE_URL) throw new Error()
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 })
  const db = await pool.connect()
  try {
    await db.query('BEGIN')
    const users = await db.query('SELECT id FROM "user" WHERE lower(email)=$1 AND "emailVerified"=true', [email.trim().toLowerCase()])
    if (users.rows.length !== 1) throw new Error()
    const id = users.rows[0].id
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`heyday-account:${id}`])
    if (revoke) await db.query('UPDATE cloud_sync_entitlements SET revoked_at=now(),updated_at=now() WHERE user_id=$1', [id])
    else await db.query('INSERT INTO cloud_sync_entitlements(user_id,access_until) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET access_until=EXCLUDED.access_until,revoked_at=NULL,updated_at=now()', [id, until])
    await db.query('COMMIT')
    console.log(revoke ? 'Beta sync access revoked. Cloud data retained.' : 'Beta sync access granted until the specified time.')
  } catch (error) { await db.query('ROLLBACK'); throw error }
  finally { db.release() }
} catch {
  console.error('Could not update beta access. Use --email for an existing verified account and either --until YYYY-MM-DDTHH:mm:ssZ (future UTC) or --revoke. Check database configuration and migrations.')
  process.exitCode = 1
} finally { await pool?.end() }
