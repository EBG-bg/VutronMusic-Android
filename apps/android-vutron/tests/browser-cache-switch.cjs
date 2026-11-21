const assert = require('node:assert/strict')

module.exports = async ({ page, evaluate, wait }) => {
  const card = '[data-settings-section="cache"]'
  const selector = `${card} .cache-toggle:nth-of-type(2)`
  const control = `document.querySelector(${JSON.stringify(selector)})`
  await evaluate(`(async()=>{
    const store=window.featureHarness.store
    const {vutronPlugin}=await import('/src/platform/vutronPlugin.ts')
    const status={capacityMb:2048,usedBytes:0,trackCount:0,enabled:true,libraryAutoCache:true,artworkFull:true}
    window.cacheSwitchWrites=[]
    vutronPlugin.getCacheStatus=async()=>({...status})
    vutronPlugin.setLibraryAutoCache=async({enabled})=>{
      window.cacheSwitchWrites.push(enabled)
      if(window.cacheSwitchWrites.length===1)throw new Error('Fixture cache save failed')
      status.libraryAutoCache=enabled;return {...status}
    }
    store.stopPlaybackPolling()
    await store.loadCacheStatus()
    store.navigateTo('settings')
  })()`)
  const summary = `document.querySelector(${JSON.stringify(`${card} > summary`)})`
  await wait(summary)
  await evaluate(`${summary}.click()`)
  await wait(`${control}?.querySelector('input[role=switch]')?.checked`)
  const input = `${control}.querySelector('input[role=switch]')`
  const indicator = `${control}.querySelector('.switch')`
  await evaluate(`${control}.click()`)
  await wait(`window.featureHarness.store.error.includes('Fixture cache save failed')`)
  assert.equal(await evaluate(`${input}.checked`), true, 'The checkbox must still report the saved state after a rejected save')
  assert.equal(await evaluate(`${indicator}.classList.contains('on')`), true)
  await evaluate(`${input}.focus()`)
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
  await wait(`window.featureHarness.store.cacheStatus.libraryAutoCache===false`)
  assert.deepEqual(await evaluate('window.cacheSwitchWrites'), [false, false], 'Keyboard activation retries the same desired value')
  assert.equal(await evaluate(`${input}.checked || ${indicator}.classList.contains('on')`), false)
  const meter = `document.querySelector(${JSON.stringify(`${card} .storage-meter span`)})`
  await evaluate(`(async()=>{
    const store=window.featureHarness.store
    const {vutronPlugin}=await import('/src/platform/vutronPlugin.ts')
    const before={...store.cacheStatus, capacityMb:512, usedBytes:256*1024*1024, trackCount:1}
    const after={...before, usedBytes:0, trackCount:0}
    let cleared=false
    vutronPlugin.getCacheStatus=async()=>cleared?after:before
    vutronPlugin.getCachedTracks=async()=>({ tracks:cleared?[]:[{id:7,name:'Cached demo',cached:true}] })
    vutronPlugin.clearCache=async()=>{cleared=true}
    await store.loadCacheStatus()
    let first=true
    vutronPlugin.getCacheStatus=async()=>{
      if(first){ first=false; return new Promise(resolve=>{window.releaseStaleCache=()=>resolve(before)}) }
      return cleared?after:before
    }
    window.staleCacheRead=store.loadCacheStatus(false,false)
  })()`)
  assert.equal(await evaluate(`${meter}.style.width`), '50%')
  const clearButton = `document.querySelector(${JSON.stringify(`${card} button.danger-text`)})`
  await evaluate(`${clearButton}.click()`)
  await wait(`${meter}.style.width==='0%' && window.featureHarness.store.cachedTracks.length===0`)
  await evaluate('(async()=>{window.releaseStaleCache();await window.staleCacheRead})()')
  assert.equal(await evaluate(`${meter}.style.width`), '0%', 'The prior status report cannot restore the removed usage')
  console.log('PASS: cache switch retry and immediate visible cache-clear refresh while an older read is pending')
}
