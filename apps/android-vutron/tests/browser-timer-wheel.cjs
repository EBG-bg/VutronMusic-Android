const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path')
module.exports=async({page,evaluate,wait,delay,root})=>{
  await page.send('Page.bringToFront')
  await evaluate('window.featureHarness.store.navigateTo("settings")')
  await wait('Boolean(document.querySelector("[data-settings-section=timer]"))')
  await evaluate('(()=>{const e=document.querySelector("[data-settings-section=timer]");if(!e.open)e.querySelector("summary").click()})()')
  await wait('document.querySelectorAll(".arc-wheel-control").length===2');await delay(400)
  const control=part=>`.arc-wheel-control:has(.arc-wheel[aria-label="${part}"])`
  const seconds=control('秒钟'),minutes=control('分钟')
  const value=async selector=>Number(await evaluate('document.querySelector('+JSON.stringify(selector)+').dataset.value'))
  const visual=async selector=>Number(await evaluate('document.querySelector('+JSON.stringify(selector)+').dataset.visualValue'))
  const preset=async n=>{await evaluate('(async()=>{(await import("/src/platform/interfacePreferences.ts")).timerPreset.value='+n+'})()');await delay(260)}
  const total=()=>evaluate('Number(localStorage.getItem("vutron:timer-preset"))')
  const motion=async preference=>{await evaluate('(async()=>{(await import("/src/platform/motion.ts")).motionPreference.value='+JSON.stringify(preference)+'})()');await delay(30)}
  const key=async key=>{const code={ArrowRight:39,ArrowLeft:37,Home:36,End:35}[key];await page.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:code});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:code})}
  const geometry=async(selector,area)=>{
    await evaluate('document.querySelector('+JSON.stringify(selector)+').scrollIntoView({block:"center"})');await delay(70)
    return evaluate('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return {x:r.left+r.width*.45,y:'+JSON.stringify(area)+'==="label"?r.top+18:'+JSON.stringify(area)+'==="bottom"?r.bottom-8:r.top+r.height*.6}})()')
  }
  await motion('full');await page.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1})
  await preset(59)
  await evaluate('window.timerBoundaryTick=document.querySelector('+JSON.stringify(seconds+' [data-tick="60"]')+')')
  const g=await geometry(seconds,'bottom')
  await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[g]})
  await page.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:g.x-36,y:g.y}]});await delay(30)
  assert.equal(await total(),60,'59 seconds carries to 1:00')
  assert.ok(await visual(seconds)>60&&await visual(seconds)<61,'The wheel tracks fractional finger movement')
  assert.equal(await evaluate('window.timerBoundaryTick===document.querySelector('+JSON.stringify(seconds+' [data-tick="60"]')+')'),true,'The 00 tick remains the same DOM element across rollover')
  assert.equal(await evaluate('window.timerBoundaryTick.dataset.label'),'0')
  await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(45)
  assert.ok(await visual(seconds)>60&&await visual(seconds)<60.2,'Release visibly settles onto the chosen tick')
  await delay(230);assert.equal(await visual(seconds),60)
  assert.equal(await evaluate('document.querySelector(".timer-readout").textContent'),'1:00')
  assert.equal(await evaluate('document.querySelector(".wheel-label input[aria-label=分钟]").value'),'1')

  for(const [selector,area,from,expected,dx] of [[seconds,'label',60,59,30],[seconds,'center',119,120,-30],[minutes,'label',60,120,-30],[minutes,'bottom',120,60,30]]){
    await preset(from);const point=await geometry(selector,area)
    await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]})
    await page.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+dx,y:point.y}]});await delay(20)
    await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(240)
    assert.equal(await total(),expected,'Entire '+area+' area adjusts '+selector)
  }
  await preset(119)
  await evaluate('document.querySelector('+JSON.stringify(seconds+' .arc-wheel')+').focus()');await key('ArrowRight');await delay(260)
  assert.equal(await total(),120,'Keyboard carries minutes')
  await key('ArrowLeft');await delay(260);assert.equal(await total(),119,'Keyboard borrows minutes')
  await evaluate('(()=>{const e=document.querySelector(".wheel-label input[aria-label=秒钟]");e.value="60";e.dispatchEvent(new Event("change",{bubbles:true}))})()');await delay(260)
  assert.equal(await total(),120,'Exact numeric entry also normalizes carry')
  await preset(18000);await key('ArrowRight');assert.equal(await total(),18000,'Maximum stays 300 minutes')
  await preset(1);await key('ArrowLeft');assert.equal(await total(),1,'Minimum stays one second')

  await preset(60)
  await evaluate('(async()=>{(await import("/src/platform/interfacePreferences.ts")).timerPreset.value=70})()');await delay(55)
  assert.ok(await visual(seconds)>60&&await visual(seconds)<70,'Full motion animates a numeric change')
  await motion('reduced');assert.equal(await visual(seconds),70,'Reducing motion immediately stops settling')
  await evaluate('(async()=>{(await import("/src/platform/interfacePreferences.ts")).timerPreset.value=71})()')
  assert.equal(await visual(seconds),71)
  await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await motion('system');assert.equal(await evaluate('document.querySelector('+JSON.stringify(seconds)+').dataset.motion'),'reduced')
  await motion('full');assert.equal(await evaluate('document.querySelector('+JSON.stringify(seconds)+').dataset.motion'),'full','Explicit full motion overrides a reduced system preference')
  await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]})

  await preset(59);const vertical=await geometry(seconds,'center'),scrollBefore=await evaluate('scrollY')
  await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[vertical]})
  await page.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:vertical.x,y:vertical.y-70}]});await delay(40)
  await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(120)
  assert.equal(await total(),59,'Vertical page scrolling does not edit time')
  assert.ok(await evaluate('scrollY')>scrollBefore,'Vertical dragging still scrolls the settings page')

  await preset(61)
  await evaluate('document.querySelector("[data-settings-section=timer] .timer-actions button").click()')
  await wait('window.featureHarness.store.sleepTimerRemainingMs>0')
  const samples=[]
  for(let i=0;i<16;i++){samples.push(await value(seconds));await delay(100)}
  assert.ok(samples[0]>60&&samples.at(-1)<60,'Running countdown passes the minute boundary')
  assert.ok(samples.every((n,i)=>i===0||Math.abs(n-samples[i-1])<1),'Seconds never jump by 59 at rollover')
  assert.ok((await visual(seconds))<61&&(await visual(seconds))>58,'Running visual follows the same continuous coordinate')
  await evaluate('document.querySelector("[data-settings-section=timer] .timer-actions button:last-child").click()')
  await wait('window.featureHarness.store.sleepTimerRemainingMs===0')
  await evaluate('window.featureHarness.store.sleepTimerBusy=true')
  assert.equal(await evaluate('document.querySelector('+JSON.stringify(seconds+' input')+').disabled'),true)
  await evaluate('window.featureHarness.store.sleepTimerBusy=false')
  await evaluate('(async()=>{(await import("/src/platform/interfacePreferences.ts")).fontScale.value=150})()')
  for(const [width,height] of [[320,844],[390,844],[740,420]]){
    await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await delay(80)
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Scaled timer fits '+width)
  }
  await evaluate('document.querySelector("[data-settings-section=timer]").scrollIntoView({block:"center"})');await delay(100)
  const shot=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(root,'timer-wheel.png'),Buffer.from(shot.data,'base64'))
  console.log('PASS: seconds carry/borrow, continuous DOM and fractional drag, full-area touch on both wheels, release settling, numeric/keyboard/bounds, all motion preferences, vertical page scroll, running rollover, disabled controls and 150% layout')
}
