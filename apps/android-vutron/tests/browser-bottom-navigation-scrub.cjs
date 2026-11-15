const assert=require('node:assert/strict'),{chromium}=require('@playwright/test')
async function main(){
 const browser=await chromium.launch({headless:true}),errors=[]
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),cdp=await page.context().newCDPSession(page)
  page.on('pageerror',error=>errors.push(error.message));await page.goto(new URL('tests/fixtures/bottom-navigation-scrub.html',process.env.VUTRON_FIXTURE_URL||'http://127.0.0.1:5173/').href);await page.waitForFunction(()=>window.scrubReady)
  const geometry=()=>page.locator('.scrub-nav>button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,width:r.width}}))
  const touch=(type,points=[])=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points})
  let g=await geometry();await page.locator('[data-tab=library]').tap();assert.equal(await page.locator('#current').innerText(),'library');assert.equal(await page.evaluate(()=>window.scrubHarness.clicks.length),1)
  await touch('touchStart',[{x:g[1].x,y:g[1].y}]);await touch('touchMove',[{x:(g[2].x+g[3].x)/2-3,y:g[1].y}]);await page.waitForFunction(()=>window.scrubHarness.scrub.dragging.value)
  const indicator=await page.locator('.scrub-indicator').boundingBox();assert.ok(indicator.x>g[2].left&&indicator.x<g[3].left,'Selection follows the finger between buttons');assert.equal(await page.evaluate(()=>window.scrubHarness.calls.length),1)
  await touch('touchMove',[{x:g[3].x,y:g[3].y}]);await touch('touchEnd');await page.waitForFunction(()=>window.scrubHarness.current.value==='player');await page.waitForTimeout(80)
  assert.equal(await page.evaluate(()=>window.scrubHarness.calls.length),2);assert.equal(await page.evaluate(()=>window.scrubHarness.clicks.length),1,'A scrub does not also click the start or end button')
  await page.locator('[data-tab=search]').tap();assert.equal(await page.evaluate(()=>window.scrubHarness.clicks.length),2,'The next intentional tap is preserved')
  const before=await page.evaluate(()=>window.scrubHarness.calls.length);g=await geometry()
  await touch('touchStart',[{x:g[2].x,y:g[2].y}]);await touch('touchMove',[{x:g[2].x+3,y:g[2].y-55}]);await touch('touchEnd');await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>window.scrubHarness.calls.length),before)
  await touch('touchStart',[{x:g[2].x,y:g[2].y}]);await touch('touchMove',[{x:g[3].x,y:g[2].y}]);await touch('touchCancel');assert.equal(await page.evaluate(()=>window.scrubHarness.scrub.dragging.value),false);assert.equal(await page.evaluate(()=>window.scrubHarness.calls.length),before)
  await touch('touchStart',[{id:0,x:g[2].x,y:g[2].y}]);await touch('touchMove',[{id:0,x:g[3].x,y:g[2].y}]);await touch('touchStart',[{id:0,x:g[3].x,y:g[2].y},{id:1,x:g[1].x,y:g[1].y}]);await touch('touchEnd');await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>window.scrubHarness.calls.length),before)
  await page.locator('[data-tab=home]').tap();const atHome=await page.evaluate(()=>window.scrubHarness.calls.length)
  await touch('touchStart',[{x:g[0].x,y:g[0].y}]);await touch('touchMove',[{x:1,y:g[0].y}]);await touch('touchEnd');assert.equal(await page.evaluate(()=>window.scrubHarness.calls.length),atHome,'Dragging beyond the first item never wraps')
  for(const motion of ['full','system','reduced']){await page.evaluate(motion=>document.documentElement.dataset.motion=motion,motion);await touch('touchStart',[{x:g[0].x,y:g[0].y}]);await touch('touchMove',[{x:g[1].x,y:g[0].y}]);assert.equal(await page.locator('.scrub-indicator').evaluate(n=>getComputedStyle(n).transitionDuration),'0s');await touch('touchCancel')}
  await touch('touchStart',[{x:g[0].x,y:g[0].y}]);await touch('touchMove',[{x:g[1].x,y:g[0].y}]);await page.evaluate(()=>window.scrubHarness.unmount());await touch('touchEnd');assert.equal(await page.locator('.scrub-nav').count(),0)
  assert.deepEqual(errors,[]);console.log('PASS: actual touch whole-nav scrub, continuous indicator, single release navigation/no trailing click, subsequent tap, vertical/multitouch/cancel/edge and motion/unmount cleanup')
 }finally{await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
