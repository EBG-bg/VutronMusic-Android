// Real App.vue, native bridge fixtures, and Chromium touch hit testing. No device or music-service writes.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const { chromium } = require('@playwright/test')

async function settle(page, tab) {
  if (tab) await page.waitForFunction(tab => window.featureHarness.store.activeTab === tab, tab)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.waitForFunction(() => {
    const surfaces = [...document.querySelectorAll('.page-stage, .swipe-surface, .bottom-nav-indicator, .navigation-tab-indicator')]
    return surfaces.length && surfaces.every(surface => ![...surface.classList].some(name => /-(enter|leave)-(active|from|to)$/.test(name))
      && surface.getAnimations().every(animation => animation.effect?.getTiming().iterations === Infinity || animation.playState === 'finished' || animation.playState === 'idle'))
  })
}
async function point(page, selector, fraction = .7) {
  const element = page.locator(selector).filter({ visible: true }).first()
  await element.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
  const box = await element.boundingBox()
  assert.ok(box?.width && box?.height, 'Visible touch target: ' + selector)
  return { x: box.x + box.width * fraction, y: box.y + box.height / 2 }
}
async function navPoint(page, index) {
  const box = await page.locator('.bottom-nav > button').nth(index).boundingBox()
  assert.ok(box?.width && box?.height)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
const offset = (page, selector = '.page-stage') => page.locator(selector).last().evaluate(stage => Number.parseFloat(getComputedStyle(stage).translate) || 0)
const current = page => page.evaluate(() => window.featureHarness.store.activeTab)
const indicator = (page, selector = '.bottom-nav-indicator') => page.locator(selector).evaluate(element => ({ x: element.getBoundingClientRect().left, width: element.getBoundingClientRect().width,
  transition: Math.max(...getComputedStyle(element).transitionDuration.split(',').map(Number.parseFloat)) }))
function touchDriver(page, session) {
  let previous
  const send = (type, position) => session.send('Input.dispatchTouchEvent', { type,
    touchPoints: position ? [{ id: 1, x: position.x, y: position.y, radiusX: 1, radiusY: 1, force: 1 }] : [] })
  return {
    async start(position) { previous = position; await send('touchStart', position) },
    async move(position, steps = 5) {
      const from = previous
      for (let step = 1; step <= steps; step++) {
        await send('touchMove', { x: from.x + (position.x - from.x) * step / steps, y: from.y + (position.y - from.y) * step / steps })
        await page.waitForTimeout(17)
      }
      previous = position
    },
    async end() { await send('touchEnd'); previous = undefined },
    async cancel() { await send('touchCancel'); previous = undefined },
  }
}
async function screenshot(page, out, name) {
  fs.mkdirSync(out, { recursive: true })
  await page.screenshot({ path: path.join(out, name + '.png') })
}
async function probeRelease(page, selector) {
  await page.evaluate(selector => {
    window.navigationReleaseFrames = []; window.navigationReleaseProbe = true
    const frame = () => {
      if (!window.navigationReleaseProbe) return
      const surface = document.querySelector(selector)
      if (surface) {
        const style = getComputedStyle(surface)
        window.navigationReleaseFrames.push({ transformX: new DOMMatrixReadOnly(style.transform).m41,
          translateX: Number.parseFloat(style.translate) || 0, start: Number.parseFloat(style.getPropertyValue('--page-leave-start')) || 0 })
      }
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }, selector)
}
async function assertReleaseContinuity(page, label) {
  const frames = await page.evaluate(() => { window.navigationReleaseProbe = false; return window.navigationReleaseFrames })
  assert.ok(frames.length > 0, label + ': actual leave animation frames were sampled')
  assert.ok(frames.every(frame => frame.start < -70 && frame.transformX + frame.translateX < -70), label + ': release continues from the dragged position: ' + JSON.stringify(frames))
  assert.equal(await page.locator('.page-stage:not([class*="leave-active"]), .swipe-surface:not([class*="leave-active"])').evaluateAll(surfaces => surfaces.some(surface => surface.style.getPropertyValue('--page-leave-start'))), false, label + ': the entered surface has no stale leave offset')
}
async function paneGeometry(pane, selectors) {
  return pane.evaluate((element, selectors) => selectors.map(selector => {
    const target = element.querySelector(selector)
    if (!target) throw new Error('Missing transition element: ' + selector)
    const { y, width, height } = target.getBoundingClientRect()
    return { selector, y, width, height, text: target.textContent.trim() }
  }), selectors)
}
function assertPaneHandoff(before, after, tolerance = 1) {
  assert.equal(before.length, after.length)
  for (let index = 0; index < before.length; index++) {
    const a = before[index], b = after[index]
    assert.equal(a.text, b.text, a.selector + ': same content before and after release')
    assert.ok(['y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < tolerance),
      a.selector + ': no vertical or size jump on entering the page: ' + JSON.stringify([a, b]))
  }
}
async function run(page, session, out) {
  const touch = touchDriver(page, session), results = []
  const go = async tab => { await page.evaluate(tab => window.featureHarness.store.navigateTo(tab), tab); await settle(page, tab) }
  const tapNav = async index => { const p = await navPoint(page, index); await page.touchscreen.tap(p.x, p.y) }
  const swipe = async (selector, dx, dy = 0, cancel = false) => {
    const from = await point(page, selector)
    await touch.start(from); await touch.move({ x: Math.max(12, Math.min(378, from.x + dx)), y: from.y + dy })
    if (cancel) await touch.cancel(); else await touch.end()
  }
  await page.evaluate(async () => {
    const { vutronPlugin: native } = await import('/src/platform/vutronPlugin.ts'), store = window.featureHarness.store
    store.stopPlaybackPolling()
    const plain = value => JSON.parse(JSON.stringify(value))
    window.navigationTouch = { plays: 0, pluginPlays: 0, seeks: 0, progressReads: 0, intents: [], clicks: [], playback: plain(store.playback) }
    const navigate = store.navigateTo
    store.navigateTo = tab => { window.navigationTouch.intents.push(tab); return navigate(tab) }
    native.getPlaybackState = async () => plain(window.navigationTouch.playback)
    native.getPlaylistProgress = async () => { window.navigationTouch.progressReads++; return {} }
    native.getPlaylistTracks = async ({ playlistId }) => ({ tracks: [{ id: playlistId + 2000, name: 'Shelf detail song', artists: ['Fixture'] }] })
    native.seek = async ({ position }) => { window.navigationTouch.seeks++; window.navigationTouch.playback.position = position }
    native.play = async ({ track }) => { window.navigationTouch.plays++; window.navigationTouch.playback = plain({ ...store.playback, trackId: track.id, title: track.name, track, duration: 180000, position: 0, playing: false }) }
    native.playMusicPlugin = async ({ track, pluginId, accountScope }) => {
      window.navigationTouch.pluginPlays++
      const nativeTrack = { id: 4242, name: track.name, pluginId, pluginAccountScope: accountScope, pluginTrackId: String(track.id), pluginTrack: plain(track), artists: track.artists?.map(artist => artist.name) || [], duration: 180000 }
      window.navigationTouch.playback = plain({ ...store.playback, trackId: nativeTrack.id, title: nativeTrack.name, track: nativeTrack, duration: 180000, position: 0, playing: false })
      return { track: nativeTrack }
    }
    window.navigationSearchTracks = Array.from({ length: 60 }, (_, index) => ({ id: 1000 + index, name: 'Touch song ' + index, artists: ['Fixture artist'], duration: 180000 }))
    native.search = async ({ category }) => ({ category, items: category === 'tracks' ? structuredClone(window.navigationSearchTracks)
      : Array.from({ length: 8 }, (_, index) => ({ id: 5000 + index, name: category + ' result ' + index, artists: ['Fixture artist'], trackCount: 3 })), count: category === 'tracks' ? 60 : 8, nextPage: 0 })
    document.addEventListener('click', event => {
      if (event.target.closest?.('.bottom-nav')) window.navigationTouch.clicks.push({ trusted: event.isTrusted, detail: event.detail })
    }, true)
    store.homeData = { banners: [], playlists: [], artists: [], albums: [], charts: [], dailyTracks: [] }
    store.playlists = Array.from({ length: 10 }, (_, index) => ({ id: 2600 + index, name: 'Navigation playlist ' + index, trackCount: 3 }))
    store.cachedPlaylists = [{ id: 2700, name: 'Offline navigation playlist', trackCount: 3, cacheOwnerId: 7, offlineSnapshot: true }]
    store.localLibrary.playlists = [{ id: 'navigation-local', name: 'Local navigation playlist', trackCount: 4, isLocalBundle: true }]
    store.localTracks = Array.from({ length: 2000 }, (_, index) => ({ id: 2800 + index, name: 'Navigation device track ' + index, artists: ['Local fixture'] }))
    store.cachedTracks = Array.from({ length: 100 }, (_, index) => ({ id: 5000 + index, name: 'Navigation cache track ' + index, artists: ['Offline fixture'], cached: true }))
    store.searchKeywords = 'Touch navigation'; store.submittedSearch = { category: 'tracks', keywords: 'Touch navigation' }; store.searchCategory = 'tracks'
    store.searchResults = structuredClone(window.navigationSearchTracks)
    store.searchCount = 60; store.searchNextPage = 0
  })
  assert.equal(await page.locator('.bottom-nav > button').count(), 5)

  // In a top-level context, content movement also drives the main selected surface.
  await go('home'); const home = await point(page, '.home-greeting'), homeIndicator = await indicator(page)
  await touch.start(home); await touch.move({ x: home.x - 58, y: home.y + 2 })
  assert.equal(await current(page), 'home'); assert.ok(await offset(page) < -8)
  assert.ok((await indicator(page)).x > homeIndicator.x + 2, 'Main content movement drives the footer selection before release')
  const nextLibrary = page.locator('.page-frame > [data-peek-tab="library"]')
  assert.equal(await nextLibrary.count(), 1, 'The adjacent library is rendered before release')
  assert.equal(await nextLibrary.evaluate(node => node.inert), true, 'Incoming preview cannot intercept interaction')
  const [nextBounds, activeBounds] = await Promise.all([nextLibrary.boundingBox(), page.locator('.page-frame > [data-slide-active]').boundingBox()])
  assert.ok(Math.abs(nextBounds.x - (activeBounds.x + activeBounds.width)) < 1, 'The peek and active page share the same moving seam')
  await screenshot(page, out, 'content-home-drag-edge')
  const mainElements = ['.section-heading h2', '.segmented-control', '.search-box', '.playlist-toolbar', '.playlist-card .playlist-copy b']
  const activePage = page.locator('.page-frame > [data-slide-active]')
  await touch.move({ x: home.x - 145, y: home.y + 2 })
  const mainPreview = await paneGeometry(nextLibrary, mainElements)
  await probeRelease(page, '.page-stage.tab-next-leave-active'); await touch.end(); await settle(page, 'library')
  await assertReleaseContinuity(page, 'Main page')
  assertPaneHandoff(mainPreview, await paneGeometry(activePage, mainElements))

  const savedLibraryScroll = await page.evaluate(() => { scrollTo(0, 440); return scrollY })
  assert.ok(savedLibraryScroll >= 400, 'A longer library can be opened again from a scrolled position')
  await go('home')
  const returnFrom = await point(page, '.home-greeting')
  const homeScroll = await page.evaluate(() => scrollY)
  await touch.start(returnFrom); await touch.move({ x: returnFrom.x - 150, y: returnFrom.y })
  assert.equal(await page.evaluate(() => scrollY), homeScroll, 'Preloading a scrolled destination does not scroll the active screen')
  const previousLibrary = await paneGeometry(nextLibrary, mainElements)
  await touch.end(); await settle(page, 'library')
  assertPaneHandoff(previousLibrary, await paneGeometry(activePage, mainElements))
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - savedLibraryScroll) < 1, 'Library reopens at the remembered scroll position')
  await page.evaluate(() => scrollTo(0, 0))

  // A follow-up gesture begins while the incoming page is still animated.
  await go('home')
  await swipe('.home-greeting', -145)
  await page.waitForFunction(() => window.featureHarness.store.activeTab === 'library' &&
    document.querySelector('.page-frame > [data-slide-active][data-swipe-commit]'))
  const quickFrame = await page.locator('.page-frame').boundingBox()
  const quickStart = { x: quickFrame.x + 130, y: quickFrame.y + 36 }
  await touch.start(quickStart)
  await touch.move({ x: quickStart.x + 145, y: quickStart.y + 1 }, 3)
  await touch.end(); await settle(page, 'home')
  assert.equal(await current(page), 'home', 'The second swipe can reverse without an animation cooldown')
  await go('library')

  // Local categories take priority; an outward drag at either local edge hands
  // the same touch to the neighboring primary page.
  await page.locator('.library-page .segmented-control > button').first().click()
  const libraryView = () => page.locator('.library-page .segmented-control > button.selected').textContent()
  const libraryNames = await page.locator('.library-page .segmented-control > button').allTextContents()
  assert.equal(libraryNames.length, 3)
  const localDeck = page.locator('.page-frame > [data-slide-active] .library-page > .swipe-deck')
  const activeLibrary = localDeck.locator(':scope > [data-slide-active]')
  for (const [index, mode] of [[1, 'local'], [2, 'offline']]) {
    const from = await point(page, '.library-page .section-heading')
    const progressReads = await page.evaluate(() => window.navigationTouch.progressReads)
    await touch.start(from); await touch.move({ x: from.x - 145, y: from.y })
    const peek = localDeck.locator(`:scope > [data-peek-tab="${mode}"]`)
    const targets = ['.library-mode-description', '.search-box', '.playlist-toolbar', '.playlist-card .playlist-copy b', '.track-row .track-copy b']
    const before = await paneGeometry(peek, targets)
    assert.ok(await peek.locator('.windowed-track-item').count() <= 24, 'Only the adjacent track window is rendered while dragging')
    assert.equal(await page.evaluate(() => window.navigationTouch.progressReads), progressReads, 'A read-only adjacent pane never reads playlist progress from Android')
    await touch.end(); await page.waitForFunction(index => document.querySelectorAll('.library-page .segmented-control > button')[index]?.classList.contains('selected'), index)
    await settle(page, 'library')
    assertPaneHandoff(before, await paneGeometry(activeLibrary, targets))
    assert.equal(await current(page), 'library')
  }
  results.push('native library preview uses the active layout, honors remembered scroll and caps preloaded rows without a native progress request')
  const edgeHeading = await point(page, '.library-page .section-heading'), edgeMain = await indicator(page), edgeLocal = await indicator(page, '.segmented-control .navigation-tab-indicator')
  const edgeIntents = await page.evaluate(() => window.navigationTouch.intents.length)
  await touch.start(edgeHeading); await touch.move({ x: edgeHeading.x - 58, y: edgeHeading.y + 1 })
  assert.ok(await offset(page) < -8, 'Only the primary stage follows an outward local-boundary drag')
  assert.ok(Math.abs(await offset(page, '.library-page .content-switch-stage')) < 1, 'The local surface has no second translation')
  assert.ok((await indicator(page)).x > edgeMain.x + 2, 'Primary selection follows the boundary gesture')
  assert.ok(Math.abs((await indicator(page, '.segmented-control .navigation-tab-indicator')).x - edgeLocal.x - await offset(page)) < 1, 'Local selection remains at its edge within the moving primary stage')
  await screenshot(page, out, 'library-edge-primary-preview')
  await touch.cancel(); await settle(page, 'library')
  assert.ok(Math.abs(await offset(page)) < 1, 'Cancelling a handed-off gesture restores the primary stage')
  assert.ok(Math.abs((await indicator(page)).x - edgeMain.x) < 1, 'Cancelling restores the primary selected background')
  assert.equal(await libraryView(), libraryNames[2]); assert.equal(await page.evaluate(start => window.navigationTouch.intents.slice(start).length, edgeIntents), 0)
  await touch.start(edgeHeading); await touch.move({ x: edgeHeading.x - 58, y: edgeHeading.y + 1 })
  await touch.move({ x: edgeHeading.x - 145, y: edgeHeading.y + 1 }); await probeRelease(page, '.page-stage.tab-next-leave-active'); await touch.end(); await settle(page, 'search')
  await assertReleaseContinuity(page, 'Local-to-primary boundary')
  assert.deepEqual(await page.evaluate(start => window.navigationTouch.intents.slice(start), edgeIntents), ['search'], 'One boundary swipe navigates once')
  await go('library'); assert.equal(await libraryView(), libraryNames[2])
  await swipe('.library-page .section-heading', 145); await page.waitForFunction(() => document.querySelectorAll('.library-page .segmented-control > button')[1]?.classList.contains('selected')); await settle(page, 'library')
  await swipe('.library-page .section-heading', 145); await page.waitForFunction(() => document.querySelectorAll('.library-page .segmented-control > button')[0]?.classList.contains('selected')); await settle(page, 'library')
  await swipe('.library-page .section-heading', 145); await settle(page, 'home')
  results.push('library local priority and both primary handoff edges; one translated surface and indicator, continuous release and single navigation')

  // A short destination must not inherit the scroll of a long list, or clamp
  // the document only after the leaving list finishes sliding out.
  await go('library')
  await page.evaluate(() => { scrollTo(0, 0); window.featureHarness.store.cachedTracks = window.featureHarness.store.cachedTracks.slice(0, 5) })
  await page.locator('.library-page .segmented-control > button').nth(1).click(); await settle(page, 'library')
  await page.evaluate(() => scrollTo(0, 9300))
  await page.waitForFunction(() => Number(document.querySelector('.library-page [data-slide-active] .windowed-track-item')?.getAttribute('data-windowed-index')) > 100)
  const visibleRow = '.windowed-track-item'
  const deep = await activeLibrary.evaluate((pane, selector) => {
    const row = Array.from(pane.querySelectorAll(selector)).find(row => {
      const { top } = row.getBoundingClientRect()
      return top >= 520 && top < 640
    })
    return { y: scrollY, top: row?.getBoundingClientRect().top, index: row?.getAttribute('data-windowed-index') }
  }, visibleRow)
  assert.ok(deep.y > 9000 && deep.index)
  const rememberedRow = `${visibleRow}[data-windowed-index="${deep.index}"]`
  await touch.start({ x: 310, y: 540 }); await touch.move({ x: 135, y: 540 })
  const offlinePeek = localDeck.locator(':scope > [data-peek-tab="offline"]')
  const previewTop = await offlinePeek.evaluate(node => node.getBoundingClientRect().top)
  assert.ok(previewTop >= 0 && previewTop < 700, 'A short destination is in view while dragging from deep in a long list')
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - deep.y) <= 2, 'Peeking does not move the long source list')
  await page.evaluate(({ rememberedRow }) => {
    const entries = window.libraryEntryFrames = {}
    function sampleEntry() {
      const active = document.querySelector('.library-page .swipe-deck > [data-slide-active][data-swipe-commit]')
      if (active) {
        const tabs = Array.from(document.querySelectorAll('.library-page .segmented-control > button'))
        const index = tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true')
        entries[index] ??= { y: scrollY, height: document.documentElement.scrollHeight, top: active.getBoundingClientRect().top,
          row: active.querySelector(rememberedRow)?.getBoundingClientRect().top }
      }
      if (!entries[1] || !entries[2]) requestAnimationFrame(sampleEntry)
    }
    requestAnimationFrame(sampleEntry)
  }, { rememberedRow })
  await touch.end()
  await page.waitForFunction(() => window.libraryEntryFrames[2])
  const firstOffline = await page.evaluate(() => window.libraryEntryFrames[2])
  assert.equal(firstOffline.y, 0, 'The short page starts at its own scroll position on the first paint')
  assert.ok(Math.abs(firstOffline.top - previewTop) <= 2, 'Releasing keeps the preview at the same vertical position')
  await touch.start({ x: 235, y: 540 }); await touch.move({ x: 365, y: 540 }, 3)
  const devicePeek = localDeck.locator(':scope > [data-peek-tab="local"]')
  assert.ok(Math.abs(await devicePeek.locator(rememberedRow).evaluate(row => row.getBoundingClientRect().top) - deep.top) <= 10,
    'An immediate reverse drag previews the same deep song')
  assert.deepEqual(await page.evaluate(() => [scrollY, document.documentElement.scrollHeight]), [firstOffline.y, firstOffline.height],
    'A long preview does not expand the short page or move its scroll position')
  await touch.end(); await page.waitForFunction(() => window.libraryEntryFrames[1]); await settle(page, 'library')
  const firstLocal = await page.evaluate(() => window.libraryEntryFrames[1])
  assert.ok(Math.abs(firstLocal.y - deep.y) <= 10 && Math.abs(firstLocal.row - deep.top) <= 10,
    'The returning list restores the deep row and scroll position from the first paint')
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - deep.y) <= 10, 'The return never snaps to the top after settling')
  assert.equal(await localDeck.locator(':scope > [data-slide-leaving], :scope > .swipe-peek').count(), 0)
  await page.evaluate(() => scrollTo(0, 0)); await go('home')
  results.push('deep library subpages preserve per-pane scroll; first-frame and rapid reverse handoff without document growth')

  // A real song row may own a tap, while a horizontal drag changes the local search category.
  await go('search')
  const searchIndicator = await indicator(page), searchLocalIndicator = await indicator(page, '.search-categories .navigation-tab-indicator')
  const row = await point(page, '.search-track-list .track-row')
  await touch.start(row); await touch.move({ x: row.x - 58, y: row.y + 2 })
  assert.equal(await current(page), 'search')
  assert.ok(await offset(page, '.search-page .content-switch-stage') < -8, 'Search content follows the finger while held on a clickable song row')
  assert.ok((await indicator(page, '.search-categories .navigation-tab-indicator')).x > searchLocalIndicator.x + 2, 'Search category indicator follows the local content drag')
  assert.ok(Math.abs((await indicator(page)).x - searchIndicator.x) < 1, 'A local category gesture keeps the main Search tab selected')
  await screenshot(page, out, 'content-song-row-drag')
  await touch.move({ x: row.x - 145, y: row.y + 2 }); await touch.end(); await page.waitForFunction(() => window.featureHarness.store.searchCategory === 'albums'); await settle(page, 'search')
  assert.equal(await page.evaluate(() => window.navigationTouch.plays), 0, 'A navigation swipe cannot activate the row click')
  for (const category of ['artists', 'playlists', 'mvs']) {
    if (category === 'playlists') {
      const from = await point(page, '.search-page .section-heading')
      await touch.start(from); await touch.move({ x: from.x - 145, y: from.y })
      const peek = page.locator('.search-page .swipe-peek[data-peek-tab="playlists"]')
      await peek.locator('.search-playlist-grid .playlist-card').first().waitFor()
      const anchors = ['.library-layout-controls', '.search-playlist-grid .playlist-card .playlist-copy b']
      const before = await paneGeometry(peek, anchors)
      await screenshot(page, out, 'search-preloaded-playlists')
      await touch.end(); await page.waitForFunction(() => window.featureHarness.store.searchCategory === 'playlists'); await settle(page, 'search')
      assertPaneHandoff(before, await paneGeometry(page.locator('.search-page .swipe-deck > [data-slide-active]'), anchors))
    } else {
      await swipe('.search-page .section-heading', -145); await page.waitForFunction(category => window.featureHarness.store.searchCategory === category, category)
      await settle(page, 'search')
    }
    assert.equal(await current(page), 'search')
  }
  results.push('preloaded search playlist cards use the same grid and toolbar before and after release')
  await swipe('.search-page .section-heading', -145); await settle(page, 'player')
  await go('search')
  await page.locator('.search-page .search-categories [role="tab"]').first().click(); await page.locator('.search-track-list .track-row').first().waitFor()
  await swipe('.search-page .section-heading', 145); await settle(page, 'library')
  await go('search'); await page.locator('.search-page .search-categories [role="tab"]').first().click(); await page.locator('.search-track-list .track-row').first().waitFor()
  const rowTap = await point(page, '.search-track-list .track-row')
  await page.touchscreen.tap(rowTap.x, rowTap.y); await settle(page, 'player')
  assert.equal(await page.evaluate(() => window.navigationTouch.plays), 1, 'The next ordinary song tap still plays')
  results.push('clickable song-row search categories, both primary handoff edges, and next-tap playback')

  // The same clickable content must remain a normal vertical scroll surface.
  await go('search'); await page.locator('.search-page .search-categories [role="tab"]').first().click(); await page.locator('.search-track-list .track-row').first().waitFor()
  await page.evaluate(() => scrollTo(0, 0)); const vertical = await point(page, '.search-track-list .track-row')
  const beforeScroll = await page.evaluate(() => scrollY)
  await touch.start(vertical); await touch.move({ x: vertical.x + 3, y: Math.max(110, vertical.y - 210) }); await touch.end(); await page.waitForTimeout(220)
  assert.equal(await current(page), 'search'); assert.ok(await page.evaluate(() => scrollY) > beforeScroll + 25, 'Vertical movement scrolls the page')
  assert.equal(await page.evaluate(() => window.navigationTouch.plays), 1)
  results.push('vertical row scroll keeps its page and does not play')

  // Native horizontal shelves and value controls keep their own gestures.
  await go('home')
  await page.evaluate(() => { window.featureHarness.store.homeData.playlists = Array.from({ length: 15 }, (_, index) => ({ id: 8000 + index, name: 'Shelf ' + index, trackCount: 3 })) })
  const shelf = await point(page, '.horizontal-cards')
  const homeShelf = activePage.locator('.home-page .horizontal-cards').first()
  await homeShelf.evaluate(rail => {
    window.homeShelfScrollEnded = false
    rail.addEventListener('scrollend', () => { window.homeShelfScrollEnded = true }, { once: true })
  })
  await touch.start(shelf); await touch.move({ x: shelf.x - 145, y: shelf.y + 1 }); await touch.end()
  await page.waitForFunction(() => window.homeShelfScrollEnded && document.querySelector('.horizontal-cards').scrollLeft > 20)
  assert.equal(await current(page), 'home'); assert.equal(await page.evaluate(() => Boolean(window.featureHarness.store.selectedPlaylist)), false)
  // Pin an actual snap point beyond the first eight preview cards, without
  // putting the fixture scroll in competition with the earlier touch fling.
  await homeShelf.evaluate(rail => rail.children[9].scrollIntoView({ inline: 'start', block: 'nearest', behavior: 'instant' }))
  await homeShelf.evaluate(rail => new Promise((resolve, reject) => {
    const deadline = performance.now() + 1800
    function frame(now) {
      const padding = parseFloat(getComputedStyle(rail).scrollPaddingLeft) || 0
      const difference = rail.children[9].getBoundingClientRect().left - rail.getBoundingClientRect().left - padding
      if (Math.abs(difference) < 2) resolve()
      else if (now >= deadline) reject(new Error(`Home shelf did not settle on the tenth card: ${difference}px`))
      else requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }))
  const visibleShelfCard = await homeShelf.evaluate(rail => {
    const host = rail.getBoundingClientRect()
    return [...rail.querySelectorAll('.home-cover-card')].map(card => {
      const box = card.getBoundingClientRect()
      return { name: card.querySelector('b').textContent, x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }).find(card => card.x > host.left + 65 && card.x < host.right - 65)
  })
  assert.ok(visibleShelfCard, 'The scrolled shelf has a visible card')
  const rememberedShelfX = await homeShelf.evaluate(rail => rail.scrollLeft)
  await page.touchscreen.tap(visibleShelfCard.x, visibleShelfCard.y)
  await settle(page, 'playlist')
  assert.equal(await activePage.locator('.playlist-hero h2').textContent(), visibleShelfCard.name)
  await activePage.getByText('Shelf detail song', { exact: true }).waitFor()
  assert.equal(await activePage.locator('[data-music-source-switcher]').count(), 0)
  await page.locator('.header-back').click(); await settle(page, 'home')
  const restoredShelfX = await homeShelf.evaluate(rail => rail.scrollLeft)
  assert.ok(Math.abs(restoredShelfX - rememberedShelfX) < 2, `Returning from a home playlist restores its horizontal shelf: ${rememberedShelfX} -> ${restoredShelfX}`)
  await screenshot(page, out, 'home-shelf-after-detail-return')
  await go('library')
  // The deep-scroll scenario leaves Local selected; the first library subpage
  // is the one that can hand a rightward drag to the primary Home page.
  await page.locator('.library-page .segmented-control > button').first().click(); await settle(page, 'library')
  const homeReturnTouch = await point(page, '.library-page .section-heading', .3)
  await touch.start(homeReturnTouch); await touch.move({ x: homeReturnTouch.x + 145, y: homeReturnTouch.y })
  const homePeek = page.locator('.page-frame > [data-peek-tab="home"] [data-home-shelf="playlists"]')
  await homePeek.waitFor()
  assert.ok(Math.abs(await homePeek.evaluate(rail => rail.scrollLeft) - rememberedShelfX) < 2, 'Home preview includes the same scrolled cards')
  await touch.end(); await settle(page, 'home')
  assert.ok(Math.abs(await homeShelf.evaluate(rail => rail.scrollLeft) - rememberedShelfX) < 2, 'Preview hands off to the same live shelf')
  results.push('opening a scrolled home playlist preserves the shelf; content swipe preview matches the arriving home page')
  await go('player'); await page.evaluate(() => { window.featureHarness.store.playback = { ...window.featureHarness.store.playback, duration: 180000, position: 2000 }; window.navigationTouch.playback = JSON.parse(JSON.stringify(window.featureHarness.store.playback)) })
  const thumb = await point(page, '.progress-control .thumb-range-thumb', .5), beforeSeek = await page.evaluate(() => window.navigationTouch.seeks)
  await touch.start(thumb); await touch.move({ x: Math.min(360, thumb.x + 110), y: thumb.y + 1 }); await touch.end()
  await page.waitForFunction(before => window.navigationTouch.seeks > before, beforeSeek)
  assert.equal(await current(page), 'player'); assert.ok(Math.abs(await offset(page)) < 1)
  await page.evaluate(async () => {
    const store = window.featureHarness.store
    store.lyrics = { source: 'plain', original: Array.from({ length: 20 }, (_, index) => ({ start: index * 3000, end: (index + 1) * 3000, text: 'Touch lyric ' + index, words: [] })), translation: [], pairedTranslations: [] }
    ;(await import('/src/platform/interfacePreferences.ts')).playerLyrics.value = false
  })
  await page.locator('.player-artwork').waitFor()
  const cover = await point(page, '.player-artwork'), coverScroll = await page.evaluate(() => scrollY)
  await touch.start(cover); await touch.move({ x: cover.x + 2, y: Math.max(90, cover.y - 145) }); await touch.end(); await page.waitForTimeout(200)
  assert.equal(await current(page), 'player'); assert.equal(await page.evaluate(() => document.querySelectorAll('.player-view-tabs button')[0]?.getAttribute('aria-pressed')), 'true')
  assert.ok(await page.evaluate(() => scrollY) >= coverScroll)
  const coverHorizontal = await point(page, '.player-artwork'), coverIndicator = await indicator(page, '.player-view-tabs .navigation-tab-indicator'), playerMainIndicator = await indicator(page)
  await touch.start(coverHorizontal); await touch.move({ x: coverHorizontal.x - 58, y: coverHorizontal.y + 1 })
  assert.ok(await offset(page, '.player-viewport > .player-visual-pane[data-slide-active]') < -8, 'Cover follows the local horizontal gesture')
  assert.equal(await page.locator('.player-viewport > [data-peek-tab="lyrics"] .original-lyrics-view').count(), 1, 'Lyrics are already laid out next to the cover while dragging')
  assert.ok((await indicator(page, '.player-view-tabs .navigation-tab-indicator')).x > coverIndicator.x + 2, 'Cover/lyrics indicator follows the local content drag')
  assert.ok(Math.abs((await indicator(page)).x - playerMainIndicator.x) < 1, 'Player local gesture keeps the main Player tab selected')
  await screenshot(page, out, 'player-cover-view-drag')
  await touch.move({ x: coverHorizontal.x - 145, y: coverHorizontal.y + 1 }); await probeRelease(page, '.player-visual-pane.surface-next-leave-active'); await touch.end()
  await page.waitForFunction(() => document.querySelectorAll('.player-view-tabs button')[1]?.getAttribute('aria-pressed') === 'true')
  await settle(page, 'player')
  await assertReleaseContinuity(page, 'Cover/lyrics')
  await page.locator('.original-lyrics-scroll').waitFor()
  const lyricArea = await point(page, '.original-lyrics-scroll'), lyricScroll = await page.locator('.original-lyrics-scroll').evaluate(element => element.scrollTop)
  await touch.start(lyricArea); await touch.move({ x: lyricArea.x + 2, y: lyricArea.y - 130 }); await touch.end(); await page.waitForTimeout(200)
  assert.equal(await current(page), 'player'); assert.equal(await page.evaluate(() => document.querySelectorAll('.player-view-tabs button')[1]?.getAttribute('aria-pressed')), 'true')
  assert.ok(await page.locator('.original-lyrics-scroll').evaluate(element => element.scrollTop) > lyricScroll + 10)
  const lyrics = await point(page, '.original-lyric-row', .3), lyricSeeks = await page.evaluate(() => window.navigationTouch.seeks)
  await touch.start(lyrics); await touch.move({ x: Math.min(378, lyrics.x + 145), y: lyrics.y + 2 }); await touch.end()
  await page.waitForFunction(() => document.querySelectorAll('.player-view-tabs button')[0]?.getAttribute('aria-pressed') === 'true')
  await settle(page, 'player')
  assert.equal(await current(page), 'player'); assert.ok(Math.abs(await offset(page)) < 1)
  assert.equal(await page.evaluate(() => window.navigationTouch.seeks), lyricSeeks)
  await swipe('.player-artwork', 145); await settle(page, 'search')
  await go('player'); await page.locator('.player-view-tabs button').last().click(); await settle(page, 'player')
  await page.evaluate(async () => {
    localStorage.setItem('vutron:settings-expanded:appearance', 'true')
    localStorage.setItem('vutron:settings-expanded:cache', 'true')
    const { vutronPlugin: native } = await import('/src/platform/vutronPlugin.ts')
    const original = native.getPlaybackTuning
    window.navigationTouch.settingsReads = 0
    window.navigationTouch.libraryCacheWrites = []
    native.getPlaybackTuning = (...args) => { window.navigationTouch.settingsReads++; return original.apply(native, args) }
    native.setLibraryAutoCache = async ({ enabled }) => {
      window.navigationTouch.libraryCacheWrites.push(enabled)
      return { ...window.featureHarness.store.cacheStatus, libraryAutoCache: enabled }
    }
  })
  const beforeSettingsReads = await page.evaluate(() => window.navigationTouch.settingsReads)
  const fromSettingsEdge = await point(page, '.player-title-row'), settingsPeek = page.locator('.page-frame > [data-peek-tab="settings"]')
  await touch.start(fromSettingsEdge); await touch.move({ x: fromSettingsEdge.x - 145, y: fromSettingsEdge.y })
  await settingsPeek.locator('[data-settings-section="appearance"][open]').waitFor({ state: 'attached' })
  assert.equal(await page.evaluate(() => window.navigationTouch.settingsReads), beforeSettingsReads, 'Settings preview never reads native playback preferences')
  const settingsAnchors = ['.account-settings', '.network-settings', '[data-settings-section="appearance"] .settings-collapse-inner', '[data-settings-section="language"] > summary']
  const preSettings = await paneGeometry(settingsPeek, settingsAnchors)
  await touch.end(); await settle(page, 'settings'); assertPaneHandoff(preSettings, await paneGeometry(activePage, settingsAnchors))
  const cacheToggle = activePage.locator('.cache-toggle').last()
  const cacheInput = cacheToggle.getByRole('switch')
  await cacheInput.press('Space'); await page.waitForFunction(() => window.navigationTouch.libraryCacheWrites.join() === 'false')
  await cacheToggle.locator('span').first().click(); await page.waitForFunction(() => window.navigationTouch.libraryCacheWrites.join() === 'false,true')
  assert.ok((await cacheToggle.boundingBox()).height >= 44, 'The cache control has a full-size tap target')
  await screenshot(page, out, 'cache-switches')
  await page.evaluate(() => { localStorage.removeItem('vutron:settings-expanded:appearance'); localStorage.removeItem('vutron:settings-expanded:cache') })
  results.push('settings peek preserves expanded layout without bridge reads; cache switch supports keyboard and full-row taps')
  const fromPlayerEdge = await point(page, '.settings-page .section-heading', .35), playerPeek = page.locator('.page-frame > [data-peek-tab="player"]')
  await touch.start(fromPlayerEdge); await touch.move({ x: fromPlayerEdge.x + 145, y: fromPlayerEdge.y })
  await playerPeek.locator('.original-lyrics-preview').waitFor({ state: 'attached' })
  assert.equal(await playerPeek.locator('.player-artwork').count(), 0, 'The peek honors the remembered lyrics view')
  const playerAnchors = ['.player-overline', '.player-view-tabs', '.player-title-row .player-title']
  const prePlayer = await paneGeometry(playerPeek, playerAnchors)
  const previewLyricsRect = await playerPeek.locator('.original-lyrics-preview').boundingBox()
  await screenshot(page, out, 'player-lyrics-primary-peek')
  await touch.end(); await settle(page, 'player'); assertPaneHandoff(prePlayer, await paneGeometry(activePage, playerAnchors), 2)
  const liveLyricsRect = await activePage.locator('.original-lyrics-scroll').boundingBox()
  assert.ok(previewLyricsRect && liveLyricsRect && Math.abs(previewLyricsRect.y - liveLyricsRect.y) < 2 && Math.abs(previewLyricsRect.height - liveLyricsRect.height) < 2)
  results.push('primary Player preview follows remembered lyrics and preserves the main layout')
  await page.locator('.player-view-tabs button').first().click(); await settle(page, 'player')
  results.push('horizontal shelf and thumb priority; cover/lyrics local priority, vertical lyric scroll, and both primary handoff edges')

  await page.setViewportSize({ width: 1024, height: 768 }); await page.locator('.player-visual-wide').waitFor(); await settle(page, 'player')
  await page.locator('.player-visual-wide .player-artwork').waitFor({ state: 'visible' }); await page.locator('.player-visual-wide .player-lyrics-view').waitFor({ state: 'visible' })
  await swipe('.player-visual-wide .player-artwork', -145); await settle(page, 'player')
  assert.equal(await page.locator('.player-visual-wide').count(), 1); assert.equal(await page.locator('.player-view-tabs').count(), 0)
  assert.ok(await page.locator('.player-visual-wide .player-artwork').isVisible()); assert.ok(await page.locator('.player-visual-wide .player-lyrics-view').isVisible())
  await screenshot(page, out, 'wide-player-no-cross-tab')
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('.player-view-tabs').waitFor(); await settle(page, 'player')
  results.push('wide player preserves simultaneous cover and lyrics without main-tab navigation')

  // Content boundaries and cancellation never wrap to an unrelated page.
  await go('home'); await swipe('.home-greeting', 140); await settle(page, 'home')
  await swipe('.home-greeting', -145, 1, true); await settle(page, 'home')
  assert.ok(Math.abs(await offset(page)) < 1)
  await go('settings'); await swipe('.settings-page .section-heading', -140); await settle(page, 'settings')
  results.push('content start/end boundaries and touchcancel')

  async function scrub(fromIndex, toIndex, { cancel = false, shot } = {}) {
    await settle(page)
    const before = await current(page), from = await navPoint(page, fromIndex), to = await navPoint(page, toIndex), initial = await indicator(page)
    const counts = await page.evaluate(() => ({ intents: window.navigationTouch.intents.length, clicks: window.navigationTouch.clicks.length }))
    await touch.start(from); await touch.move({ x: from.x + (to.x - from.x) * .55, y: from.y + 1 })
    assert.equal(await page.locator('.bottom-nav[data-scrubbing]').count(), 1)
    assert.equal(await current(page), before, 'Footer dragging previews without changing the active page before release')
    const middle = await indicator(page)
    assert.ok(to.x > from.x ? middle.x > initial.x + 3 : middle.x < initial.x - 3, 'The indicator moves continuously before release')
    if (shot) await screenshot(page, out, shot)
    await touch.move(to)
    if (cancel) await touch.cancel(); else await touch.end()
    await page.waitForTimeout(35)
    if (!cancel) {
      const nativeClicks = await page.evaluate(start => window.navigationTouch.clicks.slice(start).filter(click => click.trusted).length, counts.clicks)
      // WebViews may deliver a compatibility click after a completed pointer drag.
      if (!nativeClicks) await page.locator('.bottom-nav > button').nth(fromIndex).evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })))
    }
    return { before, counts, initial, middle }
  }
  await go('library')
  const preview = await scrub(1, 2, { shot: 'footer-live-preview' }); await settle(page, 'search')
  assert.deepEqual(await page.evaluate(start => window.navigationTouch.intents.slice(start), preview.counts.intents), ['search'], 'Release navigates once and a trailing click cannot navigate back')
  await tapNav(0); await settle(page, 'home')
  const cancelled = await scrub(0, 1, { cancel: true }); await settle(page, 'home')
  assert.equal(await page.locator('.bottom-nav[data-scrubbing]').count(), 0)
  assert.ok(Math.abs((await indicator(page)).x - cancelled.initial.x) < 1)
  const edge = await navPoint(page, 0)
  await touch.start(edge); await touch.move({ x: 8, y: edge.y }); await touch.end(); await settle(page, 'home')
  const verticalNav = await navPoint(page, 0)
  await touch.start(verticalNav); await touch.move({ x: verticalNav.x + 2, y: verticalNav.y - 70 }); await touch.end(); await settle(page, 'home')
  await tapNav(3); await settle(page, 'player')
  results.push('footer continuous preview, release once, compatibility-click suppression, tap, cancellation and boundary')

  // Reduced decoration still permits direct manipulation; full may override the OS preference.
  for (const mode of [{ preference: 'full', system: 'reduce', reduced: false }, { preference: 'system', system: 'reduce', reduced: true },
    { preference: 'system', system: 'no-preference', reduced: false }, { preference: 'reduced', system: 'no-preference', reduced: true }]) {
    await page.emulateMedia({ reducedMotion: mode.system })
    await page.evaluate(preference => import('/src/platform/motion.ts').then(module => { module.motionPreference.value = preference }), mode.preference)
    await page.waitForFunction(reduced => document.documentElement.dataset.motion === (reduced ? 'reduced' : 'full'), mode.reduced)
    await go('home')
    assert.ok(mode.reduced ? (await indicator(page)).transition < .001 : (await indicator(page)).transition > .1)
    await swipe('.home-greeting', -145); await settle(page, 'library')
    await scrub(1, 2); await settle(page, 'search')
    results.push('touch navigation motion ' + mode.preference + '/' + mode.system)
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => import('/src/platform/motion.ts').then(module => { module.motionPreference.value = 'full' }))

  // Connectivity changes the actual tab geometry from five to three, without stale scrub indices.
  await page.evaluate(async () => { await window.featureHarness.backend.setConnected(false) })
  await page.waitForFunction(() => document.querySelectorAll('.bottom-nav > button').length === 3)
  await go('library'); const offlineNames = await page.locator('.library-page .segmented-control > button').allTextContents(); assert.equal(offlineNames.length, 2)
  await page.locator('.library-page .segmented-control > button').first().click(); await swipe('.library-page .section-heading', -145)
  await page.waitForFunction(() => document.querySelectorAll('.library-page .segmented-control > button')[1]?.classList.contains('selected'))
  assert.equal(await current(page), 'library')
  await tapNav(1); await settle(page, 'player'); await scrub(1, 2, { shot: 'offline-three-tab-preview' }); await settle(page, 'settings')
  await swipe('.settings-page .section-heading', 145); await settle(page, 'player')
  await tapNav(0); await settle(page, 'library'); await page.locator('.library-page .segmented-control > button').first().click(); await swipe('.library-page .section-heading', 130); await settle(page, 'library')
  await page.evaluate(async () => { await window.featureHarness.backend.setConnected(true) })
  await page.waitForFunction(() => document.querySelectorAll('.bottom-nav > button').length === 5)
  results.push('automatic offline three tabs and online five tabs use current geometry')

  // Navigation from a real unsaved playlist remains guarded for all three choices.
  await page.evaluate(async () => {
    const { vutronPlugin: native } = await import('/src/platform/vutronPlugin.ts'), store = window.featureHarness.store
    window.navigationSortWrites = []
    window.navigationSortPlaylist = { id: 9101, name: 'Navigation draft fixture', creatorUserId: 7, trackCount: 3 }
    window.navigationSortServer = [1, 2, 3].map(id => ({ id: 9100 + id, name: 'Draft track ' + id, artists: ['Fixture'], playlistVolumeKey: 'netease:9101' }))
    const snapshot = () => ({ userId: 7, playlists: [structuredClone(window.navigationSortPlaylist)], likedIds: [], playlist: structuredClone(window.navigationSortPlaylist), tracks: structuredClone(window.navigationSortServer) })
    native.getOnlineLibrary = async () => snapshot(); native.getPlaylistTracks = async () => ({ playlist: structuredClone(window.navigationSortPlaylist), tracks: structuredClone(window.navigationSortServer) })
    native.manageNeteaseLibrary = async request => {
      window.navigationSortWrites.push(structuredClone(request)); const byId = new Map(window.navigationSortServer.map(row => [row.id, row]))
      window.navigationSortServer = request.trackIds.map(id => byId.get(id)); return { ...snapshot(), committed: true }
    }
    window.openNavigationDraft = () => store.openPlaylist(structuredClone(window.navigationSortPlaylist))
  })
  const openDraft = async () => { await page.evaluate(() => window.openNavigationDraft()); await page.locator('.local-track-section .track-row').nth(2).waitFor(); await settle(page, 'playlist') }
  const edit = async () => {
    if (!await page.locator('.local-track-section .sort-handle').count()) {
      await page.locator('.local-order-select .app-select-trigger').click(); await page.locator('.app-select-options [data-value="custom"]').click()
      await page.locator('.app-select-layer').waitFor({ state: 'hidden' })
    }
    await page.locator('.local-track-section .sort-handle').first().focus(); await page.keyboard.press('ArrowDown')
    await page.locator('.order-draft-actions').waitFor()
  }
  const chooseDraft = async choice => {
    await page.locator('.action-dialog').waitFor(); assert.equal(await page.locator('.action-dialog button').count(), 3)
    await page.locator('.action-dialog ' + (choice === 'save' ? '[data-default-action]' : choice === 'discard' ? '.secondary-button' : '.text-button')).click()
    await page.locator('.action-dialog').waitFor({ state: 'hidden' })
  }
  await openDraft(); await edit(); await scrub(1, 4); await chooseDraft('continue'); await settle(page, 'playlist')
  assert.equal(await page.locator('.order-draft-actions').count(), 1); assert.equal(await page.evaluate(() => window.navigationSortWrites.length), 0)
  await scrub(1, 0); await chooseDraft('discard'); await settle(page, 'home')
  assert.equal(await page.evaluate(() => window.navigationSortWrites.length), 0)
  await openDraft(); await edit(); await scrub(1, 4); await page.locator('.action-dialog').waitFor(); await screenshot(page, out, 'footer-unsaved-sort-question')
  await chooseDraft('save'); await settle(page, 'settings')
  assert.equal(await page.evaluate(() => window.navigationSortWrites.length), 1)
  assert.deepEqual(await page.evaluate(() => window.navigationSortWrites[0].trackIds), [9102, 9101, 9103])
  results.push('footer navigation preserves playlist Continue/Discard/Save choices')

  // Integrated sources own their feature/search tabs rather than moving the main navigation.
  await page.evaluate(async () => {
    const { pluginBackend } = await import('/tests/fixtures/music-plugin-native.mock.js')
    const { musicPluginBridge: bridge } = await import('/src/plugins/bridge.ts')
    const call = bridge.callMusicPlugin
    bridge.callMusicPlugin = async request => {
      const result = await call(request)
      return request.method === 'userPlaylist' ? { ...result, playlists: Array.from({ length: 7 }, (_, index) => ({ ...result.playlists[0], id: index ? 'playlist-' + index : result.playlists[0].id, name: 'Touch playlist ' + index })) } : result
    }
    pluginBackend.plugins.find(plugin => plugin.id === 'fixture').enabled = true
    const { notifyMusicSourcesChanged } = await import('/src/plugins/useMusicSources.ts')
    notifyMusicSourcesChanged(pluginBackend.plugins)
    window.navigationPluginCalls = () => pluginBackend.calls.filter(row => row.method === 'search').length
    window.featureHarness.store.selectMusicSource('fixture', 'library')
  })
  await page.locator('.plugin-library-integrated[data-integrated-section="library"]').waitFor()
  await page.waitForFunction(() => document.querySelectorAll('.plugin-result-card').length === 8)
  await settle(page, 'library')
  const pluginFeatureNames = await page.locator('.plugin-feature-tabs > button').allTextContents()
  assert.ok(pluginFeatureNames.length > 2)
  const featureIndex = () => page.locator('.plugin-feature-tabs > button').evaluateAll(buttons => buttons.findIndex(button => button.getAttribute('aria-pressed') === 'true'))
  assert.equal(await featureIndex(), 0)
  const pluginMain = await indicator(page), pluginLocal = await indicator(page, '.plugin-feature-tabs .navigation-tab-indicator'), pluginFrom = await point(page, '.plugin-swipe-results > .plugin-results-heading')
  await touch.start(pluginFrom); await touch.move({ x: pluginFrom.x - 58, y: pluginFrom.y + 1 })
  assert.ok(await offset(page, '.plugin-swipe-results') < -8)
  assert.ok((await indicator(page, '.plugin-feature-tabs .navigation-tab-indicator')).x > pluginLocal.x + 2)
  assert.ok(Math.abs((await indicator(page)).x - pluginMain.x) < 1)
  assert.ok(Math.abs(await offset(page)) < 1, 'The integrated parent stage does not consume a source-local gesture')
  await screenshot(page, out, 'integrated-plugin-feature-preview')
  await touch.move({ x: pluginFrom.x - 145, y: pluginFrom.y + 1 }); await touch.end()
  await page.waitForFunction(() => document.querySelectorAll('.plugin-feature-tabs > button')[1]?.getAttribute('aria-pressed') === 'true')
  await page.locator('.plugin-track').first().waitFor(); await settle(page, 'library')
  await swipe('.plugin-swipe-results > .plugin-results-heading', 145)
  await page.waitForFunction(() => document.querySelectorAll('.plugin-feature-tabs > button')[0]?.getAttribute('aria-pressed') === 'true')
  await page.waitForFunction(() => document.querySelectorAll('.plugin-result-card').length === 8); await settle(page, 'library')
  await swipe('.plugin-swipe-results > .plugin-results-heading', 145); await settle(page, 'home')
  await go('library'); await page.waitForFunction(() => document.querySelectorAll('.plugin-result-card').length === 8); await settle(page, 'library')
  assert.equal(await featureIndex(), 0)
  const pluginShelf = await point(page, '.plugin-result-strip')
  await touch.start(pluginShelf); await touch.move({ x: pluginShelf.x - 145, y: pluginShelf.y + 1 }); await touch.end()
  await page.waitForFunction(() => document.querySelector('.plugin-result-strip').scrollLeft > 20)
  assert.equal(await featureIndex(), 0); assert.equal(await current(page), 'library'); assert.equal(await page.locator('.plugin-detail').count(), 0)
  await page.locator('.plugin-result-card').nth(1).click(); await page.locator('.plugin-detail').waitFor(); await settle(page, 'library')
  await swipe('.plugin-detail', -145); await settle(page, 'library')
  assert.equal(await page.locator('.plugin-detail').count(), 1); assert.ok(Math.abs(await offset(page)) < 1)
  await go('search'); await page.locator('.plugin-search-tabs > button').first().waitFor(); await settle(page, 'search')
  await page.locator('.plugin-search input').fill('Plugin touch'); await page.locator('.plugin-search button[type="submit"]').click()
  await page.locator('.plugin-track-play').first().waitFor(); await settle(page, 'search')
  const pluginSearchCalls = await page.evaluate(() => window.navigationPluginCalls()), pluginSearchMain = await indicator(page), pluginSearchLocal = await indicator(page, '.plugin-search-tabs .navigation-tab-indicator'), pluginRow = await point(page, '.plugin-track-play')
  await touch.start(pluginRow); await touch.move({ x: pluginRow.x - 58, y: pluginRow.y + 1 })
  assert.ok(await offset(page, '.plugin-swipe-results') < -8)
  assert.ok((await indicator(page, '.plugin-search-tabs .navigation-tab-indicator')).x > pluginSearchLocal.x + 2)
  assert.ok(Math.abs((await indicator(page)).x - pluginSearchMain.x) < 1)
  await touch.move({ x: pluginRow.x - 145, y: pluginRow.y + 1 }); await touch.end()
  await page.waitForFunction(() => document.querySelectorAll('.plugin-search-tabs > button')[1]?.getAttribute('aria-pressed') === 'true'); await settle(page, 'search')
  assert.equal(await page.evaluate(() => window.navigationPluginCalls()), pluginSearchCalls, 'A category swipe preserves the original submit-to-search contract')
  assert.equal(await page.evaluate(() => window.navigationTouch.plays), 1, 'A source-local row swipe cannot activate playback')
  assert.equal(await page.evaluate(() => window.navigationTouch.pluginPlays), 0)
  for (let index = 2; index < 5; index++) { await swipe('.plugin-swipe-results > .plugin-results-heading', -145); await page.waitForFunction(index => document.querySelectorAll('.plugin-search-tabs > button')[index]?.getAttribute('aria-pressed') === 'true', index); await settle(page, 'search') }
  assert.equal(await page.locator('.plugin-search-tabs > button[aria-pressed="true"]').textContent(), await page.locator('.plugin-search-tabs > button').last().textContent())
  await swipe('.plugin-swipe-results > .plugin-results-heading', -145); await settle(page, 'player')
  results.push('integrated feature/search local priority and primary handoff edges, shelf/detail ownership and no row playback')
  return results
}

async function main() {
  const baseUrl = process.env.VUTRON_TEST_BASE_URL || 'http://127.0.0.1:5173/'
  const out = process.env.VUTRON_TEST_ARTIFACTS || path.resolve(__dirname, '../../../_analysis/personal-0.4.18/navigation-touch')
  const browser = await chromium.launch({ headless: true, executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.stack || error.message))
  await context.route('**/src/plugins/bridge.ts*', route => route.fulfill({ contentType: 'application/javascript', body: "export { musicPluginBridge } from '/tests/fixtures/music-plugin-native.mock.js'" }))
  try {
    await page.goto(baseUrl + 'tests/fixtures/features.html'); await page.waitForFunction(() => window.featureReady)
    const session = await context.newCDPSession(page)
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    const checks = await run(page, session, out)
    assert.deepEqual(errors, [])
    fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ browser: browser.version(), checks }, null, 2) + '\n')
    console.log('PASS: actual App touch navigation; ' + checks.join('; '))
    console.log('Navigation touch evidence: ' + out)
  } catch (cause) {
    console.error({ errors, ...await page.evaluate(() => ({ active: window.featureHarness?.store.activeTab, intents: window.navigationTouch?.intents.slice(-12), plays: window.navigationTouch?.plays,
      text: document.body.innerText.slice(-2200), nav: document.querySelector('.bottom-nav')?.outerHTML.slice(0, 1600) })) })
    throw cause
  } finally { await context.close(); await browser.close() }
}
module.exports = { run }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
