import { test, expect } from '@playwright/test'
import type { BillingSummary } from '../src/contracts/v1/billing'

test.use({ channel: 'chrome' })
const base = process.env.HEYDAY_WEB_TEST_URL ?? 'http://127.0.0.1:3000'
const summary: BillingSummary = {
  account: { email: 'billing@example.test' }, enabled: true, trialDays: 0, canCheckout: true, canManage: false,
  plans: [{ id: 'monthly', amount: 9900, currency: 'thb', interval: 'month' }, { id: 'yearly', amount: 99000, currency: 'thb', interval: 'year' }],
  subscriptions: [], entitlement: { canSync: false, reason: 'premium_required', accessUntil: null },
}

test('signed-out website accounts sign in with email and return only to the account page', async ({ page }) => {
  await page.route('**/api/billing/', route => route.fulfill({ status: 401, json: { code: 'AUTH_REQUIRED' } }))
  await page.goto(`${base}/account`)
  await page.getByRole('link', { name: 'Sign in with email' }).click()
  await expect(page).toHaveURL(`${base}/login?returnTo=account`)
  await page.route('**/api/auth/**', route => route.fulfill({ json: route.request().url().includes('get-session') ? null : { success: true } }))
  await page.getByLabel('Email address').fill('billing@example.test')
  await page.getByRole('button', { name: 'Send code', exact: true }).click()
  await page.getByLabel('Email code').fill('123456')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(`${base}/account`)
})

test('checkout return does not grant access; prices, safe errors and mobile account layout remain clear', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  let sent: unknown
  await page.route('**/api/billing/', route => route.fulfill({ json: summary }))
  await page.route('**/api/billing/checkout', route => {
    sent = route.request().postDataJSON()
    return route.fulfill({ status: 409, json: { message: 'You already have a subscription. Use Manage billing to make changes.' } })
  })
  await page.goto(`${base}/account?checkout=success`)
  await expect(page.getByRole('status')).toHaveText('We’re confirming your checkout. Refresh status in a moment.')
  await expect(page.getByRole('heading', { name: 'Cloud sync is paused' })).toBeVisible()
  await expect(page.getByText(/^THB\s99\.00$/)).toBeVisible()
  await expect(page.getByText(/^THB\s990\.00$/)).toBeVisible()
  await page.getByRole('button', { name: 'Choose monthly' }).click()
  expect(sent).toEqual({ plan: 'monthly' })
  await expect(page.getByRole('alert')).toContainText('already have a subscription')
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
    for (const width of [1100, 375]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: `test-results/billing-${theme}-${width}.png`, fullPage: width > 400 })
      if (width < 400) {
        await page.getByRole('heading', { name: 'Monthly', exact: true }).scrollIntoViewIfNeeded()
        await page.screenshot({ path: `test-results/billing-${theme}-${width}-plans.png` })
        await page.evaluate(() => scrollTo(0, 0))
      }
    }
  }
  expect(errors).toEqual([])
})

test('account link remains accessible on the narrow landing page', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto(base)
  await expect(page.getByRole('link', { name: 'Account', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('checkout confirmation reflects the verified trial, paid access, and expiry; management opens Stripe', async ({ page }) => {
  let phase: 'trial' | 'paid' | 'expired' = 'trial'
  let portalBody: unknown
  await page.route('**/api/billing/', route => route.fulfill({ json: { ...summary, canManage: true, canCheckout: phase === 'expired',
    subscriptions: [{ status: phase === 'trial' ? 'trialing' : phase === 'paid' ? 'active' : 'canceled', periodEnd: '2027-01-03T00:00:00Z', cancelAt: phase === 'paid' ? '2027-01-03T00:00:00Z' : null }],
    entitlement: { canSync: phase !== 'expired', reason: phase === 'trial' ? 'trial' : phase === 'paid' ? 'subscription' : 'premium_required', accessUntil: phase !== 'expired' ? '2027-01-03T00:00:00Z' : null } } }))
  await page.route('**/api/billing/portal', route => { portalBody = route.request().postDataJSON(); return route.fulfill({ json: { url: 'https://billing.stripe.com/test-session' } }) })
  await page.route('https://billing.stripe.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Secure billing test destination</h1>' }))
  await page.goto(`${base}/account?checkout=success`)
  await expect(page.getByRole('status')).toHaveText('Your free trial is active. It ends on 3 January 2027.')
  await expect(page.getByText('Free trial', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/billing-trial-confirmed.png', fullPage: true })
  phase = 'paid'
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Your subscription is active.')
  await expect(page.getByRole('heading', { name: 'Cloud sync is available' })).toBeVisible()
  await expect(page.getByText('Your subscription ends on', { exact: false })).toContainText('3 January 2027')
  await expect(page.getByRole('button', { name: 'Choose monthly' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Manage billing' }).click()
  await expect(page).toHaveURL('https://billing.stripe.com/test-session')
  expect(portalBody).toEqual({})
  await page.goto(`${base}/account?checkout=success`)
  phase = 'expired'
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Your subscription is not active. You can choose a plan below.')
  await expect(page.getByRole('heading', { name: 'Cloud sync is paused' })).toBeVisible()
  await expect(page.getByText('Your local app remains available and your encrypted cloud data is retained.')).toBeVisible()
})
