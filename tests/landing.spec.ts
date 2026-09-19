import { test, expect } from '@playwright/test'

test.use({ channel: 'chrome' })

test('themes, downloads, mobile layout, and reduced motion', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('http://127.0.0.1:3000')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your money, Your Heyday!')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('.island-image')).toHaveJSProperty('naturalWidth', 1536)
  await expect(page.locator('.island-float')).toHaveCSS('animation-name', 'none')
  await page.screenshot({ path: 'test-results/day-desktop.png', fullPage: true })
  await page.getByRole('switch', { name: 'Night mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  await page.screenshot({ path: 'test-results/night-desktop.png', fullPage: true })
  for (const platform of ['macOS', 'Windows']) {
    await page.getByRole('button', { name: `Download for ${platform}` }).click()
    await expect(page.getByRole('status')).toContainText(`Heyday for ${platform} is coming soon`)
    await page.getByRole('button', { name: 'Dismiss notification' }).click()
    await expect(page.getByRole('status')).toBeEmpty()
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('switch').click()
  await page.screenshot({ path: 'test-results/day-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.getByRole('button', { name: 'Download for Windows' })).toBeInViewport()
  await page.evaluate(() => localStorage.removeItem('heyday-theme'))
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(errors).toEqual([])
})

test('fits common screen heights without clipping the island or downloads', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  await page.goto('http://127.0.0.1:3000')
  for (const [width, height] of [[1440, 900], [1366, 768], [1280, 720], [1024, 600], [768, 1024], [390, 844], [375, 667]]) {
    await page.setViewportSize({ width, height })
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth), `${width}×${height} fits`).toBe(true)
    const island = await page.locator('.island-image').boundingBox()
    const downloads = await page.locator('.download-area').boundingBox()
    const content = await page.locator('main').boundingBox()
    expect(Math.abs(content!.x + content!.width / 2 - width / 2)).toBeLessThan(1)
    expect(Math.abs(content!.y + content!.height / 2 - height / 2)).toBeLessThan(1)
    await expect(page.locator('.day-sun')).toHaveCSS('width', width < 640 ? '44px' : '64px')
    expect(island!.y + island!.height).toBeLessThanOrEqual(downloads!.y)
    await expect(page.locator('.site-footer')).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('button', { name: 'Download for Windows' })).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: `test-results/fit-${width}-${height}.png` })
  }
})

test('sun and moon rise on the left and set on the right', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('http://127.0.0.1:3000')
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  for (const outgoing of ['day-sun', 'night-moon']) {
    await page.getByRole('switch').click()
    const body = page.locator(`.celestial-body.${outgoing}`)
    await expect(body).toHaveCSS('animation-name', 'celestial-set')
    const positions = await body.evaluate(async element => {
      const animation = element.getAnimations()[0]
      animation.pause()
      await animation.ready
      const samples = []
      for (const time of [1, 650, 1800]) {
        animation.currentTime = time
        await new Promise(requestAnimationFrame)
        await new Promise(requestAnimationFrame)
        const rect = element.getBoundingClientRect()
        samples.push({ x: rect.x, y: rect.y })
      }
      return samples
    })
    expect(positions[1].x).toBeGreaterThan(positions[0].x)
    expect(positions[1].y).toBeGreaterThan(positions[0].y)
    // The orbit curves down just beyond the right horizon as the body fades.
    expect(positions[2].x).toBeGreaterThan(1366 / 2)
    expect(positions[2].y).toBeGreaterThan(positions[1].y)
    await expect(body).toHaveCSS('opacity', '0')
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('switch').click()
  await expect(page.locator('.night-moon')).toHaveCSS('opacity', '1')
  await expect(page.locator('.night-moon')).toHaveCSS('animation-name', 'none')
  await expect(page.locator('.day-sun')).toHaveCSS('opacity', '0')
})
