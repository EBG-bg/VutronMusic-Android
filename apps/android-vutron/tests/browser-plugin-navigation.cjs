const assert=require('node:assert/strict'),{chromium}=require('@playwright/test')
async function main(){
 const browser=await chromium.launch({executablePath:process.env.EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true}),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/src/plugins/bridge.ts*',route=>route.fulfill({contentType:'text/javascript',body:"export { musicPluginBridge } from '/tests/fixtures/music-plugin-native.mock.js'"}))
  await page.goto((process.argv[2]||'http://127.0.0.1:5173')+'/tests/fixtures/plugin-navigation.html')
  await page.waitForSelector('.plugin-result-card')
  const session=await page.context().newCDPSession(page)
  const selected=()=>page.locator('.plugin-feature-tabs button[aria-pressed=true]').textContent()
  async function drag(selector,dx,inspect){
   const target=page.locator(selector).first();await target.scrollIntoViewIfNeeded();const box=await target.boundingBox(),from={x:Math.min(320,box.x+box.width*.75),y:box.y+box.height/2}
   await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,...from}]})
   for(let step=1;step<=5;step++){await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:from.x+dx*step/5,y:from.y}]});await page.waitForTimeout(18)}
   if(inspect)await inspect()
   await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(250)
  }
  await page.locator('.plugin-feature-tabs button').filter({hasText:'全部歌曲'}).click();await page.waitForSelector('.plugin-track')
  const before=await selected(),plays=await page.evaluate(()=>window.pluginNavigation.plays.length)
  await drag('.plugin-track-play',-130,async()=>{
   assert.equal(await page.locator('.plugin-feature-tabs').getAttribute('data-swiping'),'')
   const offset=await page.locator('.plugin-swipe-results').evaluate(element=>parseFloat(getComputedStyle(element).translate))
   assert.ok(offset < -50,'Only plugin results follow the finger')
   assert.equal(await page.locator('.plugin-library-page').evaluate(element=>getComputedStyle(element).translate),'none','The modal host remains untransformed')
  })
  assert.notEqual(await selected(),before);assert.equal(await page.evaluate(()=>window.pluginNavigation.plays.length),plays,'Trailing click cannot play a song')
  await page.locator('.plugin-feature-tabs button').first().click();await page.waitForSelector('.plugin-result-card')
  const atShelf=await selected();await drag('.plugin-result-card',-110);assert.equal(await selected(),atShelf,'A real horizontal shelf keeps its gesture')
  await page.locator('.plugin-result-card').first().click();await page.waitForSelector('.plugin-detail');const requests=await page.evaluate(()=>window.pluginNavigation.backend.calls.length)
  await drag('.plugin-track-play',-130);assert.equal(await page.locator('.plugin-detail').count(),1);assert.equal(await page.evaluate(()=>window.pluginNavigation.backend.calls.length),requests,'Playlist detail cannot start a root feature swipe')
  await page.evaluate(()=>{window.pluginNavigation.section.value='search'});await page.waitForSelector('.plugin-search-tabs');await page.waitForTimeout(150)
  const searchRequests=await page.evaluate(()=>window.pluginNavigation.backend.calls.filter(row=>row.method==='search').length)
  await drag('.plugin-results-heading',-130)
  assert.equal(await page.locator('.plugin-search-tabs button[aria-pressed=true]').textContent(),'歌单')
  assert.equal(await page.evaluate(()=>window.pluginNavigation.backend.calls.filter(row=>row.method==='search').length),searchRequests,'Swipe retains category-click semantics without an extra search')
  await page.locator('.plugin-search-tabs button').first().click();await drag('.plugin-results-heading',120)
  assert.equal(await page.locator('.plugin-search-tabs button[aria-pressed=true]').textContent(),'歌曲','Outer category boundary does not escape to a main tab')
  assert.deepEqual(errors,[])
  console.log('PASS: integrated plugin local feature/search swipes, fractional indicator and results-only movement; no trailing play or extra search; shelf/detail priority and boundary resistance')
 }finally{await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
