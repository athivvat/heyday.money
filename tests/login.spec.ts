import { expect, test } from '@playwright/test'

test.use({ channel: 'chrome' })

test('email-only login preserves invalid-code drafts and lets users change email', async ({ page }) => {
  let sendAttempts = 0
  await page.route('**/api/auth/**', route => {
    if (route.request().url().includes('/send-verification-otp')) {
      if (++sendAttempts === 1) return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: 'Email unavailable' } })
      return route.fulfill({ json: { success: true } })
    }
    if (route.request().url().includes('/sign-in/email-otp')) return route.fulfill({ status: 400, json: { code: 'INVALID_OTP', message: 'Invalid code' } })
    return route.fulfill({ json: null })
  })
  await page.goto(`${process.env.HEYDAY_WEB_TEST_URL ?? 'http://127.0.0.1:3000'}/login`)
  await expect(page.getByRole('heading', { name: 'Sign in to Heyday' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Google|Apple|password/i })).toHaveCount(0)
  await page.getByLabel('Email address').fill('beta@example.test')
  await page.getByRole('button', { name: 'Send code', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('could not send your code')
  await expect(page.getByLabel('Email code')).toHaveCount(0)
  await expect(page.getByLabel('Email address')).toHaveValue('beta@example.test')
  await page.getByRole('button', { name: 'Send code', exact: true }).click()
  await expect(page.getByLabel('Email code')).toBeFocused()
  await page.getByLabel('Email code').fill('123456')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('could not be verified')
  await expect(page.getByLabel('Email code')).toHaveValue('123456')
  await expect(page.getByRole('button', { name: /Resend in/ })).toBeDisabled()
  await page.getByRole('button', { name: 'Change email' }).click()
  await expect(page.getByLabel('Email address')).toBeEnabled()
  await expect(page.getByLabel('Email code')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/email-beta-login.png' })
})
