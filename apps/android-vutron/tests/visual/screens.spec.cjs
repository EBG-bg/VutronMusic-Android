const { test, expect } = require('@playwright/test')
const path = require('node:path')

test.beforeEach(async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-01-02T12:00:00Z'))
  await page.addInitScript(scene => {
    localStorage.setItem('vutron:language', scene.language)
    localStorage.setItem('vutron:appearance', scene.theme)
    localStorage.setItem('vutron:font-scale', String(scene.fontScale))
    localStorage.setItem('vutron:motion-preference', scene.motion)
    localStorage.setItem('vutron:playlist-sort-hints', 'true')
    localStorage.setItem('vutron:player-lyrics', 'false')
  }, testInfo.project.metadata)
  await page.route(/^https?:\/\//, route => {
    const url = new URL(route.request().url())
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient')
  })
  await page.goto('/tests/visual/app.html')
  await page.waitForFunction(() => window.visualReady === true)
  await expect(page.locator('html')).toHaveAttribute('lang', { zh: 'zh-CN', zht: 'zh-TW', en: 'en' }[testInfo.project.metadata.language])
  await page.evaluate(async () => { await document.fonts.ready; await document.fonts.load('400 16px "Noto Sans SC Variable"'); await document.fonts.load('700 16px "Noto Sans SC Variable"') })
  await expect.poll(() => page.evaluate(() => document.fonts.check('400 16px "Noto Sans SC Variable"'))).toBe(true)
})

async function settle(page) {
  await page.mouse.move(0, 0)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(550)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
}

for (const surface of ['settings', 'player', 'playlist-library', 'track-menu', 'plugin-manager']) {
  test(surface, async ({ page }, testInfo) => {
    if (surface === 'plugin-manager') {
      await page.evaluate(() => window.visualHarness.store.openPlugins())
      await expect(page.locator('.plugin-manager-page')).toBeVisible()
    } else {
      const tab = surface === 'settings' ? 'settings' : surface === 'playlist-library' ? 'library' : 'player'
      await page.evaluate(tab => window.visualHarness.store.navigateTo(tab), tab)
      await expect(page.locator(surface === 'settings' ? '.settings-page' : surface === 'playlist-library' ? '.library-page' : '.player-page')).toBeVisible()
      if (surface === 'track-menu') {
        await page.locator('.player-title-row [data-track-menu-button]').tap()
        await expect(page.locator('.track-action-menu')).toBeVisible()
      }
    }
    await settle(page)
    if (surface === 'player') {
      const controls = await page.locator('.transport-controls').evaluate(element => {
        const bar = document.querySelector('.bottom-nav').getBoundingClientRect()
        const box = element.getBoundingClientRect()
        return { bottom: box.bottom, navigationTop: bar.top, navigationClear: bar.width > bar.height ? box.bottom <= bar.top : box.left >= bar.right, buttonsHit: Array.from(element.querySelectorAll('button')).every(button => {
          const rect = button.getBoundingClientRect()
          return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
        }) }
      })
      expect(controls.navigationClear, JSON.stringify(controls)).toBe(true)
      expect(controls.buttonsHit).toBe(true)
    }
    if (process.env.VUTRON_VISUAL_PROBE === '1' && surface === 'settings') {
      // An explicit local negative check proves that real layout changes fail.
      await page.addStyleTag({ content: '.settings-page { padding-top: 72px !important; }' })
    }
    await expect(page).toHaveScreenshot(surface + '.png', { caret: 'hide', scale: 'css' })
    if (surface === 'plugin-manager') {
      expect(await page.evaluate(() => window.visualHarness.pluginBackend.plugins.length)).toBe(7)
      expect(await page.evaluate(() => window.visualHarness.pluginBackend.plugins.every(row => !row.enabled))).toBe(true)
      expect(await page.evaluate(() => window.visualHarness.pluginBackend.calls.length)).toBe(0)
    }
    if (surface === 'settings' && testInfo.project.name === 'narrow-en') {
      const card = page.locator('[data-settings-section="playback-source-policy"]')
      if (!await card.evaluate(element => element.open)) await card.locator(':scope > summary').tap()
      await expect(card.locator('.audio-policy-providers li')).toHaveCount(7)
      const checkbox = card.getByRole('checkbox')
      await checkbox.uncheck()
      await expect.poll(() => page.evaluate(() => window.visualHarness.nativeBackend.sourceWrites)).toBe(1)
      await expect.poll(() => page.evaluate(() => window.visualHarness.store.autoMatchSources)).toBe(false)
      await expect(card.locator('.audio-policy-providers')).toHaveClass(/inactive/)
      await page.reload()
      await page.waitForFunction(() => window.visualReady === true)
      await page.evaluate(() => window.visualHarness.store.navigateTo('settings'))
      if (!await card.evaluate(element => element.open)) await card.locator(':scope > summary').tap()
      await expect(checkbox).not.toBeChecked()
      await expect(card.locator('.audio-policy-current')).toContainText('FLAC')
      await page.waitForTimeout(400)
      await card.screenshot({ path: path.resolve(__dirname, '../../../../_analysis/visual-regression/source-policy-narrow.png'), animations: 'allow' })
    }
  })
}
