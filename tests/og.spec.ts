import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

test.use({ channel: 'chrome' })

test('OG endpoint returns a cacheable 1200 × 630 PNG', async ({ request }) => {
  const response = await request.get('http://127.0.0.1:3000/api/og')
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('image/png')
  expect(response.headers()['cache-control']).toContain('s-maxage=86400')
  const png = await response.body()
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(png.readUInt32BE(16)).toBe(1200)
  expect(png.readUInt32BE(20)).toBe(630)
  await mkdir('test-results', { recursive: true })
  await writeFile('test-results/og-preview.png', png)
})

for (const [path, locale, title] of [
  ['/', 'en_US', 'Heyday.Money — Your money, Your Heyday!'],
  ['/th', 'th_TH', 'Heyday.Money — เงินของคุณ ชีวิตในแบบคุณ'],
]) {
  test(`social metadata is available without JavaScript at ${path}`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:3000${path}`)
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', title)
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute('content', locale)
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', `https://heyday.money${path}`)
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://heyday.money/api/og')
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image')
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content', 'https://heyday.money/api/og')
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://heyday.money${path}`)
    await context.close()
  })
}
