import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { createAuthClient } from 'better-auth/react'
import { ArrowLeft, Check, ExternalLink, LockKeyhole, RefreshCw } from 'lucide-react'
import type { BillingPlan, BillingSummary } from '../contracts/v1/billing'

const auth = createAuthClient()
export const Route = createFileRoute('/account')({
  head: () => ({ meta: [{ title: 'Your subscription — Heyday Money' }, { name: 'robots', content: 'noindex, nofollow' }, { name: 'referrer', content: 'no-referrer' }] }),
  component: Account,
})
const primary = 'inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white disabled:opacity-50'
const secondary = 'inline-flex items-center justify-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-medium disabled:opacity-50'
const date = (value: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'long' }).format(new Date(value))
const labels: Record<string, string> = { active: 'Active', trialing: 'Free trial', past_due: 'Payment overdue', unpaid: 'Payment required',
  incomplete: 'Payment incomplete', incomplete_expired: 'Checkout expired', canceled: 'Ended', paused: 'Paused' }

function Account() {
  const [data, setData] = useState<BillingSummary | null>(null)
  const [signedOut, setSignedOut] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [returned, setReturned] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await fetch('/api/billing/', { cache: 'no-store' })
      if (response.status === 401) { setSignedOut(true); setData(null); return }
      if (!response.ok) throw new Error('We could not refresh your subscription. Please try again.')
      setData(await response.json()); setSignedOut(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load your subscription.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => {
    setReturned(new URLSearchParams(window.location.search).get('checkout') ?? '')
    void load()
  }, [load])
  async function action(type: 'checkout' | 'portal', plan?: BillingPlan) {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/billing/${type}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(plan ? { plan } : {}) })
      if (response.status === 401) { setSignedOut(true); setData(null); return }
      const body = await response.json()
      if (!response.ok) throw new Error(body.message || 'Billing is unavailable. Please try again.')
      const url = new URL(body.url)
      if (url.protocol !== 'https:' || !['checkout.stripe.com', 'billing.stripe.com'].includes(url.hostname)) throw new Error('Could not open secure billing.')
      window.location.assign(url.href)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open billing.') }
    finally { setBusy(false) }
  }
  async function signOut() {
    setBusy(true); setError('')
    try {
      const result = await auth.signOut()
      if (result.error) throw new Error()
      setData(null); setSignedOut(true)
    } catch { setError('Could not sign out. Please try again.') }
    finally { setBusy(false) }
  }
  const subscription = data?.subscriptions.find(s => !['canceled', 'incomplete_expired'].includes(s.status)) ?? data?.subscriptions[0]
  const checkoutConfirmed = subscription?.status === 'trialing' || subscription?.status === 'active'
  const checkoutNotice = subscription?.status === 'trialing'
    ? `Your free trial is active.${subscription.periodEnd ? ` It ends on ${date(subscription.periodEnd)}.` : ''}`
    : subscription?.status === 'active' ? 'Your subscription is active.'
    : ['past_due', 'unpaid', 'incomplete'].includes(subscription?.status ?? '') ? 'Your payment needs attention. Open Manage billing to check your payment details.'
    : subscription?.status === 'paused' ? 'Your subscription is paused. Open Manage billing to review it.'
    : ['canceled', 'incomplete_expired'].includes(subscription?.status ?? '') ? 'Your subscription is not active. You can choose a plan below.'
    : 'We’re confirming your checkout. Refresh status in a moment.'
  return <main className="min-h-dvh bg-page px-5 py-8 text-ink sm:py-12">
    <div className="mx-auto max-w-3xl">
      <nav className="flex flex-wrap items-center justify-between gap-4" aria-label="Account navigation">
        <Link to="/" className="inline-flex items-center gap-2 font-semibold"><ArrowLeft className="size-4" aria-hidden="true" />Heyday Money</Link>
        {data && <button className="text-sm text-muted underline underline-offset-4" disabled={busy} onClick={signOut}>Sign out</button>}
      </nav>
      <header className="mb-8 mt-12"><p className="text-sm font-medium text-brand">YOUR ACCOUNT</p><h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Your subscription</h1>
        <p className="mt-3 break-all text-muted">{data ? data.account.email : 'Manage your Heyday cloud sync plan and billing.'}</p></header>
      {error && <p role="alert" className="mb-5 rounded-xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-200">{error}</p>}
      {signedOut ? <section className="rounded-3xl border border-line bg-card p-7"><h2 className="text-xl font-semibold">Sign in to continue</h2>
        <p className="mt-3 leading-7 text-muted">Use the same email address as the desktop app to manage its subscription.</p>
        <a className={`${primary} mt-6`} href="/login?returnTo=account">Sign in with email</a></section>
        : !data ? <section role="status" className="rounded-3xl border border-line bg-card p-7">{loading ? 'Loading your subscription…' : <button className={secondary} onClick={load}>Try again</button>}</section>
        : <>
          {returned === 'success' && <p role="status" className={`mb-5 rounded-xl border p-4 text-sm ${checkoutConfirmed ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200' : 'border-line'}`}>{checkoutNotice}</p>}
          {returned === 'canceled' && <p role="status" className="mb-5 rounded-xl border border-line p-4 text-sm">You left checkout. Your subscription has not been changed by this return.</p>}
          <section aria-labelledby="sync-access-heading" className="rounded-3xl border border-line bg-card p-6 sm:p-8">
            <div className="flex items-start gap-4"><span className={`grid size-11 shrink-0 place-items-center rounded-full ${data.entitlement.canSync ? 'bg-emerald-500 text-white' : 'bg-brand/10 text-brand'}`}>
              {data.entitlement.canSync ? <Check className="size-6" aria-hidden="true" /> : <LockKeyhole className="size-5" aria-hidden="true" />}</span>
              <div><h2 id="sync-access-heading" className="text-xl font-semibold">{data.entitlement.canSync ? 'Cloud sync is available' : data.entitlement.reason === 'not_configured' ? 'Cloud sync is temporarily unavailable' : 'Cloud sync is paused'}</h2>
                <p className="mt-2 text-sm leading-6 text-muted">{data.entitlement.canSync ? 'Enable sync in the desktop app to keep your devices up to date.' : 'Your local app remains available and your encrypted cloud data is retained.'}</p></div></div>
            <dl className="mt-6 grid gap-4 border-t border-line pt-5 sm:grid-cols-2"><div><dt className="text-sm text-muted">Plan status</dt><dd className="mt-1 font-medium">{subscription ? labels[subscription.status] ?? 'Updating' : data.entitlement.reason === 'beta_access' ? 'Beta access' : 'No subscription'}</dd></div>
              {data.entitlement.accessUntil && <div><dt className="text-sm text-muted">Access through</dt><dd className="mt-1 font-medium">{date(data.entitlement.accessUntil)}</dd></div>}</dl>
            {subscription?.cancelAt && ['active', 'trialing'].includes(subscription.status) && <p className="mt-4 text-sm leading-6">Your subscription ends on {date(subscription.cancelAt)}. Sync stays available until your current access ends.</p>}
            <div className="mt-6 flex flex-wrap gap-3">{data.canManage && <button className={primary} disabled={busy || loading} onClick={() => action('portal')}>Manage billing<ExternalLink className="size-4" aria-hidden="true" /></button>}
              <button className={secondary} disabled={busy || loading} onClick={load}><RefreshCw className={`size-4 ${loading ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />{loading ? 'Refreshing…' : 'Refresh status'}</button></div>
            {data.canManage && <p className="mt-3 text-xs leading-5 text-muted">Update payment details, view invoices, or cancel your subscription in Stripe’s secure billing portal.</p>}
          </section>
          {data.canCheckout && <section aria-labelledby="plans-heading" className="mt-8"><h2 id="plans-heading" className="text-xl font-semibold">Keep your finances in sync</h2>
            <p className="mt-2 text-sm leading-6 text-muted">End-to-end encrypted sync across your devices, with no plan limits on devices or total storage.</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">{data.plans.map(plan => <article key={plan.id} className="rounded-3xl border border-line bg-card p-6">
              <h3 className="font-semibold">{plan.id === 'monthly' ? 'Monthly' : 'Yearly'}</h3><p className="mt-4"><span className="text-3xl font-semibold">{new Intl.NumberFormat('en-TH', { style: 'currency', currency: 'THB' }).format(plan.amount / 100)}</span><span className="text-sm text-muted"> / {plan.interval}</span></p>
              <p className="mt-2 text-xs leading-5 text-muted">{data.trialDays ? `${data.trialDays}-day free trial, then billed ${plan.id}. Payment method required.` : `Billed ${plan.id}.`} Final total is shown at checkout.</p>
              <button className={`${primary} mt-6 w-full`} disabled={busy || loading} onClick={() => action('checkout', plan.id)}>{data.trialDays ? 'Start free trial' : `Choose ${plan.id}`}</button>
            </article>)}</div></section>}
          {!data.enabled && <p className="mt-6 text-sm text-muted">Subscriptions are not available for purchase yet.</p>}
          <section className="mt-8 rounded-2xl bg-brand/5 p-5 text-sm leading-7 text-muted"><h2 className="font-semibold text-ink">Your data stays yours</h2><ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Cancel anytime. Sync continues until your paid period ends.</li><li>When access ends, sync pauses and your encrypted cloud data is retained.</li><li>Your recovery key stays with you. Support cannot recover it.</li></ul></section>
        </>}
    </div>
  </main>
}
