// Targeted real-App integration only; synthetic accounts and no device/service writes.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')
const { expect } = require('@playwright/test')

async function settlePage(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.waitForFunction(() => {
    const stage = document.querySelector('.page-stage')
    return stage && ![...stage.classList].some(name => /-(enter|leave)-(active|from|to)$/.test(name))
      && stage.getAnimations().every(animation => animation.playState === 'finished' || animation.playState === 'idle')
  })
}

async function integration(page, artifacts) {
  const state = expression => page.evaluate(expression)
  const nav = async name => {
    await settlePage(page)
    await page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click()
    await expect.poll(() => state(() => window.musicSourcesHarness.store.activeTab)).toBe(name === 'Home' ? 'home' : name === 'Search' ? 'search' : 'library')
    await settlePage(page)
  }
  const source = async (id, section = 'library') => {
    await settlePage(page)
    await page.locator('.sidebar-toggle').click()
    await page.locator('[data-music-source-id="' + id + '"]').click()
    await expect.poll(() => state(() => window.musicSourcesHarness.store.activeMusicSourceId)).toBe(id)
    await expect(page.locator('.library-sidebar')).toHaveCount(0)
    await settlePage(page)
    if (section !== 'library') await nav(section === 'home' ? 'Home' : 'Search')
  }
  const native = async section => {
    await settlePage(page)
    await page.locator('.sidebar-toggle').click()
    await page.locator('[data-music-source-native="' + section + '"]').click()
    await expect.poll(() => state(() => window.musicSourcesHarness.store.activeMusicSourceId)).toBe('')
    await expect(page.locator('.library-sidebar')).toHaveCount(0)
  }
  const current = section => page.locator('.plugin-library-integrated[data-integrated-section="' + section + '"]')
  const search = async text => {
    await settlePage(page)
    await page.locator('.plugin-search input').fill(text)
    await page.locator('.plugin-search button[type=submit]').click()
    await expect(page.locator('.plugin-track-play').first()).toContainText(text)
  }
  const calls = operation => page.evaluate(operation => window.musicSourcesHarness.backend.calls.filter(row => row.method === 'call' && (!operation || row.operation === operation)), operation)
  const refreshMetadata = async action => page.evaluate(async action => {
    const harness = window.musicSourcesHarness
    const snapshot = action.kind === 'disable' ? harness.backend.setEnabled(action.id, false) : harness.backend.remove(action.id)
    const { notifyMusicSourcesChanged } = await import('/src/plugins/useMusicSources.ts')
    notifyMusicSourcesChanged(snapshot.plugins)
  }, action)
  const walkHistoryWithout = async id => {
    for (let index = 0; index < 65 && await page.locator('.header-back').count(); index++) {
      await page.locator('.header-back').click()
      assert.notEqual(await state(() => window.musicSourcesHarness.store.activeMusicSourceId), id, 'Back cannot restore an unavailable source')
    }
    assert.equal(await state(() => window.musicSourcesHarness.store.canNavigateBack), false, 'The remaining valid history reaches the native root')
  }

  // The registry is a cold metadata list; provided native/local entries are not duplicated.
  assert.equal((await calls()).length, 0)
  await expect(page.locator('.home-page')).toBeVisible()
  await page.locator('.sidebar-toggle').click()
  await expect(page.locator('[data-music-source-id]')).toHaveCount(2)
  await expect(page.locator('[data-music-source-id="netease"], [data-music-source-id="local"]')).toHaveCount(0)
  await page.locator('[data-music-source-id="fixture"]').click()
  await settlePage(page)
  await nav('Home')
  await expect(current('home')).toBeVisible()
  await expect(current('home')).toContainText('Alpha playlist')
  await expect(page.locator('.plugin-standalone-header')).toHaveCount(0)
  await expect(page.locator('.music-source-picker .app-select-trigger')).toContainText('Alpha library')
  await expect(page.locator('.plugin-search')).toHaveCount(0)
  await nav('Library')
  await expect(current('library')).toContainText('Alpha playlist')
  await page.locator('.plugin-result-card').first().click()
  await expect(page.locator('.plugin-detail')).toContainText('Alpha playlist')
  await page.locator('.plugin-track-play').first().click()
  await expect(page.locator('.player-page')).toBeVisible()
  await page.locator('.collapse-player').click()
  await page.waitForFunction(() => {
    const stage = document.querySelector('.page-stage.page-back-enter-active')
    return stage?.querySelector('.plugin-detail') && stage.getAnimations().some(animation => animation.transitionProperty === 'transform' && Number(animation.effect.getTiming().duration) > 1 && animation.currentTime < animation.effect.getTiming().duration)
  })
  await expect(page.locator('.plugin-detail')).toContainText('Alpha playlist')
  const rapidNavigation = await page.locator('.page-stage').evaluate(element => {
    const animation = element.getAnimations().find(row => row.transitionProperty === 'transform')
    return { phase: element.className, time: animation?.currentTime, duration: animation?.effect.getTiming().duration }
  })
  assert.ok(rapidNavigation.phase.includes('page-back-enter-active') && rapidNavigation.time < rapidNavigation.duration, JSON.stringify(rapidNavigation))
  // The bottom bar is already interactive while the restored detail is entering.
  // Keep this intentional rapid action outside the normal settled-input helper.
  await page.locator('.bottom-nav').getByRole('button', { name: 'Library', exact: true }).click()
  await expect(page.locator('.plugin-detail')).toHaveCount(0)
  await expect(current('library')).toContainText('Alpha playlist')
  await page.locator('.plugin-result-card').first().click()
  await expect(page.locator('.plugin-detail')).toContainText('Alpha playlist')
  await page.locator('.header-back').click()
  await expect(page.locator('.plugin-detail')).toHaveCount(0)
  await expect(current('library')).toContainText('Alpha playlist')
  await expect(page.locator('.plugin-manager-page')).toHaveCount(0)

  await nav('Search')
  await expect(current('search')).toBeVisible()
  assert.equal((await calls('search')).length, 0, 'Entering search does not submit an empty request')
  await search('shared-id')
  const alphaSearch = (await calls('search')).at(-1)
  assert.equal(alphaSearch.pluginId, 'fixture')
  assert.equal(alphaSearch.accountScope, 'alpha-account')
  await page.locator('.music-source-picker .app-select-trigger').click()
  await expect(page.locator('.app-select-panel')).toBeVisible()
  assert.equal(await page.locator('.app-select-panel').evaluate(element => element.contains(document.activeElement)), true)
  await page.locator('.app-select-options [data-value="plugin:fixture:second"]').click()
  await expect(page.locator('.app-select-panel')).toHaveCount(0)
  await expect.poll(() => state(() => window.musicSourcesHarness.store.activeMusicSourceId)).toBe('fixture:second')
  await settlePage(page)
  await nav('Search')
  await expect(current('search')).toBeVisible()
  await search('second-account')
  await expect(current('search')).toContainText('Beta song 1')
  assert.equal((await calls('search')).at(-1).pluginId, 'fixture:second')
  assert.equal((await calls('search')).at(-1).accountScope, 'beta-account')

  // Both instances reuse song/playlist IDs, while request context and UI stay isolated.
  await source('fixture')
  await nav('Home')
  await expect(current('home')).toContainText('Alpha playlist')
  const nativeReads = await state(() => window.musicSourcesHarness.backend.calls.filter(row => ['nativeHome', 'nativeLibrary', 'nativeSearch'].includes(row.method)).length)
  await page.evaluate(() => window.musicSourcesHarness.backend.holdNext('fixture', 'getRecommendPlaylist'))
  await page.locator('.header-refresh').click()
  await expect.poll(() => state(() => window.musicSourcesHarness.backend.held.length)).toBe(1)
  await source('fixture:second', 'home')
  await expect(current('home')).toContainText('Beta playlist')
  await page.evaluate(() => window.musicSourcesHarness.backend.releaseHeld())
  await page.waitForTimeout(80)
  await expect(current('home')).not.toContainText('Alpha playlist')
  assert.equal(await state(() => window.musicSourcesHarness.backend.calls.filter(row => ['nativeHome', 'nativeLibrary', 'nativeSearch'].includes(row.method)).length), nativeReads, 'Refreshing and switching a source do not refresh the native account')

  // The same player and track menu handle source songs; returning preserves the source.
  await source('fixture')
  await nav('Search')
  await search('player-check')
  await page.locator('.plugin-track-options summary').first().click()
  await page.locator('.plugin-track-options[open]').getByRole('button', { name: 'Play next', exact: true }).click()
  await expect.poll(() => state(() => window.musicSourcesHarness.backend.calls.filter(row => row.method === 'pluginQueue').length)).toBe(1)
  await page.locator('.plugin-track-play').first().click()
  await expect(page.locator('.player-page')).toBeVisible()
  await expect(page.locator('.player-title-row')).toContainText('Alpha song 1')
  assert.equal(await state(() => window.musicSourcesHarness.backend.calls.find(row => row.method === 'pluginPlay').value.accountScope), 'alpha-account')
  await page.locator('.player-title-row [data-track-menu-button]').click()
  await expect(page.locator('.track-action-menu')).toBeVisible()
  await expect(page.locator('.track-action-menu .plugin-shared-track-actions')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.track-action-menu')).toHaveCount(0)
  await expect(page.locator('.player-title-row [data-track-menu-button]')).toBeFocused()
  await page.locator('.header-back').click()
  await expect(current('search')).toBeVisible()
  assert.equal(await state(() => window.musicSourcesHarness.store.activeMusicSourceId), 'fixture')

  // No native account is required to use an independently configured online source.
  await page.evaluate(() => window.musicSourcesHarness.backend.setNativeLogin(false))
  await page.reload()
  await page.waitForFunction(() => window.musicSourcesReady === true)
  assert.equal(await state(() => window.musicSourcesHarness.store.loggedIn), false)
  assert.equal(await state(() => window.musicSourcesHarness.store.manualLocalOnly), false)
  await source('fixture:second')
  await expect(page.locator('.bottom-nav > button')).toHaveCount(5)
  await nav('Home')
  await expect(current('home')).toContainText('Beta playlist')
  await nav('Search')
  await search('guest-source')
  await expect(current('search')).toContainText('Beta song 1')
  await expect(page.locator('.login-view')).toHaveCount(0)

  await visualAndMotion(page, artifacts, source, nav)

  // Manual offline forbids source requests; both native local and cache remain playable.
  await page.evaluate(() => window.musicSourcesHarness.store.enterLocalOnly())
  const beforeOffline = (await calls()).length
  await source('fixture')
  await nav('Home')
  await expect(current('home')).toBeVisible()
  await expect(current('home')).toContainText('paused plugin network requests')
  assert.equal((await calls()).length, beforeOffline)
  await native('local')
  await expect(page.locator('.library-page')).toContainText('Phone song')
  await page.locator('.local-track-section .track-row').filter({ hasText: 'Phone song' }).first().click()
  await expect(page.locator('.player-page')).toBeVisible()
  await expect(page.locator('.player-title-row')).toContainText('Phone song')
  await native('offline')
  await expect(page.locator('.library-page')).toContainText('Cached song')
  await page.locator('.offline-content .track-row').filter({ hasText: 'Cached song' }).first().click()
  await expect(page.locator('.player-title-row')).toContainText('Cached song')
  assert.equal((await calls()).length, beforeOffline)
  await page.evaluate(() => window.musicSourcesHarness.store.useAutomaticMode())

  await source('fixture:second')
  await nav('Home')
  await expect(current('home')).toContainText('Beta playlist')
  await refreshMetadata({ kind: 'disable', id: 'fixture:second' })
  await expect.poll(() => state(() => window.musicSourcesHarness.store.activeMusicSourceId)).toBe('')
  await expect(page.locator('.plugin-library-integrated')).toHaveCount(0)
  await expect(page.locator('.plugin-manager-page')).toHaveCount(0)
  await walkHistoryWithout('fixture:second')
  await source('fixture')
  await nav('Home')
  await expect(current('home')).toContainText('Alpha playlist')
  await refreshMetadata({ kind: 'remove', id: 'fixture' })
  await expect.poll(() => state(() => window.musicSourcesHarness.store.activeMusicSourceId)).toBe('')
  await expect(page.locator('.plugin-library-integrated')).toHaveCount(0)
  await expect(page.locator('.plugin-manager-page')).toHaveCount(0)
  await walkHistoryWithout('fixture')
  await expect(page.locator('[data-music-source-switcher]')).toHaveCount(0)
  return { business: ['native and two instances', 'home library search and detail return', 'source/account isolation and stale response', 'shared player menu and queue', 'source without native login', 'manual offline local/cache play', 'disabled/removed source fallback'], rapidNavigation, visual: '320px English 150%, light/dark screenshots', motion: 'full overrides OS reduce; system follows change; reduced removes sidebar decoration' }
}

async function visualAndMotion(page, artifacts, source, nav) {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.evaluate(async () => {
    (await import('/src/platform/interfacePreferences.ts')).fontScale.value = 150
    ;(await import('/src/platform/i18n.ts')).setAppLocale('en')
  })
  await source('fixture')
  await nav('Library')
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async theme => { (await import('/src/platform/appearance.ts')).appearance.value = theme }, theme)
    await page.waitForTimeout(400)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, theme + ' source library fits at 320px English 150%')
    await page.screenshot({ path: path.join(artifacts, 'library-narrow-' + theme + '.png') })
    const previousScrollStyles = await page.evaluate(() => [document.documentElement.style.overflow, document.body.style.overflow])
    await page.locator('.sidebar-toggle').click()
    await page.waitForTimeout(400)
    assert.equal(await page.locator('.app-shell').evaluate(element => Boolean(element.closest('[inert]'))), true, 'The source sidebar isolates the main App')
    assert.deepEqual(await page.evaluate(() => [document.documentElement.style.overflow, document.body.style.overflow]), ['hidden', 'hidden'], 'The source sidebar locks background scrolling')
    assert.equal(await page.locator('.library-sidebar').evaluate(element => element.contains(document.activeElement)), true, 'Opening the source sidebar moves focus inside')
    await page.locator('.library-sidebar').evaluate(element => {
      window.sourceSidebarControls = [...element.querySelectorAll('button,input,a[href],[tabindex]')].filter(row => row.tabIndex >= 0 && !row.matches(':disabled') && row.getClientRects().length)
      window.sourceSidebarControls.at(-1).focus()
    })
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement === window.sourceSidebarControls[0]), true, 'Tab remains in the source sidebar')
    await page.keyboard.press('Shift+Tab')
    assert.equal(await page.evaluate(() => document.activeElement === window.sourceSidebarControls.at(-1)), true, 'Reverse Tab remains in the source sidebar')
    await page.evaluate(() => window.sourceSidebarControls[0].focus())
    const geometry = await page.locator('[data-music-source-id]').evaluateAll(rows => rows.map(row => { const box = row.getBoundingClientRect(); return { width: box.width, right: box.right, height: box.height, hit: row.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) } }))
    assert.equal(geometry.length, 2)
    assert.ok(geometry.every(row => row.width > 0 && row.right <= 320 && row.height >= 44 && row.hit), JSON.stringify(geometry))
    await page.screenshot({ path: path.join(artifacts, 'sidebar-narrow-' + theme + '.png') })
    await page.keyboard.press('Escape')
    await expect(page.locator('.library-sidebar')).toHaveCount(0)
    await expect(page.locator('.sidebar-toggle')).toBeFocused()
    assert.equal(await page.locator('.app-shell').evaluate(element => Boolean(element.closest('[inert]'))), false)
    assert.deepEqual(await page.evaluate(() => [document.documentElement.style.overflow, document.body.style.overflow]), previousScrollStyles)
  }
  const setMotion = async (preference, system) => {
    await page.emulateMedia({ reducedMotion: system })
    await page.evaluate(async preference => { (await import('/src/platform/motion.ts')).motionPreference.value = preference }, preference)
    await expect(page.locator('html')).toHaveAttribute('data-motion', preference === 'reduced' || preference === 'system' && system === 'reduce' ? 'reduced' : 'full')
  }
  const sidebarAnimation = async animated => {
    await page.locator('.sidebar-toggle').click()
    await page.waitForFunction(() => Boolean(document.querySelector('.library-sidebar')))
    if (animated) {
      await page.waitForFunction(() => document.querySelector('.library-sidebar').getAnimations().some(animation => animation.transitionProperty === 'transform' && Number(animation.effect.getTiming().duration) > 1))
      const sample = () => page.locator('.library-sidebar').evaluate(element => ({ x: element.getBoundingClientRect().x, time: element.getAnimations().find(animation => animation.transitionProperty === 'transform')?.currentTime }))
      const first = await sample()
      await page.waitForTimeout(45)
      const second = await sample()
      assert.ok(second.time > first.time && second.x > first.x, JSON.stringify({ first, second }))
    } else {
      await page.waitForTimeout(40)
      assert.equal(await page.locator('.library-sidebar').evaluate(element => element.getAnimations().some(animation => Number(animation.effect.getTiming().duration) > 1)), false)
      assert.equal(await page.locator('.library-sidebar').evaluate(element => getComputedStyle(element).transform), 'none')
    }
    await page.waitForTimeout(350)
    await page.keyboard.press('Escape')
    await expect(page.locator('.library-sidebar')).toHaveCount(0)
  }
  await setMotion('full', 'reduce'); await sidebarAnimation(true)
  await setMotion('system', 'reduce'); await sidebarAnimation(false)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full')
  await sidebarAnimation(true)
  await setMotion('reduced', 'no-preference'); await sidebarAnimation(false)
  await setMotion('full', 'no-preference')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(async () => { (await import('/src/platform/interfacePreferences.ts')).fontScale.value = 100 })
}

async function main() {
  const app = path.resolve(__dirname, '..')
  const packageInfo = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8').replace(/^\uFEFF/, ''))
  const releaseInfo = JSON.parse(fs.readFileSync(path.join(app, 'mobile-release.json'), 'utf8').replace(/^\uFEFF/, ''))
  const expectOfficial = process.env.VUTRON_EXPECT_OFFICIAL === '1' || !fs.existsSync(path.join(app, '_private/build-personal.json'))
  const artifacts = path.resolve(app, '../../_analysis', expectOfficial ? 'mobile-' + packageInfo.version : 'music-sources-integration', 'music-sources')
  fs.mkdirSync(artifacts, { recursive: true })
  const { createServer } = await import('vite')
  const server = await createServer({
    root: app,
    optimizeDeps: { entries: ['tests/fixtures/music-sources-integration.html'] },
    plugins: [{ name: 'isolated-music-sources', enforce: 'pre', transform(code, id) {
      const file = id.replaceAll('\\', '/')
      if (file.endsWith('/src/platform/vutronPlugin.ts')) return "export { vutronPlugin } from '/tests/fixtures/music-sources-integration-native.mock.js'"
      if (file.endsWith('/src/plugins/bridge.ts')) return "export { musicPluginBridge } from '/tests/fixtures/music-sources-integration-native.mock.js'"
    } }],
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'error'
  })
  let browser, page
  const errors = []
  try {
    await server.listen()
    browser = await chromium.launch({ headless: true, args: ['--force-color-profile=srgb', '--font-render-hinting=none'] })
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: 'UTC' })
    page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.route(/^https?:\/\//, route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient'))
    await page.addInitScript(() => {
      localStorage.setItem('vutron:appearance', 'light')
      localStorage.setItem('vutron:language', 'en')
      localStorage.setItem('vutron:font-scale', '100')
      localStorage.setItem('vutron:motion-preference', 'full')
    })
    await page.goto(server.resolvedUrls.local[0] + 'tests/fixtures/music-sources-integration.html')
    await page.waitForFunction(() => window.musicSourcesReady === true)
    await page.evaluate(() => document.fonts.ready)
    let formalIdentity, aboutIdentity
    if (expectOfficial) {
      formalIdentity = await page.evaluate(async () => (await import('/src/platform/buildInfo.ts')).buildInfo)
      assert.equal(formalIdentity.edition, 'mobile')
      assert.equal(formalIdentity.displayName, 'Vutron Music - Mobile')
      assert.equal(formalIdentity.version, packageInfo.version)
      assert.equal(formalIdentity.versionCode, releaseInfo.versionCode)
      await expect(page.locator('.app-header h1')).toHaveText('Vutron Music - Mobile')
    }
    const results = await integration(page, artifacts)
    if (expectOfficial) {
      await settlePage(page)
      await page.locator('.bottom-nav').getByRole('button', { name: 'Settings', exact: true }).click()
      await settlePage(page)
      const updates = page.locator('[data-settings-section=app-update]')
      if (await updates.locator(':scope > summary').getAttribute('aria-expanded') !== 'true') await updates.locator(':scope > summary').click()
      await updates.locator('.about-entry').click()
      await expect(page.locator('.about-identity h2')).toHaveText('Vutron Music - Mobile')
      await expect(page.locator('.about-identity')).toContainText(packageInfo.version)
      await expect(page.locator('.about-identity')).toContainText(String(releaseInfo.versionCode))
      await expect(page.locator('.app-header h1')).toHaveText('Vutron Music - Mobile')
      await settlePage(page)
      aboutIdentity = await page.locator('.about-identity').innerText()
      await page.screenshot({ path: path.join(artifacts, 'about-mobile.png') })
    }
    assert.deepEqual(errors, [])
    fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify({ browser: browser.version(), ...results, formalIdentity, aboutIdentity, pageErrors: errors }, null, 2))
    for (const name of ['failure.json', 'failure.png']) fs.rmSync(path.join(artifacts, name), { force: true })
    console.log('PASS: main App source navigation, isolation, local/offline fallback, shared playback/menu, narrow themed layout and real motion preferences')
  } catch (error) {
    let document
    if (page) {
      document = await page.evaluate(() => ({ tab: window.musicSourcesHarness?.store.activeTab, source: window.musicSourcesHarness?.store.activeMusicSourceId, body: window.document.body.innerText })).catch(() => undefined)
      await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {})
    }
    fs.writeFileSync(path.join(artifacts, 'failure.json'), JSON.stringify({ message: error.message, errors, document }, null, 2))
    throw error
  } finally {
    await browser?.close()
    await server.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
