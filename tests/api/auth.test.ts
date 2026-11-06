import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Database } from 'bun:sqlite'
import { betterAuth } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { authConfig } from '../../src/server/auth/config'
import { authOptions } from '../../src/server/auth/options'
import { sendAuthCode } from '../../src/server/auth/email'
import { withEmailDeliveryCheck } from '../../src/server/auth/delivery'

const env = {
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'test-only-high-entropy-secret-0123456789abcdef',
  DATABASE_URL: 'postgresql://user:password@localhost/test',
  RESEND_API_KEY: 'test-only', AUTH_EMAIL_FROM: 'Heyday <signin@example.test>',
}

test('configuration fails closed without secrets or with insecure production origins', () => {
  assert.deepEqual(authOptions(authConfig({ ...env, GOOGLE_CLIENT_ID: 'legacy' }), undefined, async () => {}).socialProviders, {})
  assert.throws(() => authConfig({ ...env, RESEND_API_KEY: '' }))
  assert.throws(() => authConfig({ ...env, BETTER_AUTH_SECRET: 'short' }))
  assert.throws(() => authConfig({ ...env, NODE_ENV: 'production' }))
  assert.equal(authConfig({ ...env, NODE_ENV: 'production', AUTH_ALLOW_INSECURE_LOCALHOST: 'true' }).url, env.BETTER_AUTH_URL)
  assert.throws(() => authConfig({ ...env, NODE_ENV: 'production', AUTH_ALLOW_INSECURE_LOCALHOST: 'true', BETTER_AUTH_URL: 'http://public.example' }))
  assert.throws(() => authConfig({ ...env, BETTER_AUTH_URL: 'http://public.example' }))
  assert.throws(() => authConfig({ ...env, BETTER_AUTH_URL: 'https://example.com/evil' }))
})

test('Resend delivery errors propagate without including provider error details', async () => {
  let sent: unknown
  const send = sendAuthCode({ emails: { send: async input => { sent = input; return { error: null } } } }, env.AUTH_EMAIL_FROM)
  await send({ email: 'person@example.test', otp: '123456', type: 'sign-in' })
  assert.match(JSON.stringify(sent), /123456/)
  const failed = sendAuthCode({ emails: { send: async () => ({ error: { secret: 'sensitive' } }) } }, env.AUTH_EMAIL_FROM)
  await assert.rejects(failed({ email: 'person@example.test', otp: '123456', type: 'sign-in' }), { message: 'Unable to deliver verification email.' })
})

test('real auth handler signs in by code, hashes stored OTP, rejects replay and signs out', async () => {
  const db = new Database(':memory:')
  let delivered = ''
  const options = authOptions(authConfig(env), db, async ({ otp }) => { delivered = otp })
  try {
    await (await getMigrations(options)).runMigrations()
    const auth = betterAuth(options)
    const post = (path: string, body: unknown, cookie?: string, origin = env.BETTER_AUTH_URL) => auth.handler(new Request(`${env.BETTER_AUTH_URL}/api/auth${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-forwarded-for': '127.0.0.1', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
    }))
    const email = 'person@example.test'
    assert.equal((await post('/email-otp/send-verification-otp', { email, type: 'sign-in' })).status, 200)
    assert.match(delivered, /^\d{6}$/)
    const stored = db.query('SELECT value FROM verification').all()
    assert.equal(JSON.stringify(stored).includes(delivered), false)
    assert.equal((await post('/sign-in/email-otp', { email, otp: 'wrong' })).status, 400)
    const signedIn = await post('/sign-in/email-otp', { email, otp: delivered })
    assert.equal(signedIn.status, 200)
    const cookie = signedIn.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    assert.ok(cookie.includes('session_token'))
    const session = () => auth.handler(new Request(`${env.BETTER_AUTH_URL}/api/auth/get-session`, { headers: { cookie } }))
    assert.equal((await (await session()).json()).user.email, email)
    assert.equal((await post('/sign-in/email-otp', { email, otp: delivered })).status, 400)
    assert.equal((await post('/sign-out', {}, cookie, 'https://evil.example')).status, 403)
    assert.equal((await post('/sign-out', {}, cookie)).status, 200)
    assert.equal(await (await session()).json(), null)
  } finally { db.close() }
})

test('provider rejection cannot report success and does not contaminate concurrent requests', async () => {
  const db = new Database(':memory:')
  const safeLogs: string[] = []
  const originalError = console.error
  console.error = (message: unknown) => { safeLogs.push(String(message)) }
  const sender = sendAuthCode({ emails: { send: async input => {
    if (input.to === 'fail@example.test') return { error: { name: 'validation_error', statusCode: 403, message: 'secret-provider-response' } }
    return { error: null }
  } } }, env.AUTH_EMAIL_FROM)
  const options = authOptions(authConfig(env), db, sender)
  try {
    await (await getMigrations(options)).runMigrations()
    const auth = betterAuth(options)
    const send = (email: string) => withEmailDeliveryCheck(() => auth.handler(new Request(`${env.BETTER_AUTH_URL}/api/auth/email-otp/send-verification-otp`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: env.BETTER_AUTH_URL }, body: JSON.stringify({ email, type: 'sign-in' }),
    })))
    const [failed, accepted] = await Promise.allSettled([send('fail@example.test'), send('ok@example.test')])
    assert.equal(failed.status, 'rejected')
    assert.equal(accepted.status, 'fulfilled')
    if (accepted.status === 'fulfilled') assert.equal(accepted.value.status, 200)
    assert.equal(safeLogs.length, 1)
    const log = JSON.parse(safeLogs[0])
    assert.equal(log.category, 'validation_error')
    assert.equal(log.status, 403)
    assert.equal(safeLogs[0].includes('secret-provider-response'), false)
    assert.equal(safeLogs[0].includes('@example.test'), false)
  } finally { console.error = originalError; db.close() }
})
