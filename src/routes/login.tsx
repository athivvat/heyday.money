import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { createAuthClient } from 'better-auth/react'
import { emailOTPClient } from 'better-auth/client/plugins'
import { oauthProviderClient } from '@better-auth/oauth-provider/client'

const auth = createAuthClient({ plugins: [emailOTPClient(), oauthProviderClient()] })

export const Route = createFileRoute('/login')({
  head: () => ({ meta: [{ title: 'Sign in — Heyday Money' }, { name: 'robots', content: 'noindex, nofollow' }, { name: 'referrer', content: 'no-referrer' }] }),
  component: Login,
})

function Login() {
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  useEffect(() => {
    if (!cooldown) return
    const timer = window.setTimeout(() => setCooldown(value => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])
  async function send() {
    setError(''); setBusy(true)
    try {
      const result = await auth.emailOtp.sendVerificationOtp({ email: email.trim(), type: 'sign-in' })
      if (result.error) throw new Error()
      setSent(true); setOtp(''); setCooldown(60)
    } catch { setError('We could not send your code. Please try again shortly. If this continues, contact support.') }
    finally { setBusy(false) }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!sent) return send()
    setError(''); setBusy(true)
    try {
      const result = await auth.signIn.emailOtp({ email: email.trim(), otp })
      if (result.error) throw new Error()
      if (new URLSearchParams(window.location.search).get('returnTo') === 'account' && !new URLSearchParams(window.location.search).has('client_id')) {
        window.location.assign('/account')
        return
      }
      setDone(true)
    } catch { setError('That code could not be verified. Try again or request a new code.') }
    finally { setBusy(false) }
  }
  return <main className="min-h-dvh bg-[#f7f4fc] px-5 py-16 text-[#25202d] dark:bg-[#18141f] dark:text-white">
    <section className="mx-auto max-w-md rounded-3xl border border-purple-200 bg-white p-8 shadow-sm dark:border-purple-900 dark:bg-[#241d2e]">
      <Link to="/" className="font-semibold text-purple-600 dark:text-purple-300">Heyday Money</Link>
      <h1 className="mt-8 text-3xl font-semibold">{done ? 'You’re signed in' : 'Sign in to Heyday'}</h1>
      {done ? <div className="mt-4"><p>Return to the Heyday app to continue. You can close this tab.</p><a href="/account" className="mt-4 inline-block underline">Manage your subscription</a></div> : <>
        <p className="mt-3 text-sm leading-6">Beta sign-in uses a code sent to your email. No password needed.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm font-medium" htmlFor="email">Email address</label>
          <input id="email" type="email" autoComplete="email" maxLength={254} required disabled={!ready || busy || sent} value={email} onChange={e => setEmail(e.target.value)} className="w-full rounded-xl border border-purple-200 bg-transparent px-4 py-3 disabled:opacity-70" />
          {sent && <>
            <p role="status" className="text-sm">Check your inbox for a six-digit code. It expires in five minutes.</p>
            <label className="block text-sm font-medium" htmlFor="otp">Email code</label>
            <input id="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus disabled={busy} value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} className="w-full rounded-xl border border-purple-200 bg-transparent px-4 py-3 text-xl tracking-widest" />
          </>}
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}
          <button disabled={!ready || busy} className="w-full rounded-xl bg-purple-600 px-4 py-3 font-medium text-white disabled:opacity-60">{busy ? 'Please wait…' : sent ? 'Sign in' : 'Send code'}</button>
          {sent && <div className="flex justify-between gap-4 text-sm">
            <button type="button" disabled={busy || cooldown > 0} onClick={send} className="underline disabled:opacity-50">{cooldown ? `Resend in ${cooldown}s` : 'Resend code'}</button>
            <button type="button" disabled={busy} onClick={() => { setSent(false); setOtp(''); setError('') }} className="underline">Change email</button>
          </div>}
        </form>
        <noscript><p>Enable JavaScript to sign in with your email code.</p></noscript>
      </>}
      <p className="mt-8 text-xs leading-5 opacity-70">Signing in does not upload your financial data. Your recovery key is separate from your email code.</p>
    </section>
  </main>
}
