// Run explicitly with Node. Uses the real Vue pages and isolated, in-memory bridges.
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { chromium } = require('@playwright/test')

async function observeStorage(page) {
  await page.evaluate(() => {
    window.orderStorageWrites = []; window.orderStorageAttempts = 0; window.failOrderStorage = false
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      const history = key.startsWith('vutron:collection-order-history:') || key.startsWith('vutron:collection-order-history-scopes:')
      if (history && window.failOrderStorage) { window.orderStorageAttempts++; throw new DOMException('Order history quota fixture', 'QuotaExceededError') }
      if (history || key === 'vutron:collection-orders:v1') window.orderStorageWrites.push([key, value])
      return original.call(this, key, value)
    }
  })
}
async function choose(page, trigger, value) {
  await page.locator(trigger).click()
  await page.locator('.app-select-options [data-value="' + value + '"]').click()
}
async function question(page, choice) {
  const dialog = page.locator('.action-dialog')
  await dialog.waitFor({ state: 'visible' })
  assert.equal(await dialog.locator('button').count(), 3, 'Leaving asks Save / Discard / Continue editing before any write')
  await dialog.locator(choice === 'save' ? '[data-default-action]' : choice === 'discard' ? '.secondary-button' : '.text-button').click()
  await dialog.waitFor({ state: 'hidden' })
}
const nativeIds = page => page.locator('.local-track-section .track-row').evaluateAll(rows => rows.map(row => row.dataset.localTrackKey))
const pluginIds = page => page.locator('.plugin-track').evaluateAll(rows => rows.map(row => JSON.parse(row.dataset.pluginTrackId)[1]))
async function capture(page, directory, name) {
  if (!directory) return
  fs.mkdirSync(directory, { recursive: true })
  await page.evaluate(async () => {
    for (let pass = 0; pass < 3; pass++) {
      const finite = document.getAnimations().filter(animation => animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime))
      if (finite.length) await Promise.allSettled(finite.map(animation => animation.finished))
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    }
  })
  await page.screenshot({ path: path.join(directory, name + '.png') })
}
async function checkPermanentFirst(page, trigger, scope, keys, artifacts, screenshot) {
  const expected = await page.evaluate(async ({ scope, keys }) => {
    const history = await import('/src/composables/collectionOrderHistory.ts')
    history.setCollectionOrderHistoryLimit(scope, 10)
    const older = history.recordCollectionOrder(scope, [keys[2], keys[0], keys[1]], 'custom', { promote: true })
    history.renameCollectionOrderHistory(scope, older.id, 'Pinned earlier'); history.pinCollectionOrderHistory(scope, older.id, true)
    const newer = history.recordCollectionOrder(scope, [keys[0], keys[2], keys[1]], 'custom', { promote: true })
    history.renameCollectionOrderHistory(scope, newer.id, 'Pinned later'); history.pinCollectionOrderHistory(scope, newer.id, true)
    const automatic = history.recordCollectionOrder(scope, [keys[1], keys[0], keys[2]], 'artist', { promote: true })
    history.renameCollectionOrderHistory(scope, automatic.id, 'Latest automatic')
    const entries = history.getCollectionOrderHistory(scope).entries
    return { older: older.id, newer: newer.id, automatic: automatic.id,
      ids: [...entries.filter(entry => entry.pinned), ...entries.filter(entry => !entry.pinned)].map(entry => entry.id) }
  }, { scope, keys })
  await page.locator(trigger).click(); await page.locator('.history-entry').first().waitFor()
  assert.deepEqual(await page.locator('.history-entry').evaluateAll(rows => rows.map(row => row.dataset.historyId)), expected.ids)
  assert.deepEqual(expected.ids.slice(0, 2), [expected.newer, expected.older], 'Permanent orders lead in time order even when an automatic order is newer')
  await page.setViewportSize({ width: 320, height: 720 })
  await page.evaluate(async () => {
    (await import('/src/platform/interfacePreferences.ts')).fontScale.value = 150
    ;(await import('/src/platform/i18n.ts')).setAppLocale('en')
  })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await capture(page, artifacts, screenshot)
  await page.locator('[data-history-id="' + expected.automatic + '"]').click()
  await page.locator('.history-preview-back').waitFor()
  const management = page.locator('.history-manage > summary')
  if (await management.getAttribute('aria-expanded') !== 'true') await management.click()
  await page.locator('.history-pin-toggle').click()
  await page.waitForFunction(() => document.querySelector('.history-pin-toggle')?.getAttribute('aria-checked') === 'true')
  await page.locator('.history-preview-back').click()
  await page.waitForFunction(id => document.activeElement?.dataset.historyId === id, expected.automatic)
  assert.equal(await page.locator('.history-entry').first().getAttribute('data-history-id'), expected.automatic)
  assert.equal(await page.locator('[data-history-id="' + expected.automatic + '"]').evaluate(row => {
    const bounds = row.getBoundingClientRect(), panel = row.closest('.collection-history-sheet').getBoundingClientRect()
    return bounds.bottom > panel.top && bounds.top < panel.bottom
  }), true, 'Returning after pinning keeps the relocated focused row visible')
  await page.locator('.collection-history-sheet > header .icon-button').click()
  await page.locator('.collection-history-sheet').waitFor({ state: 'hidden' })
}

async function runNative(page, baseUrl, artifacts) {
  await page.goto(baseUrl + 'tests/fixtures/features.html')
  await page.waitForFunction(() => window.featureReady)
  await observeStorage(page)
  await page.evaluate(async () => {
    const { vutronPlugin: native } = await import('/src/platform/vutronPlugin.ts')
    const store = window.featureHarness.store
    window.nativeSortWrites = []; window.nativeSortFail = false
    window.nativeSortPlaylist = { id: 42, name: 'Draft transaction fixture', creatorUserId: 7, trackCount: 3 }
    window.nativeSortServer = [
      { id: 1, name: 'Zulu', artists: ['Beta'] }, { id: 2, name: 'Alpha', artists: ['Zulu'] }, { id: 3, name: 'Beta', artists: ['Alpha'] }
    ].map(track => ({ ...track, playlistVolumeKey: 'netease:42' }))
    const snapshot = () => ({ userId: 7, playlists: [structuredClone(window.nativeSortPlaylist)], likedIds: [], playlist: structuredClone(window.nativeSortPlaylist), tracks: structuredClone(window.nativeSortServer) })
    native.getOnlineLibrary = async () => snapshot()
    native.getPlaylistTracks = async () => ({ playlist: structuredClone(window.nativeSortPlaylist), tracks: structuredClone(window.nativeSortServer) })
    native.manageNeteaseLibrary = async request => {
      window.nativeSortWrites.push(structuredClone(request))
      if (window.nativeSortFail) { window.nativeSortFail = false; throw new Error('Order synchronization fixture failure') }
      const byId = new Map(window.nativeSortServer.map(track => [track.id, track]))
      window.nativeSortServer = request.trackIds.map(id => byId.get(id))
      return { ...snapshot(), committed: true }
    }
    window.openNativeDraftPlaylist = () => {
      store.profile = { userId: 7, nickname: 'Draft fixture' }; store.localOnly = false
      store.navigateTo('library'); store.selectedPlaylist = structuredClone(window.nativeSortPlaylist); store.tracks = structuredClone(window.nativeSortServer)
    }
    window.openNativeDraftPlaylist()
  })
  const settled = async () => page.waitForFunction(() => !document.querySelector('.page-frame [class*="-enter-active"],.page-frame [class*="-leave-active"]'))
  const open = async () => { await page.evaluate(() => window.openNativeDraftPlaylist()); await page.locator('.local-track-section .track-row').nth(2).waitFor(); await settled() }
  const leave = async () => page.locator('.bottom-nav > button').first().click()
  const home = async () => { await page.waitForFunction(() => window.featureHarness.store.activeTab === 'home'); await page.locator('.local-track-section').waitFor({ state: 'hidden' }); await settled() }
  const move = async () => { await page.locator('.local-track-section .sort-handle').first().focus(); await page.keyboard.press('ArrowDown') }
  await page.locator('.local-track-section .track-row').nth(2).waitFor()
  await settled()
  const initialStorageWrites = await page.evaluate(() => window.orderStorageWrites.length)
  await choose(page, '.local-order-select .app-select-trigger', 'custom')
  await move(); await page.locator('.local-track-section .track-row[data-local-track-key="netease:1"] .sort-handle').focus(); await page.keyboard.press('ArrowUp')
  assert.deepEqual(await nativeIds(page), ['netease:1', 'netease:2', 'netease:3'])
  await leave(); await home()
  assert.equal(await page.locator('.action-dialog').count(), 0)
  assert.equal(await page.evaluate(() => window.orderStorageWrites.length), initialStorageWrites)
  assert.equal(await page.evaluate(() => window.nativeSortWrites.length), 0)

  await open(); await choose(page, '.local-order-select .app-select-trigger', 'custom'); await move()
  await leave(); await page.locator('.action-dialog').waitFor(); await capture(page, artifacts, 'native-leave-question'); await question(page, 'continue')
  assert.equal(await page.evaluate(() => window.featureHarness.store.activeTab), 'library')
  assert.deepEqual(await nativeIds(page), ['netease:2', 'netease:1', 'netease:3'])
  assert.equal(await page.evaluate(() => window.nativeSortWrites.length), 0)
  await leave(); await question(page, 'discard'); await home(); await open()
  assert.deepEqual(await nativeIds(page), ['netease:1', 'netease:2', 'netease:3'])
  assert.equal(await page.evaluate(() => localStorage.getItem('vutron:collection-orders:v1')), null)

  await choose(page, '.local-order-select .app-select-trigger', 'title')
  await page.evaluate(() => { window.failOrderStorage = true })
  await leave(); await question(page, 'save')
  assert.equal(await page.evaluate(() => window.nativeSortWrites.length), 0, 'Failed pre-sync archive blocks the native write')
  assert.ok(await page.evaluate(() => window.orderStorageAttempts) > 0)
  assert.equal(await page.evaluate(() => window.featureHarness.store.activeTab), 'library')
  assert.deepEqual(await nativeIds(page), ['netease:2', 'netease:3', 'netease:1'])
  await page.evaluate(() => { window.failOrderStorage = false; window.nativeSortFail = true })
  await leave(); await question(page, 'save')
  await page.waitForFunction(() => window.nativeSortWrites.length === 1)
  assert.equal(await page.evaluate(() => window.featureHarness.store.activeTab), 'library')
  assert.equal(await page.evaluate(() => localStorage.getItem('vutron:collection-orders:v1')), null)
  assert.deepEqual(await nativeIds(page), ['netease:2', 'netease:3', 'netease:1'])
  assert.equal(await page.locator('.local-track-section .order-draft-actions').count(), 1)
  await capture(page, artifacts, 'native-failed-save-draft')
  await leave(); await question(page, 'save'); await home()
  assert.equal(await page.evaluate(() => window.nativeSortWrites.length), 2)
  await open()
  const savedWrites = await page.evaluate(() => window.orderStorageWrites.length)
  await choose(page, '.local-order-select .app-select-trigger', 'title'); await leave(); await home()
  assert.equal(await page.locator('.action-dialog').count(), 0)
  assert.equal(await page.evaluate(() => window.nativeSortWrites.length), 2)
  assert.equal(await page.evaluate(() => window.orderStorageWrites.length), savedWrites)
  await open(); await choose(page, '.local-order-select .app-select-trigger', 'artist')
  await page.locator('.local-track-section .order-draft-actions .text-button').click()
  assert.deepEqual(await nativeIds(page), ['netease:2', 'netease:3', 'netease:1'])
  assert.equal(await page.locator('.local-track-section .order-draft-actions').count(), 0)
  assert.equal(await page.evaluate(() => window.nativeSortWrites.length), 2)
  await choose(page, '.local-order-select .app-select-trigger', 'custom'); await move()
  await page.locator('.local-track-section .order-draft-actions .secondary-button').click()
  await page.waitForFunction(() => !document.querySelector('.local-track-section .order-draft-actions'))
  const savedCustom = await nativeIds(page), beforeViews = await page.evaluate(() => ({
    requests: window.nativeSortWrites.length, histories: window.orderStorageWrites.filter(([key]) => key !== 'vutron:collection-orders:v1').length
  }))
  await page.evaluate(() => { window.nativeSortServer.sort((a, b) => a.id - b.id); window.featureHarness.store.tracks = structuredClone(window.nativeSortServer) })
  await choose(page, '.local-order-select .app-select-trigger', 'original')
  assert.deepEqual(await nativeIds(page), ['netease:1', 'netease:2', 'netease:3'])
  assert.equal(await page.locator('.local-track-section .order-draft-actions').count(), 0)
  await leave(); await home(); assert.equal(await page.locator('.action-dialog').count(), 0)
  await open(); await choose(page, '.local-order-select .app-select-trigger', 'custom')
  assert.deepEqual(await nativeIds(page), savedCustom)
  assert.equal(await page.locator('.local-track-section .order-draft-actions').count(), 0)
  await page.locator('.local-history-button').click(); await page.locator('.history-recent').click()
  await page.locator('.history-load-actions .primary-button').click(); await page.locator('.collection-history-sheet').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.local-track-section').evaluate(section => section.innerText.includes('排序尚未保存')), false, 'Loading the current preset does not report a nonexistent modification')
  await leave(); await home(); assert.equal(await page.locator('.action-dialog').count(), 0)
  assert.deepEqual(await page.evaluate(() => ({ requests: window.nativeSortWrites.length,
    histories: window.orderStorageWrites.filter(([key]) => key !== 'vutron:collection-orders:v1').length })), beforeViews, 'Saved view switches neither archive nor write the server order')
  await open(); await move(); const pendingCustom = await nativeIds(page)
  await choose(page, '.local-order-select .app-select-trigger', 'original'); await question(page, 'continue')
  assert.deepEqual(await nativeIds(page), pendingCustom)
  await choose(page, '.local-order-select .app-select-trigger', 'original'); await question(page, 'discard')
  assert.deepEqual(await nativeIds(page), ['netease:1', 'netease:2', 'netease:3'])
  assert.equal(await page.evaluate(() => window.nativeSortWrites.length), beforeViews.requests)
  await choose(page, '.local-order-select .app-select-trigger', 'title')
  await page.locator('.local-track-section .order-draft-actions .secondary-button').click()
  await page.waitForFunction(() => !document.querySelector('.local-track-section .order-draft-actions'))
  assert.equal(await page.evaluate(() => window.nativeSortWrites.length), beforeViews.requests + 1, 'A changed named sort still has an explicit server-save action')
  await checkPermanentFirst(page, '.local-history-button', 'netease:7:playlist:42', ['netease:1', 'netease:2', 'netease:3'], artifacts, 'native-permanent-first')
  console.log('PASS: native draft transactions, saved server/custom views without pending prompts, true-edit guard, named-sort server save and permanent-first history')
}

async function runPlugin(page, baseUrl, artifacts) {
  await page.goto(baseUrl + 'tests/fixtures/plugin-ui.html')
  await page.waitForFunction(() => window.pluginReady)
  await observeStorage(page)
  await page.evaluate(async () => {
    const { musicPluginBridge } = await import('/src/plugins/bridge.ts')
    await musicPluginBridge.manageMusicPlugin({ action: 'enable', id: 'fixture' })
    window.pluginHarness.open('fixture')
  })
  await page.locator('.plugin-search').waitFor()
  await page.getByRole('button', { name: '我的歌单', exact: true }).click()
  const open = async () => { await page.locator('.plugin-result-card').filter({ hasText: 'Owned playlist' }).click(); await page.locator('.plugin-track').nth(1).waitFor() }
  const start = async () => { await page.locator('.plugin-playlist-order > .text-button:not(.playlist-order-history-button)').first().click(); await page.locator('.plugin-order-handle').nth(2).waitFor() }
  const move = async () => { await page.locator('.plugin-order-handle').first().focus(); await page.keyboard.press('ArrowDown') }
  const finish = async () => page.locator('.plugin-playlist-order > .secondary-button').first().click()
  const back = async () => page.evaluate(() => window.pluginHarness.back())
  const writes = () => page.evaluate(() => window.pluginHarness.backend.calls.filter(call => call.method === 'reorderPlaylistTracks').length)
  await open(); await start(); const initialStorageWrites = await page.evaluate(() => window.orderStorageWrites.length)
  await move(); await page.locator('.plugin-order-handle').nth(1).focus(); await page.keyboard.press('ArrowUp'); await finish(); await back()
  await page.locator('.plugin-detail').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.action-dialog').count(), 0); assert.equal(await writes(), 0)
  assert.equal(await page.evaluate(() => window.orderStorageWrites.length), initialStorageWrites)

  await open(); await start(); await move()
  await back(); await page.locator('.action-dialog').waitFor(); await capture(page, artifacts, 'plugin-leave-question'); await question(page, 'continue')
  assert.deepEqual(await pluginIds(page), ['track-2', 'track-1', 'track-3'])
  assert.equal(await writes(), 0)
  await page.evaluate(() => {
    let instance = document.querySelector('.plugin-library-page').__vueParentComponent
    while (instance && !instance.exposed?.goRoot) instance = instance.parent
    if (!instance) throw new Error('PluginLibraryView exposed goRoot is unavailable')
    void instance.exposed.goRoot()
  })
  await question(page, 'continue')
  assert.deepEqual(await pluginIds(page), ['track-2', 'track-1', 'track-3'], 'goRoot keeps an unfinished dirty drag until the leave decision')
  assert.equal(await page.locator('.plugin-order-handle').count(), 3)
  assert.equal(await writes(), 0)
  await back(); await question(page, 'discard'); await page.locator('.plugin-detail').waitFor({ state: 'hidden' })
  await open(); await start()
  assert.deepEqual(await pluginIds(page), ['track-1', 'track-2', 'track-3'])
  await move()
  await page.evaluate(() => { window.failOrderStorage = true })
  await back(); await question(page, 'save')
  assert.equal(await writes(), 0); assert.ok(await page.evaluate(() => window.orderStorageAttempts) > 0)
  assert.equal(await page.locator('.plugin-detail').count(), 1)
  await page.evaluate(() => { window.failOrderStorage = false; window.pluginHarness.backend.setFailure('reorderPlaylistTracks') })
  await back(); await question(page, 'save')
  assert.equal(await writes(), 1)
  assert.deepEqual(await pluginIds(page), ['track-2', 'track-1', 'track-3'])
  assert.equal(await page.evaluate(() => localStorage.getItem('vutron:collection-orders:v1')), null)
  await capture(page, artifacts, 'plugin-failed-save-draft')
  await page.locator('.plugin-playlist-order.order-draft-actions .secondary-button').click()
  await page.waitForFunction(() => !document.querySelector('.order-draft-actions'))
  assert.equal(await writes(), 2)
  assert.ok(await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('vutron:collection-orders:v1') || '{}')).some(order => order.mode === 'custom' && order.keys.some(key => key.includes('track-2')))), 'A successful server refresh does not swallow the saved custom preference')
  await back(); await page.locator('.plugin-detail').waitFor({ state: 'hidden' }); await open(); await start()
  const savedStorageWrites = await page.evaluate(() => window.orderStorageWrites.length)
  assert.deepEqual(await pluginIds(page), ['track-2', 'track-1', 'track-3'])
  await finish(); await back(); await page.locator('.plugin-detail').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.action-dialog').count(), 0); assert.equal(await writes(), 2)
  assert.equal(await page.evaluate(() => window.orderStorageWrites.length), savedStorageWrites)
  await open()
  const beforeViews = { requests: await writes(), histories: await page.evaluate(() => window.orderStorageWrites.filter(([key]) => key !== 'vutron:collection-orders:v1').length) }
  await choose(page, '.plugin-playlist-order .app-select-trigger', 'original')
  assert.equal(await page.locator('.order-draft-actions').count(), 0)
  await back(); await page.locator('.plugin-detail').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.action-dialog').count(), 0)
  await open(); await choose(page, '.plugin-playlist-order .app-select-trigger', 'custom')
  assert.deepEqual(await pluginIds(page), ['track-2', 'track-1', 'track-3'])
  await page.locator('.playlist-order-history-button').click(); await page.locator('.history-recent').click()
  await page.locator('.history-load-actions .primary-button').click(); await page.locator('.collection-history-sheet').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.plugin-library-page').evaluate(section => section.innerText.includes('排序尚未保存')), false, 'A no-op plugin preset load clears the pending-change notice')
  await back(); await page.locator('.plugin-detail').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.action-dialog').count(), 0)
  assert.equal(await writes(), beforeViews.requests)
  assert.equal(await page.evaluate(() => window.orderStorageWrites.filter(([key]) => key !== 'vutron:collection-orders:v1').length), beforeViews.histories)
  await open()
  const scope = await page.evaluate(() => JSON.stringify(['plugin', 'fixture', window.pluginHarness.backend.plugins.find(plugin => plugin.id === 'fixture').accountScope, 'playlist-a']))
  const preset = await page.evaluate(async scope => {
    const history = await import('/src/composables/collectionOrderHistory.ts')
    return history.recordCollectionOrder(scope, ['track-3', 'track-2', 'track-1'].map(id => JSON.stringify(['fixture', id])), 'custom').id
  }, scope)
  await page.locator('.playlist-order-history-button').click(); await page.locator('[data-history-id="' + preset + '"]').click()
  await page.locator('.history-load-actions .primary-button').click(); await page.locator('.collection-history-sheet').waitFor({ state: 'hidden' })
  assert.deepEqual(await pluginIds(page), ['track-3', 'track-2', 'track-1'])
  await choose(page, '.plugin-playlist-order .app-select-trigger', 'original'); await question(page, 'continue')
  assert.deepEqual(await pluginIds(page), ['track-3', 'track-2', 'track-1'])
  await choose(page, '.plugin-playlist-order .app-select-trigger', 'original'); await question(page, 'discard')
  assert.deepEqual(await pluginIds(page), ['track-2', 'track-1', 'track-3'])
  assert.equal(await writes(), beforeViews.requests)
  await checkPermanentFirst(page, '.playlist-order-history-button', scope, ['track-1', 'track-2', 'track-3'].map(id => JSON.stringify(['fixture', id])), artifacts, 'plugin-permanent-first')
  console.log('PASS: plugin draft transactions, saved server/custom view switches, pending preset protection and permanent-first history')
}

async function main() {
  const app = path.resolve(__dirname, '..'), artifacts = process.env.VUTRON_TEST_ARTIFACTS || path.resolve(app, '../../_analysis/personal-0.4.17/order-drafts'), { createServer } = await import('vite')
  const server = process.env.VUTRON_TEST_BASE_URL ? undefined : await createServer({ root: app, optimizeDeps: { entries: ['tests/fixtures/features.html', 'tests/fixtures/plugin-ui.html'] },
    plugins: [{ name: 'order-draft-native-fixtures', enforce: 'pre', transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/platform/vutronPlugin.ts')) return "export { vutronPlugin } from '/tests/fixtures/features-native.mock.js'"
      if (id.replaceAll('\\', '/').endsWith('/src/plugins/bridge.ts')) return "export { musicPluginBridge } from '/tests/fixtures/music-plugin-native.mock.js'"
    } }], cacheDir: path.join(app, 'node_modules/.vite-order-draft-tests'), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' })
  let browser
  try {
    await server?.listen()
    const baseUrl = process.env.VUTRON_TEST_BASE_URL || server.resolvedUrls.local[0]
    browser = await chromium.launch({ headless: true, executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
    for (const run of [runNative, runPlugin]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })
      if (process.env.VUTRON_TEST_BASE_URL) await context.route('**/src/plugins/bridge.ts*', route => route.fulfill({ contentType: 'application/javascript', body: "export { musicPluginBridge } from '/tests/fixtures/music-plugin-native.mock.js'" }))
      const page = await context.newPage()
      const pageErrors = []
      page.on('pageerror', cause => pageErrors.push(cause.stack || cause.message))
      try { await run(page, baseUrl, artifacts) }
      catch (cause) { console.error({ pageErrors, ...await page.evaluate(() => ({ text: document.body.innerText.slice(-3000), nativeWrites: window.nativeSortWrites, calls: window.pluginHarness?.backend.calls.slice(-8) })) }); throw cause }
      finally { await context.close() }
    }
    console.log('Order draft screenshots: ' + artifacts)
  } finally { await browser?.close(); await server?.close() }
}
module.exports = { runNative, runPlugin }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
