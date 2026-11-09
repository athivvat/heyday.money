import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { betterAuth } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { authOptions } from '../../src/server/auth/options'
import { seedDesktopClient, seedMobileClient, DESKTOP_CLIENT_ID, MOBILE_CLIENT_ID } from '../../src/server/auth/desktop-client'
import { migrateCloud } from '../../src/server/db/migrate'
import { DeviceService } from '../../src/server/devices/service'
import { deviceHandler } from '../../src/server/devices/handler'
import { syncScenarios } from './sync-scenarios'

test('PostgreSQL account/device ownership, concurrent registration, session binding and revocation', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  // Each run owns only a random schema; never migrate or erase the application's schema.
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  const schema = `device_test_${randomUUID().replaceAll('-', '')}`
  await admin.query(`CREATE SCHEMA "${schema}"`)
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 8, options: `-c search_path=${schema}` })
  const origin = 'http://localhost:3000'
  const codes = new Map<string, string>()
  const options = authOptions({ url: origin, secret: 'test-only-secret-long-enough-0123456789', databaseUrl: '', resendApiKey: '', emailFrom: '' }, pool, async ({ email, otp }) => { codes.set(email, otp) })
  // Several synthetic logins share the test runner's IP; account API throttling
  // stays enabled and is tested below. Production auth limits are unchanged.
  options.rateLimit.enabled = false
  try {
    await (await getMigrations(options)).runMigrations()
    const auth = betterAuth(options)
    await seedDesktopClient((await auth.$context).adapter)
    await seedMobileClient((await auth.$context).adapter)
    await migrateCloud(pool, true)
    await migrateCloud(pool, true)
    assert.equal((await pool.query('SELECT count(*) FROM cloud_migrations')).rows[0].count, '10')
    const service = new DeviceService(pool)
    const handle = deviceHandler(service, input => auth.api.verifyDesktopAccess(input))
    const tokenRequest = (values: Record<string, string>) => auth.handler(new Request(`${origin}/api/auth/oauth2/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: DESKTOP_CLIENT_ID, ...values }),
    }))
    async function login(email: string, clientId = DESKTOP_CLIENT_ID) {
      const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
      const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url')
      const redirect = clientId === MOBILE_CLIENT_ID ? 'money.heyday.mobile:/oauth/callback' : 'http://127.0.0.1:54321/callback'
      const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: 'openid email offline_access', code_challenge: challenge, code_challenge_method: 'S256', state: randomUUID(), prompt: 'login' })
      const authorize = await auth.handler(new Request(`${origin}/api/auth/oauth2/authorize?${query}`))
      const loginUrl = new URL(authorize.headers.get('location')!, origin)
      const post = (path: string, body: unknown) => auth.handler(new Request(`${origin}/api/auth${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) }))
      assert.equal((await post('/email-otp/send-verification-otp', { email, type: 'sign-in', oauth_query: loginUrl.search.slice(1) })).status, 200)
      const signedIn = await post('/sign-in/email-otp', { email, otp: codes.get(email), oauth_query: loginUrl.search.slice(1) })
      assert.equal(signedIn.status, 200)
      const callback = new URL((await signedIn.json()).url)
      const response = await tokenRequest({ client_id: clientId, grant_type: 'authorization_code', code: callback.searchParams.get('code')!, code_verifier: verifier, redirect_uri: redirect })
      assert.equal(response.status, 200)
      const tokens = await response.json() as { access_token: string; refresh_token: string; id_token: string }
      return { ...tokens, cookie: signedIn.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') }
    }
    const alice = await login('alice@example.test')
    const aliceOther = await login('alice@example.test')
    const bob = await login('bob@example.test')
    const call = (token: string | null, action: 'me' | 'register' | 'list' | 'revoke' | 'keys' | 'enroll-key', body?: unknown, id?: string, query = '') => handle(new Request(`${origin}/api/v1/${action === 'me' ? 'me' : 'devices'}${query}`, {
      method: action === 'register' ? 'POST' : action === 'enroll-key' ? 'PUT' : action === 'revoke' ? 'DELETE' : 'GET',
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), action, id)
    const phone = await login('phone@example.test', MOBILE_CLIENT_ID)
    for (const platform of ['ios', 'android']) {
      const session = platform === 'ios' ? phone : await login('phone@example.test', MOBILE_CLIENT_ID)
      const response = await call(session.access_token, 'register', { installationId: randomUUID(), name: platform + ' phone', platform })
      assert.equal(response.status, 200)
      assert.equal((await response.json()).platform, platform)
    }
    assert.equal((await call(null, 'me')).status, 401)
    assert.equal((await call('not-a-token', 'me')).status, 401)
    assert.equal((await call(alice.id_token, 'me')).status, 401)
    assert.equal((await call(alice.refresh_token, 'me')).status, 401)
    const bobIdentity = await auth.api.verifyDesktopAccess({ body: { token: bob.access_token } })
    await pool.query('UPDATE "oauthAccessToken" SET "expiresAt" = now() - interval \'1 second\' WHERE "sessionId" = $1', [bobIdentity.sessionId])
    assert.equal((await call(bob.access_token, 'me')).status, 401)
    await pool.query('UPDATE "oauthAccessToken" SET "expiresAt" = now() + interval \'1 hour\' WHERE "sessionId" = $1', [bobIdentity.sessionId])
    await pool.query('UPDATE "oauthClient" SET disabled = true WHERE "clientId" = $1', [DESKTOP_CLIENT_ID])
    assert.equal((await call(alice.access_token, 'me')).status, 401)
    await pool.query('UPDATE "oauthClient" SET disabled = false WHERE "clientId" = $1', [DESKTOP_CLIENT_ID])
    assert.equal((await auth.handler(new Request(`${origin}/api/auth/verify-desktop-access`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: alice.access_token }) }))).status, 404)
    const meResponse = await call(alice.access_token, 'me')
    assert.equal(meResponse.status, 200)
    assert.equal(meResponse.headers.get('cache-control'), 'private, no-store')
    const me = await meResponse.json()
    assert.equal(me.account.email, 'alice@example.test')
    assert.equal(me.dataset.keyStatus, 'not_enrolled')
    assert.equal(me.entitlement.canSync, false)
    assert.equal(me.limits.devices, null)
    const bobMe = await (await call(bob.access_token, 'me')).json()
    assert.notEqual(bobMe.dataset.id, me.dataset.id)
    const input = { installationId: randomUUID(), name: 'MacBook', platform: 'macos' }
    assert.equal((await call(alice.access_token, 'keys')).status, 403)
    // A lost response can be retried concurrently without creating a second device.
    const duplicates = await Promise.all(Array.from({ length: 6 }, () => call(alice.access_token, 'register', input)))
    for (const response of duplicates) assert.equal(response.status, 200)
    const registrations = await Promise.all(duplicates.map(response => response.json()))
    const first = registrations[0]
    assert.equal(new Set(registrations.map(d => d.id)).size, 1)
    // Website logout deletes its real session, without detaching the registered
    // device from its independently bound OAuth session or encrypted data.
    const browserSession = (cookie: string) => auth.api.getSession({ headers: new Headers({ cookie }) })
    const website = await browserSession(alice.cookie)
    assert.ok(website)
    const native = await auth.api.verifyDesktopAccess({ body: { token: alice.access_token } })
    assert.notEqual(native.sessionId, website.session.id)
    const logout = await auth.handler(new Request(`${origin}/api/auth/sign-out`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin, cookie: alice.cookie }, body: '{}',
    }))
    assert.equal(logout.status, 200)
    assert.equal(await browserSession(alice.cookie), null)
    assert.equal((await pool.query('SELECT 1 FROM "session" WHERE id = $1', [website.session.id])).rowCount, 0)
    assert.equal((await (await call(alice.access_token, 'me')).json()).device.id, first.id)
    assert.equal((await call(alice.access_token, 'register', { ...input, installationId: randomUUID() })).status, 409)
    assert.equal((await call(alice.access_token, 'register', { ...input, name: 'Changed' })).status, 409)
    assert.equal((await call(alice.access_token, 'register', { ...input, userId: bobMe.account.id })).status, 400)
    assert.equal((await call(alice.access_token, 'register', { ...input, name: 'x'.repeat(3000) })).status, 413)
    const second = await (await call(aliceOther.access_token, 'register', { ...input, installationId: randomUUID(), name: 'Windows PC', platform: 'windows' })).json()
    assert.notEqual(second.id, first.id)
    // Installation IDs are only idempotency keys within an owner, never identity proof.
    const bobsDevice = await (await call(bob.access_token, 'register', input)).json()
    assert.notEqual(bobsDevice.id, first.id)
    const key = { ...JSON.parse(readFileSync(new URL('../fixtures/e2ee-v1.json', import.meta.url), 'utf8')).envelope, datasetId: me.dataset.id }
    assert.equal((await (await call(alice.access_token, 'keys')).json()).key, null)
    assert.equal((await call(alice.access_token, 'enroll-key', { ...key, recoveryKey: 'never-send-this' })).status, 400)
    assert.equal((await call(bob.access_token, 'enroll-key', key)).status, 409)
    const competing = { ...key, keyId: 'competing-key' }
    const enrollment = await Promise.all([call(alice.access_token, 'enroll-key', key), call(aliceOther.access_token, 'enroll-key', competing)])
    assert.deepEqual(enrollment.map(r => r.status).sort(), [200, 409])
    const stored = (await (await call(alice.access_token, 'keys')).json()).key
    assert.equal((await call(alice.access_token, 'enroll-key', stored)).status, 200)
    assert.deepEqual((await (await call(aliceOther.access_token, 'keys')).json()).key, stored)
    assert.equal((await (await call(bob.access_token, 'keys')).json()).key, null)
    assert.equal((await (await call(alice.access_token, 'me')).json()).dataset.keyStatus, 'enrolled')
    assert.equal((await pool.query('SELECT count(*) FROM cloud_keys WHERE user_id = $1', [me.account.id])).rows[0].count, '1')
    const sync = await syncScenarios(pool, input => auth.api.verifyDesktopAccess(input), alice.access_token, aliceOther.access_token, bob.access_token, me.dataset.id, stored.keyId)
    const page = await (await call(alice.access_token, 'list', undefined, undefined, '?limit=1')).json()
    const next = await (await call(alice.access_token, 'list', undefined, undefined, `?limit=1&cursor=${page.nextCursor}`)).json()
    assert.equal(page.devices.length, 1)
    assert.equal(next.devices.length, 1)
    assert.notEqual(page.devices[0].id, next.devices[0].id)
    assert.equal(next.nextCursor, null)
    assert.equal((await call(alice.access_token, 'list', undefined, undefined, '?limit=101')).status, 400)
    assert.equal((await call(alice.access_token, 'list', undefined, undefined, '?limit=1&limit=2')).status, 400)
    assert.equal((await call(bob.access_token, 'revoke', undefined, first.id)).status, 404)
    assert.equal((await call(bob.access_token, 'revoke', undefined, randomUUID())).status, 404)
    // Simulate a failure after device/session updates; revocation must roll back
    // completely, rather than leaving token access and device status inconsistent.
    await pool.query(`CREATE FUNCTION reject_revoke() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test failure'; END $$`)
    await pool.query('CREATE TRIGGER fail_revoke BEFORE UPDATE ON "oauthRefreshToken" FOR EACH ROW EXECUTE FUNCTION reject_revoke()')
    assert.equal((await call(aliceOther.access_token, 'revoke', undefined, first.id)).status, 500)
    assert.equal((await call(alice.access_token, 'me')).status, 200)
    assert.equal((await pool.query('SELECT revoked_at FROM cloud_devices WHERE id = $1', [first.id])).rows[0].revoked_at, null)
    await pool.query('DROP TRIGGER fail_revoke ON "oauthRefreshToken"')
    const refreshed = await tokenRequest({ grant_type: 'refresh_token', refresh_token: alice.refresh_token })
    assert.equal(refreshed.status, 200)
    const rotated = await refreshed.json()
    assert.equal((await (await call(rotated.access_token, 'me')).json()).device.id, first.id)
    // Multiple sessions can belong to one installation; revoke every one.
    const aliceAgain = await login('alice@example.test')
    assert.equal((await (await call(aliceAgain.access_token, 'register', input)).json()).id, first.id)
    const staleIdentity = await auth.api.verifyDesktopAccess({ body: { token: rotated.access_token } })
    assert.equal((await call(aliceOther.access_token, 'revoke', undefined, first.id)).status, 200)
    assert.equal((await call(aliceOther.access_token, 'revoke', undefined, first.id)).status, 200)
    assert.ok(await browserSession(aliceAgain.cookie), 'Revoking the app must leave its browser login intact')
    for (const token of [alice.access_token, rotated.access_token, aliceAgain.access_token]) {
      assert.equal((await call(token, 'me')).status, 401)
      assert.equal((await call(token, 'keys')).status, 401)
      assert.equal((await sync.handle(new Request(`${origin}/api/v1/sync/pull?datasetId=${me.dataset.id}`, { headers: { authorization: `Bearer ${token}` } }), 'pull')).status, 401)
      assert.equal((await call(token, 'register', { ...input, installationId: randomUUID() })).status, 401)
    }
    await assert.rejects(service.register(staleIdentity, { ...input, platform: 'macos' }), { code: 'AUTH_EXPIRED' })
    assert.equal((await tokenRequest({ grant_type: 'refresh_token', refresh_token: rotated.refresh_token })).status, 400)
    assert.equal((await call(aliceOther.access_token, 'me')).status, 200)
    assert.deepEqual((await (await call(aliceOther.access_token, 'keys')).json()).key, stored)
    assert.equal((await call(bob.access_token, 'me')).status, 200)
    const listed = await (await call(aliceOther.access_token, 'list')).json()
    assert.ok(listed.devices.find((d: { id: string }) => d.id === first.id).revokedAt)
    assert.equal(listed.devices.find((d: { current: boolean }) => d.current).id, second.id)
    await pool.query("UPDATE cloud_api_usage SET window_start = date_trunc('minute', now()), requests = 120 WHERE user_id = $1", [bobMe.account.id])
    const limited = await call(bob.access_token, 'me')
    assert.equal(limited.status, 429)
    assert.equal(limited.headers.get('retry-after'), '60')
    assert.equal((await call(aliceOther.access_token, 'revoke', undefined, second.id)).status, 200)
    assert.equal((await call(aliceOther.access_token, 'list')).status, 401)
  } finally {
    await pool.end()
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`)
    await admin.end()
  }
})
