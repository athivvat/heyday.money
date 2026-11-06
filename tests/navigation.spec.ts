import { test, expect } from '@playwright/test'

test.use({ channel: 'chrome', reducedMotion: 'reduce' })
const base = process.env.HEYDAY_WEB_TEST_URL ?? 'http://127.0.0.1:3000'

test('server-rendered pages have working styles before JavaScript loads', async ({ browser, request }) => {
  // Hydration used to hide a Linux/Docker CSS URL mismatch by loading a second,
  // valid stylesheet. Exercise the actual server HTML without that recovery.
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  try {
    for (const path of ['/', '/th', '/account', '/login']) {
      await page.goto(`${base}${path}`)
      const styles = await page.locator('link[rel="stylesheet"]').evaluateAll(links => links
        .map(link => (link as HTMLLinkElement).href)
        .filter(href => new URL(href).origin === location.origin))
      expect(styles.length, `${path} includes a local stylesheet in its server HTML`).toBeGreaterThan(0)
      for (const href of styles) {
        const response = await request.get(href)
        expect(response.status(), `${path} stylesheet: ${href}`).toBe(200)
        expect(response.headers()['content-type']).toContain('text/css')
      }
      await expect(page.locator('body')).toHaveCSS('margin', '0px')
      if (path === '/' || path === '/th') {
        await expect(page.locator('[aria-label="Heyday.Money"] > svg')).toHaveCSS('width', '43px')
        expect((await page.locator('.island-image').boundingBox())!.width).toBeLessThanOrEqual(700)
        await expect(page.locator('#comparison-heading')).toHaveCSS('opacity', '1')
      }
    }
  } finally {
    await context.close()
  }
})

for (const width of [1440, 390]) {
  test(`returning home from Account and login preserves styles without reloading (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/billing/', route => route.fulfill({ status: 401, json: { code: 'AUTH_REQUIRED' } }))
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const failedStyles: string[] = []
    page.on('response', response => {
      if (response.request().resourceType() === 'stylesheet' && new URL(response.url()).origin === new URL(base).origin && !response.ok()) failedStyles.push(response.url())
    })

    for (const path of ['/account', '/login']) {
      await page.goto(`${base}${path}`)
      // Only attach the listener after the initial document has loaded.
      const documents: string[] = []
      const onRequest = (request: import('@playwright/test').Request) => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url())
      }
      page.on('request', onRequest)
      await page.getByRole('link', { name: 'Heyday Money', exact: true }).click()
      await expect(page).toHaveURL(`${base}/`)
      await expect(page.getByRole('switch', { name: 'Night mode' })).toBeEnabled()
      await expect(page.locator('[aria-label="Heyday.Money"] > svg')).toHaveCSS('width', width < 640 ? '30px' : '43px')
      expect((await page.locator('.island-image').boundingBox())!.width).toBeLessThanOrEqual(Math.min(width, 700))
      await page.getByRole('switch').click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
      await page.getByRole('link', { name: 'Account', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Your subscription' })).toBeVisible()
      await page.goBack()
      await expect(page.getByRole('heading', { name: 'Your money, Your Heyday!' })).toBeVisible()
      await expect(page.locator('[aria-label="Heyday.Money"] > svg')).toHaveCSS('width', width < 640 ? '30px' : '43px')
      await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
      expect(documents).toEqual([])
      await page.screenshot({ path: `test-results/return-home-${path.slice(1)}-${width}.png` })
      page.off('request', onRequest)
      await page.getByRole('switch').click()
    }
    expect(failedStyles).toEqual([])
    expect(errors).toEqual([])
  })
}
