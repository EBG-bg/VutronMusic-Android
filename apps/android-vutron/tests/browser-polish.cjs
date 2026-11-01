const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
module.exports = async ({page,evaluate,wait,delay,root}) => {
  await page.send('Page.bringToFront')
  const navigate = async tab => { await evaluate('window.featureHarness.store.navigateTo('+JSON.stringify(tab)+')'); await wait('Boolean(document.querySelector('+JSON.stringify({library:'.playlist-library',settings:'[data-settings-section=app-update]',about:'[data-settings-section=about-privacy]'}[tab])+'))'); await delay(100) }
  await navigate('library')
  await evaluate('document.body.style.setProperty("overflow","auto","important");document.documentElement.style.setProperty("overscroll-behavior","contain")')
  await evaluate('document.querySelector(".playlist-sort .app-select-trigger").click()')
  await wait('Boolean(document.querySelector(".app-select-panel"))')
  await delay(220)
  const position = await evaluate('scrollY')
  assert.equal(await evaluate('getComputedStyle(document.body).overflow'),'hidden')
  await page.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:10,y:180,deltaY:500,deltaX:0})
  await delay(120); assert.equal(await evaluate('scrollY'),position,'Backdrop wheel cannot scroll the library')
  await page.send('Emulation.setDeviceMetricsOverride',{width:740,height:300,deviceScaleFactor:1,mobile:true}); await delay(100)
  assert.equal(await evaluate('(()=>{const r=document.querySelector(".app-select-panel").getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()'),true,'Short landscape picker stays within the viewport')
  await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await wait('!document.querySelector(".app-select-panel")')
  assert.equal(await evaluate('document.body.style.getPropertyValue("overflow")'),'auto')
  assert.equal(await evaluate('document.body.style.getPropertyPriority("overflow")'),'important')
  assert.equal(await evaluate('document.documentElement.style.getPropertyValue("overscroll-behavior")'),'contain')
  await evaluate('document.body.style.removeProperty("overflow");document.documentElement.style.removeProperty("overscroll-behavior")')
  await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})

  await navigate('settings')
  await wait('Boolean(document.querySelector("[data-settings-section=app-update]"))')
  await evaluate('(async()=>{const u=await import("/src/platform/appUpdates.ts");Object.assign(u.appUpdateState,{currentVersion:"0.4.2",comparisonVersion:"1.1.0",latestVersion:"1.1.0",status:"upToDate",installAllowed:false})})()')
  await evaluate('(()=>{const e=document.querySelector("[data-settings-section=app-update]");if(!e.open)e.querySelector("summary").click();e.scrollIntoView({block:"center"})})()')
  await wait('Boolean(document.querySelector(".update-versions"))')
  assert.match(await evaluate('document.querySelector(".update-versions").innerText'),/0\.4\.2[\s\S]*1\.1\.0[\s\S]*1\.1\.0/)
  assert.doesNotMatch(await evaluate('document.querySelector(".update-status").innerText'),/当前已是最新版本/)
  await evaluate('(async()=>{(await import("/src/platform/interfacePreferences.ts")).fontScale.value=150;window.featureHarness.store.navigateTo("about")})()'); await delay(450)
  await wait('Boolean(document.querySelector("[data-settings-section=about-privacy]"))')
  await evaluate('document.querySelector("[data-settings-section=about-privacy] summary").click()')
  await wait('Boolean(document.querySelector(".about-document"))')
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".about-document")).fontSize'),'18px','Legal text follows the chosen UI font scale')
  await evaluate('(async()=>{(await import("/src/platform/interfacePreferences.ts")).fontScale.value=100})()')

  await navigate('library')
  await evaluate('window.featureHarness.store.error="java.net.UnknownHostException: test-network.example"')
  await wait('Boolean(document.querySelector(".app-error-notice"))')
  assert.match(await evaluate('document.querySelector(".app-error-notice").innerText'),/暂时无法连接服务/)
  assert.equal(await evaluate('document.querySelector(".app-error-notice details").open'),false)
  for (const language of ['en','zht','zh']) {
    await evaluate('(async()=>{(await import("/src/platform/i18n.ts")).setAppLocale('+JSON.stringify(language)+')})()'); await delay(50)
    assert.doesNotMatch(await evaluate('document.querySelector(".app-error-notice").innerText'),/mobile\.errorNotice\./)
  }
  await evaluate('document.querySelector(".app-error-notice details summary").click()')
  assert.match(await evaluate('document.querySelector(".app-error-notice code").textContent'),/UnknownHostException/)
  await evaluate('document.querySelector(".app-error-notice header button").click()'); await wait('!document.querySelector(".app-error-notice")')
  await evaluate('window.featureHarness.store.error="登录会话过期"'); await wait('Boolean(document.querySelector(".app-error-notice"))')
  assert.match(await evaluate('document.querySelector(".error-actions").innerText'),/登录/)
  assert.doesNotMatch(await evaluate('document.querySelector(".error-actions").innerText'),/重新加载/,'Auth recovery does not repeat a request')
  await evaluate('window.featureHarness.store.error=""')

  // Synthetic metadata only: no real account, audio or network requests.
  await page.send('Performance.enable')
  await evaluate('(()=>{const s=window.featureHarness.store;s.selectedLocalCollection={id:"folder:performance",name:"Synthetic library",trackCount:5000};s.tracks=Array.from({length:5000},(_,i)=>({id:i+1,name:"Track "+String(i).padStart(4,"0"),artists:["Artist "+(i%100)],album:"Album "+(i%50),localUri:"content://test/"+i,localKey:String(i)}));s.activeTab="localCollection"})()')
  await wait('document.querySelectorAll(".local-track-section .track-row").length===80')
  const measurements=[]
  for (const count of [80,800,2000]) {
    const start=performance.now()
    if(count>80) await evaluate('(async()=>{while(document.querySelectorAll(".local-track-section .track-row").length<'+count+'){document.querySelector(".local-track-section .track-list-pager").click();await new Promise(resolve=>setTimeout(resolve,0))}await new Promise(requestAnimationFrame)})()')
    const dom=await page.send('Memory.getDOMCounters'),heap=await page.send('Runtime.getHeapUsage')
    measurements.push({rendered:count,appendWallMs:Math.round(performance.now()-start),nodes:dom.nodes,jsHeapBytes:heap.usedSize})
  }
  const report={environment:'Desktop Edge headless, synthetic 5000-track library; not Android RAM, frame-rate or power measurements',samples:measurements,fullQueueLength:await evaluate('window.featureHarness.store.tracks.length')}
  assert.equal(report.fullQueueLength,5000)
  await evaluate('('+(() => {
    const s=window.featureHarness.store
    s.playlists=Array.from({length:600},(_,i)=>({id:i+10000,name:'Cover '+i,trackCount:10,creatorUserId:7,coverImgUrl:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="hsl('+(i%360)+',60%,50%)"/></svg>')}))
    s.tracks=[];s.selectedLocalCollection=undefined;s.activeTab='library'
  }).toString()+')()')
  await wait('document.querySelectorAll(".playlist-library .playlist-card").length===80'); await delay(200)
  await wait('document.querySelectorAll(".playlist-grid img[data-artwork-state=loaded]").length>0')
  report.artwork={renderedCards:80,loadedArtwork:await evaluate('document.querySelectorAll(".playlist-grid img[data-artwork-state=loaded]").length'),heapBytes:(await page.send('Runtime.getHeapUsage')).usedSize}
  assert.ok(report.artwork.loadedArtwork<80,'Offscreen artwork stays lazy instead of loading every cover')
  fs.writeFileSync(path.join(root,'library-performance-0.4.2.json'),JSON.stringify(report,null,2)+'\n')
  console.log('PASS: scroll lock and restore, short landscape, update baseline, scaled legal text, multilingual errors and safe recovery; performance='+JSON.stringify(report))
}
