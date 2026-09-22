import { test, expect } from '@playwright/test'

test.use({ channel: 'chrome' })

const releaseApi = 'https://api.github.com/repos/heyday-money/heyday/releases?per_page=1'
const releasePage = 'https://github.com/heyday-money/heyday/releases'
const macInstaller = (name: string) => ({
  name,
  browser_download_url: `https://github.com/heyday-money/heyday/releases/download/v1.0.0/${name}`,
})

for (const names of [['Heyday-arm64.dmg'], ['Heyday-arm64.dmg', 'Heyday-universal.dmg', 'Heyday-x64.dmg']]) {
  test(`macOS downloads the latest installer: ${names.join(', ')}`, async ({ page }) => {
    await page.route(releaseApi, route => route.fulfill({ json: [{ prerelease: true, assets: names.map(macInstaller) }] }))
    await page.route('https://github.com/heyday-money/heyday/releases/download/**', route => route.fulfill({
      contentType: 'application/octet-stream',
      headers: { 'content-disposition': 'attachment' },
      body: 'installer fixture',
    }))
    await page.goto('http://127.0.0.1:3000')
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download for macOS' }).click()
    expect((await download).url()).toBe(macInstaller(names.find(name => name.includes('universal')) ?? names[0]).browser_download_url)
  })
}

for (const scenario of ['unavailable', 'network error', 'no DMG', 'no releases', 'separate architectures']) {
  test(`macOS opens releases for ${scenario}`, async ({ page }) => {
    await page.route(releaseApi, route => scenario === 'network error' ? route.abort() : route.fulfill({
      status: scenario === 'unavailable' ? 404 : 200,
      json: scenario === 'no releases' ? [] : [{ assets: (scenario === 'separate architectures' ? ['Heyday-arm64.dmg', 'Heyday-x64.dmg'] : ['Heyday.exe']).map(macInstaller) }],
    }))
    await page.route(releasePage, route => route.fulfill({ contentType: 'text/html', body: 'GitHub releases' }))
    await page.goto('http://127.0.0.1:3000')
    await page.getByRole('button', { name: 'Download for macOS' }).click()
    await expect(page).toHaveURL(releasePage)
  })
}

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
  for (const platform of ['Windows']) {
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

test('language links switch between English at / and Thai at /th', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:3000')
  await expect(page.getByRole('link', { name: 'English', exact: true })).toHaveAttribute('href', '/')
  await page.getByRole('link', { name: 'ไทย', exact: true }).click()
  await expect(page).toHaveURL('http://127.0.0.1:3000/th')
  await expect(page.locator('html')).toHaveAttribute('lang', 'th')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('เงินของคุณ ชีวิตในแบบคุณ')
  await expect(page).toHaveTitle('Heyday.Money — เงินของคุณ ชีวิตในแบบคุณ')
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /มองเห็นกระแสเงินสด/)
  await expect(page.getByRole('link', { name: 'ไทย', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('button', { name: 'ดาวน์โหลดสำหรับ Windows' }).click()
  await expect(page.getByRole('status')).toContainText('Heyday สำหรับ Windows กำลังจะมา')
  await page.getByRole('button', { name: 'ปิดการแจ้งเตือน' }).click()
  await page.getByRole('switch', { name: 'โหมดกลางคืน' }).click()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'th')
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('link', { name: 'English', exact: true }).click()
  await expect(page).toHaveURL('http://127.0.0.1:3000/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page).toHaveTitle('Heyday.Money — Your money, Your Heyday!')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your money, Your Heyday!')
  await page.goBack()
  await expect(page.locator('html')).toHaveAttribute('lang', 'th')
  expect(errors).toEqual([])
})

test('Thai renders on the server and fits desktop and mobile screens', async ({ page, request }) => {
  const response = await request.get('http://127.0.0.1:3000/th')
  expect(response.ok()).toBe(true)
  const html = await response.text()
  expect(html).toContain('lang="th"')
  expect(html).toContain('เงินของคุณ')
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' })
  await page.goto('http://127.0.0.1:3000/th')
  for (const [width, height] of [[1440, 900], [1280, 720], [1024, 600], [390, 844], [375, 667], [320, 640]]) {
    await page.setViewportSize({ width, height })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), `${width}×${height} fits`).toBe(true)
    await expect(page.getByRole('link', { name: 'ไทย', exact: true })).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('switch')).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('button', { name: 'ดาวน์โหลดสำหรับ macOS' })).toBeInViewport({ ratio: 1 })
    await expect(page.locator('.site-footer')).toBeInViewport({ ratio: 1 })
    const copyright = await page.locator('.site-footer').getByText(/©/).boundingBox()
    const languages = await page.getByRole('navigation', { name: 'ภาษา', exact: true }).boundingBox()
    expect(copyright!.x + copyright!.width).toBeLessThanOrEqual(languages!.x)
    const island = await page.locator('.island-image').boundingBox()
    const downloads = await page.locator('.download-area').boundingBox()
    expect(island!.y + island!.height).toBeLessThanOrEqual(downloads!.y)
    await page.screenshot({ path: `test-results/th-${width}-${height}.png` })
  }
})

test('house windows slide open by day and close with lights at night', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' })
  await page.goto('http://127.0.0.1:3000')
  const sashes = page.locator('.house-window-sash')
  await expect(sashes).toHaveCount(3)
  await expect(sashes.first()).toHaveCSS('translate', '0px -64px')
  await expect(sashes.first()).toHaveCSS('transition-duration', '0.95s')
  await page.getByRole('switch', { name: 'Night mode' }).click()
  await expect(sashes.first()).toHaveCSS('translate', '0px')
  await page.reload()
  await expect(sashes.first()).toHaveCSS('translate', '0px')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('switch', { name: 'Night mode' }).click()
  await expect(sashes.first()).toHaveCSS('translate', '0px -64px')
  await expect(sashes.first()).toHaveCSS('transition-duration', '0s')
  await page.locator('.island-float').screenshot({ path: 'test-results/windows-day.png' })
  await page.getByRole('switch', { name: 'Night mode' }).click()
  await page.locator('.island-float').screenshot({ path: 'test-results/windows-night.png' })
})
