import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Database } from 'bun:sqlite'
import { betterAuth } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { authOptions } from '../../src/server/auth/options'
import { seedDesktopClient, seedMobileClient, DESKTOP_CLIENT_ID, MOBILE_CLIENT_ID } from '../../src/server/auth/desktop-client'

for (const clientId of [DESKTOP_CLIENT_ID, MOBILE_CLIENT_ID]) test(`${clientId} completes native PKCE, refresh and revocation with no social login`, async () => {
  const db = new Database(':memory:')
  const origin = 'http://localhost:3000'
  let otp = ''
  const options = authOptions({ url: origin, secret: 'test-only-secret-long-enough-0123456789', databaseUrl: '', resendApiKey: '', emailFrom: '' }, db, async data => { otp = data.otp })
  try {
    await (await getMigrations(options)).runMigrations()
    const auth = betterAuth(options)
    await seedDesktopClient((await auth.$context).adapter)
    await seedMobileClient((await auth.$context).adapter)
    await seedMobileClient((await auth.$context).adapter)
    const post = (path: string, body: unknown, cookie = '') => auth.handler(new Request(`${origin}/api/auth${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin, cookie }, body: JSON.stringify(body) }))
    assert.equal((await post('/sign-in/social', { provider: 'google' })).status, 404)
    assert.equal((await post('/sign-in/social', { provider: 'apple' })).status, 404)
    const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
    const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url')
    const redirect = clientId === DESKTOP_CLIENT_ID ? 'http://127.0.0.1:54321/callback' : 'money.heyday.mobile:/oauth/callback'
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: 'openid email offline_access', code_challenge: challenge, code_challenge_method: 'S256', state: 'test-random-state', prompt: 'login' })
    const missingPkce = new URLSearchParams(params)
    missingPkce.delete('code_challenge'); missingPkce.delete('code_challenge_method')
    const rejected = await auth.handler(new Request(`${origin}/api/auth/oauth2/authorize?${missingPkce}`))
    assert.equal(new URL(rejected.headers.get('location')!, origin).searchParams.get('error'), 'invalid_request')
    const wrongRedirect = new URLSearchParams(params)
    wrongRedirect.set('redirect_uri', 'money.heyday.mobile:/wrong')
    const invalidRedirect = await auth.handler(new Request(`${origin}/api/auth/oauth2/authorize?${wrongRedirect}`))
    assert.ok(invalidRedirect.status >= 400 || !invalidRedirect.headers.get('location')?.startsWith('money.heyday.mobile:'))
    const authorize = await auth.handler(new Request(`${origin}/api/auth/oauth2/authorize?${params}`))
    assert.equal(authorize.status, 302)
    const login = new URL(authorize.headers.get('location')!, origin)
    assert.equal(login.pathname, '/login')
    const email = 'beta@example.test'
    assert.equal((await post('/email-otp/send-verification-otp', { email, type: 'sign-in', oauth_query: login.search.slice(1) })).status, 200)
    const signedIn = await post('/sign-in/email-otp', { email, otp, oauth_query: login.search.slice(1) })
    assert.equal(signedIn.status, 200)
    const result = await signedIn.json()
    assert.equal(result.redirect, true)
    const callback = new URL(result.url)
    assert.equal(callback.href.split('?')[0], redirect)
    assert.equal(callback.searchParams.get('state'), 'test-random-state')
    assert.equal(callback.searchParams.get('iss'), `${origin}/api/auth`)
    const tokenRequest = (values: Record<string, string>) => auth.handler(new Request(`${origin}/api/auth/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, ...values }) }))
    const exchange = { grant_type: 'authorization_code', code: callback.searchParams.get('code')!, code_verifier: verifier, redirect_uri: redirect }
    const tokens = await tokenRequest(exchange)
    assert.equal(tokens.status, 200)
    const token = await tokens.json()
    assert.ok(token.refresh_token)
    const cookie = signedIn.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const browserSession = () => auth.api.getSession({ headers: new Headers({ cookie }) })
    const web = await browserSession()
    assert.ok(web)
    const desktop = await auth.api.verifyDesktopAccess({ body: { token: token.access_token } })
    assert.equal(desktop.userId, web.user.id)
    assert.notEqual(desktop.sessionId, web.session.id, 'Desktop must not inherit the browser session')
    const idClaims = JSON.parse(Buffer.from(token.id_token.split('.')[1], 'base64url').toString())
    assert.equal(idClaims.sub, desktop.userId)
    if (idClaims.sid !== undefined) assert.equal(idClaims.sid, desktop.sessionId)
    const info = await auth.handler(new Request(`${origin}/api/auth/oauth2/userinfo`, { headers: { authorization: `Bearer ${token.access_token}` } }))
    assert.equal(info.status, 200)
    assert.equal((await info.json()).email, email)
    // Reusing the same browser login must also produce an independent native session.
    const secondParams = new URLSearchParams(params)
    secondParams.delete('prompt')
    const authorizeAgain = async () => {
      const response = await auth.handler(new Request(`${origin}/api/auth/oauth2/authorize?${secondParams}`, { headers: { cookie } }))
      const code = new URL(response.headers.get('location')!, origin).searchParams.get('code')
      assert.ok(code)
      return code
    }
    const secondResponse = await tokenRequest({ ...exchange, code: await authorizeAgain() })
    assert.equal(secondResponse.status, 200)
    const second = await secondResponse.json()
    const otherDesktop = await auth.api.verifyDesktopAccess({ body: { token: second.access_token } })
    assert.notEqual(otherDesktop.sessionId, desktop.sessionId)
    assert.notEqual(otherDesktop.sessionId, web.session.id)
    // Desktop sign-out revokes both native credentials, without signing out the website/other app.
    for (const [hint, value] of [['refresh_token', second.refresh_token], ['access_token', second.access_token]]) {
      const revoke = await auth.handler(new Request(`${origin}/api/auth/oauth2/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, token: value, token_type_hint: hint }) }))
      // The provider cascades refresh revocation to access tokens; the second
      // call can report that the access token is already invalid.
      if (hint === 'access_token' && revoke.status === 400) assert.equal((await revoke.json()).error, 'invalid_request')
      else assert.equal(revoke.status, 200)
    }
    await assert.rejects(auth.api.verifyDesktopAccess({ body: { token: second.access_token } }))
    assert.equal((await browserSession())?.session.id, web.session.id)
    assert.deepEqual(await auth.api.verifyDesktopAccess({ body: { token: token.access_token } }), desktop)
    // A stolen code cannot be exchanged with another PKCE verifier.
    assert.equal((await tokenRequest({ ...exchange, code: await authorizeAgain(), code_verifier: 'x'.repeat(43) })).status, 400)
    const pendingCode = await authorizeAgain()
    assert.equal((await post('/sign-out', {}, cookie)).status, 200)
    assert.equal(await browserSession(), null, 'The old browser cookie must actually be invalidated')
    assert.deepEqual(await auth.api.verifyDesktopAccess({ body: { token: token.access_token } }), desktop)
    assert.equal((await auth.handler(new Request(`${origin}/api/auth/oauth2/userinfo`, { headers: { authorization: `Bearer ${token.access_token}` } }))).status, 200)
    // Closing/signing out of the callback browser before the app exchanges its code is safe.
    assert.equal((await tokenRequest({ ...exchange, code: pendingCode })).status, 200)
    const refreshed = await tokenRequest({ grant_type: 'refresh_token', refresh_token: token.refresh_token })
    assert.equal(refreshed.status, 200)
    const next = await refreshed.json()
    assert.deepEqual(await auth.api.verifyDesktopAccess({ body: { token: next.access_token } }), desktop)
    // Session expiry still blocks the app; refresh must never resurrect an expired session.
    await (await auth.$context).adapter.update({ model: 'session', where: [{ field: 'id', value: desktop.sessionId }], update: { expiresAt: new Date(Date.now() - 1000) } })
    await assert.rejects(auth.api.verifyDesktopAccess({ body: { token: next.access_token } }))
    const expiredRefresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: next.refresh_token })
    if (expiredRefresh.status === 200) await assert.rejects(auth.api.verifyDesktopAccess({ body: { token: (await expiredRefresh.json()).access_token } }))
    else assert.equal(expiredRefresh.status, 400)
    // Replay detection may revoke the user's entire client token family, so run last.
    assert.equal((await tokenRequest(exchange)).status, 400)
    assert.equal((await tokenRequest({ grant_type: 'refresh_token', refresh_token: second.refresh_token })).status, 400)
  } finally { db.close() }
})
