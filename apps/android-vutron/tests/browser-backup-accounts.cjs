const assert = require('node:assert/strict')

module.exports = async ({ page, evaluate, wait, delay }) => {
  const section = '[data-settings-section=user-backup]'
  const exportButton = `${section} .timer-actions button:first-child`, importButton = `${section} .timer-actions button:last-child`
  const toggle = index => `${section} .settings-detail:nth-child(${index}) button`
  const dialog = '.action-dialog'
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const waitDialog = () => wait(`document.querySelector(${JSON.stringify(dialog)}) && !document.querySelector('.action-dialog-layer')?.className.includes('leave')`)
  const closeDialog = async confirm => {
    await click(dialog + (confirm ? ' [data-default-action]' : ' .text-button'))
    await wait(`!document.querySelector('.action-dialog')`)
  }
  await evaluate(`(async () => {
    const { vutronPlugin: api } = await import('/tests/fixtures/personal-ui-native.mock.js')
    const { musicPluginBridge } = await import('/tests/fixtures/music-plugin-native.mock.js')
    const t = window.backupTest = { exports: [], imports: [], cancels: [], inspections: 0, sourceReads: 0, owner: 7, sensitive: false }
    const list = musicPluginBridge.listMusicPlugins.bind(musicPluginBridge)
    musicPluginBridge.listMusicPlugins = async (...args) => { t.sourceReads++; return list(...args) }
    api.exportUserBackup = async options => { t.exports.push(options); return { collectionCount: 0 } }
    api.getSession = async () => ({loggedIn:true, profile:{userId:t.owner, nickname:'Listener '+t.owner}})
    api.getPlaylists = async () => ({playlists:[{id:t.owner, name:'Library '+t.owner}]})
    api.inspectUserBackup = async () => ({ requestId: 'import-' + (++t.inspections), archive: true, collectionCount: 3, trackCount: 27, cacheItems: 12, audioItems: 9, hasAccounts: t.sensitive })
    api.cancelUserBackupImport = async options => { t.cancels.push(options) }
    api.completeUserBackupImport = async options => {
      t.imports.push(options)
      if (!t.sensitive || !options.includePrivacy) return { collectionCount: 0 }
      t.owner = 27
      return { neteaseRestored:true, pluginAccountsRestored:1, pluginAccountsSkipped:1, cacheIncomplete:true, collectionCount:0 }
    }
    await window.featureHarness.store.navigateTo('settings')
  })()`)
  await wait(`document.querySelector('${section} summary')`)
  await click(section + ' summary')
  await wait(`document.querySelector('${section} button.switch')`)
  assert.equal(await evaluate(`document.querySelector('${toggle(1)}').getAttribute('aria-checked')`), 'false')
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
  await wait(`document.querySelector('${section}').getAnimations({subtree:true}).every(a => a.playState !== 'running')`)
  await evaluate(`document.querySelector('${section} .backup-options').scrollIntoView({block:'center',behavior:'instant'})`)
  const points = await evaluate(`Array.from(document.querySelectorAll('${section} [data-range-key]'), row => {
    const {x,y,width,height} = row.getBoundingClientRect(); return {x:x+width/2,y:y+height/2};
  })`)
  for (const [i, {x,y}] of points.entries()) {
    assert.equal(await evaluate(`document.elementFromPoint(${x},${y})?.closest('[data-range-key]')?.dataset.rangeKey`), ['privacy','cache'][i], 'The touch must land on the visible backup option')
  }
  const touch = (type, point) => page.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ ...point, id: 1 }] : [] })
  await touch('touchStart', points[0]); await wait(`document.querySelector('${toggle(1)}').getAttribute('aria-checked') === 'true'`)
  await touch('touchMove', points[1]); await wait(`document.querySelector('${toggle(2)}').getAttribute('aria-checked') === 'true'`)
  await touch('touchMove', points[0]); await wait(`document.querySelector('${toggle(2)}').getAttribute('aria-checked') === 'false'`)
  await touch('touchEnd'); await delay(80)
  assert.equal(await evaluate('backupTest.exports.length'), 0)
  assert.equal(await evaluate('backupTest.imports.length'), 0)
  assert.equal(await evaluate(`document.querySelector('${toggle(1)}').getAttribute('aria-checked')`), 'true')
  await click(toggle(1))
  await click(exportButton)
  await wait('backupTest.exports.length === 1')
  assert.equal(await evaluate('backupTest.exports[0].includePrivacy'), false)
  await click(toggle(1))
  for (const archive of [false, true]) {
    if (archive) await click(toggle(2))
    const before = await evaluate('backupTest.exports.length')
    await click(exportButton); await waitDialog()
    assert.ok(await evaluate(`document.querySelector('#action-dialog-message').textContent.includes('登录凭据')`))
    assert.equal(await evaluate('backupTest.exports.length'), before)
    await closeDialog(false)
    assert.equal(await evaluate('backupTest.exports.length'), before)
    await click(exportButton); await waitDialog(); await closeDialog(true)
    await wait(`backupTest.exports.length === ${before + 1}`)
    const result = await evaluate('backupTest.exports.at(-1)')
    assert.equal(result.includePrivacy, true); assert.equal(result.includeCache, archive); assert.equal(result.language, 'zh')
  }
  await click(toggle(2))
  await click(importButton); await waitDialog(); await closeDialog(false)
  assert.equal(await evaluate('backupTest.imports.length'), 0)
  assert.equal(await evaluate('backupTest.cancels.length'), 1)
  await click(importButton); await waitDialog()
  assert.ok(await evaluate(`document.querySelector('#action-dialog-message').textContent.includes('27')`))
  await closeDialog(true)
  await wait('backupTest.imports.length === 1'); assert.equal(await evaluate('window.featureHarness.store.profile.userId'), 7)
  assert.equal(await evaluate('backupTest.imports[0].includeCache'), false)
  await evaluate(`backupTest.sensitive = true`)
  await click(toggle(1)); await click(toggle(2)); await click(importButton); await waitDialog(); await closeDialog(true)
  await wait('backupTest.imports.length === 2'); assert.equal(await evaluate('backupTest.imports[1].includePrivacy'), false)
  assert.equal(await evaluate('backupTest.imports[1].includeCache'), true)
  assert.equal(await evaluate('window.featureHarness.store.profile.userId'), 7)
  // Schedule an old-account Home read to finish after restoring the new account.
  await evaluate(`(async()=>{const {vutronPlugin:api}=await import('/tests/fixtures/personal-ui-native.mock.js');
    const store=window.featureHarness.store, data=owner=>({banners:[],playlists:[{id:owner,name:'Home '+owner}],artists:[],albums:[],charts:[],dailyTracks:[]});
    api.getHomeData=()=>backupTest.owner===7?new Promise(done=>{backupTest.late=()=>done(data(7))}):Promise.resolve(data(27));
    void store.loadHomeData();store.searchResults=[{id:7,name:'Previous private search'}];backupTest.startReads=backupTest.sourceReads;
  })()`)
  await wait('Boolean(backupTest.late)')
  await click(toggle(1)); await click(toggle(2)); await click(importButton); await waitDialog()
  assert.ok(await evaluate(`document.querySelector('#action-dialog-message').textContent.includes('替换本机对应账号')`))
  await closeDialog(true)
  await wait('window.featureHarness.store.profile?.userId===27 && window.featureHarness.store.playlists[0]?.id===27 && backupTest.sourceReads>backupTest.startReads')
  await evaluate('backupTest.late()'); await delay(100)
  assert.equal(await evaluate('window.featureHarness.store.homeData.playlists[0].id'),27)
  assert.equal(await evaluate('window.featureHarness.store.searchResults.length'),0)
  assert.equal(await evaluate('window.featureHarness.store.activeTab'),'settings')
  assert.ok(await evaluate(`document.querySelector('${section} [role=status]').textContent.includes('已恢复 2 个账号')`))
  assert.ok(await evaluate(`document.querySelector('${section} [role=status]').textContent.includes('部分缓存未能写入')`))
  await page.send('Emulation.setDeviceMetricsOverride',{width:320,height:720,deviceScaleFactor:1,mobile:true})
  await evaluate(`(async()=>{const a=await import('/src/platform/interfacePreferences.ts');a.fontScale.value=150})()`)
  for (const locale of ['en','zht']) {
    await evaluate(`(async()=>{(await import('/src/platform/i18n.ts')).setAppLocale('${locale}')})()`)
    await click(exportButton); await waitDialog()
    assert.ok(await evaluate(`document.querySelector('.action-dialog').getBoundingClientRect().right<=innerWidth`))
    await closeDialog(true)
    assert.equal(await evaluate('backupTest.exports.at(-1).language'),locale)
  }
  console.log('Backup UI passed: JSON/ZIP consent and cancellation, opt-out, legacy import, account/plugin refresh, stale response, and narrow translated dialogs')
}
