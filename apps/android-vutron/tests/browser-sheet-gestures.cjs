const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
module.exports=async({page,evaluate,wait,delay,root})=>{
  await page.send('Page.bringToFront')
  await page.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1})
  await evaluate('window.featureHarness.store.navigateTo("player")')
  await wait('Boolean(document.querySelector(".playback-mode-control"))');await delay(420)
  const images=[]
  for(let mode=0;mode<3;mode++){
    if(mode){await evaluate('document.querySelector(".playback-mode-control").click()');await wait('window.featureHarness.store.playback.mode==='+mode)}
    const loaded=await evaluate('(async()=>{const icon=document.querySelector(".playback-mode-control .original-icon"),src=icon.style.getPropertyValue("--original-icon").match(/url\\("(.*)"\\)/)[1],image=new Image();image.src=src;await image.decode();const c=document.createElement("canvas");c.width=24;c.height=24;const ctx=c.getContext("2d");ctx.drawImage(image,0,0,24,24);const pixels=ctx.getImageData(0,0,24,24).data;return {src,opaque:Array.from(pixels).filter((v,i)=>i%4===3&&v>0).length,png:c.toDataURL()}})()')
    assert.ok(loaded.opaque>40,'Playback mode '+mode+' contains actual drawable pixels')
    images.push(loaded.png)
  }
  assert.equal(new Set(images).size,3,'Every playback mode has a distinct drawing')
  const preview=await evaluate('(async()=>{const sources='+JSON.stringify(images)+',c=document.createElement("canvas");c.width=360;c.height=96;const ctx=c.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,360,96);for(let i=0;i<3;i++){const image=new Image();image.src=sources[i];await image.decode();ctx.drawImage(image,i*120+43,12,34,34);ctx.font="13px sans-serif";ctx.fillStyle="#222";ctx.textAlign="center";ctx.fillText(["列表循环","单曲循环","随机播放"][i],i*120+60,75)}return c.toDataURL()})()')
  fs.writeFileSync(path.join(root,'playback-icons.png'),Buffer.from(preview.split(',')[1],'base64'))

  const swipe=async(selector,dy,{part='handle',cancel=false,dx=0}={})=>{
    await evaluate('document.querySelector('+JSON.stringify(selector)+').scrollTop=0');await delay(40)
    const target=part==='handle'?selector+' .sheet-drag-handle':part==='header'?selector+' header':selector+' .track-action-options button:first-child'
    const g=await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(target)+'),r=e.getBoundingClientRect();return {x:r.left+r.width*.42,y:r.top+r.height/2}})()')
    await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[g]})
    await page.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:g.x+dx,y:g.y+dy}]});await delay(35)
    const dragging=await evaluate('document.querySelector('+JSON.stringify(selector)+')?.hasAttribute("data-sheet-dragging")')
    await page.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]})
    return dragging
  }
  const openMenu=async()=>{
    await evaluate('(()=>{const e=document.querySelector(".player-page .track-menu-button");e.focus();e.click()})()')
    await wait('Boolean(document.querySelector(".track-action-menu"))');await delay(380)
  }
  await openMenu()
  assert.equal(await swipe('.track-action-menu',22),true)
  await delay(230)
  assert.equal(await evaluate('Boolean(document.querySelector(".track-action-menu"))'),true,'A short pull springs back')
  assert.equal(await evaluate('document.querySelector(".track-action-menu").style.transform'),'')
  await swipe('.track-action-menu',100,{cancel:true});await delay(220)
  assert.equal(await evaluate('Boolean(document.querySelector(".track-action-menu"))'),true,'Cancelled gestures keep the menu')
  const commentsBefore=await evaluate('window.featureHarness.backend.counts.comments||0')
  await swipe('.track-action-menu',145,{part:'body'})
  await wait('!document.querySelector(".track-action-menu")')
  assert.equal(await evaluate('Boolean(document.querySelector(".comments-sheet"))'),false,'A downward drag on an action never clicks it')
  assert.equal(await evaluate('window.featureHarness.backend.counts.comments||0'),commentsBefore)
  assert.equal(await evaluate('document.activeElement===document.querySelector(".player-page .track-menu-button")'),true,'Focus returns to the song menu trigger')

  await evaluate('window.featureHarness.store.queueOpen=true')
  await wait('Boolean(document.querySelector(".queue-panel"))');await delay(380)
  await swipe('.queue-panel',145)
  await wait('!document.querySelector(".queue-panel")')
  assert.equal(await evaluate('window.featureHarness.store.queueOpen'),false)
  assert.equal(await evaluate('document.querySelector(".app-shell").inert'),false)

  await evaluate('document.querySelector(".playback-tuning-button").click()')
  await wait('Boolean(document.querySelector(".tuning-sheet"))');await delay(380)
  // Value controls keep their own drag path and must not move the sheet.
  const point=await evaluate('(()=>{const e=document.querySelector(".tuning-sheet .thumb-range-thumb"),r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()')
  await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]})
  await page.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+20,y:point.y+100}]});await delay(30)
  await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(100)
  assert.equal(await evaluate('Boolean(document.querySelector(".tuning-sheet"))'),true,'Dragging a value slider cannot dismiss its sheet')
  assert.equal(await evaluate('document.querySelector(".tuning-sheet").hasAttribute("data-sheet-dragging")'),false)
  await swipe('.tuning-sheet',145,{part:'header'})
  await wait('!document.querySelector(".tuning-sheet")')

  await evaluate('Array.from(document.querySelectorAll(".player-page button")).find(e=>e.textContent.includes("歌曲评论")).click()')
  await wait('Boolean(document.querySelector(".comment-row"))');await delay(380)
  // Scrollable content gets priority until it has returned to the top.
  await evaluate('(()=>{const e=document.querySelector(".comments-sheet");for(let i=0;i<15;i++){const p=document.createElement("p");p.className="gesture-spacer";p.style.height="50px";p.textContent="Scroll fixture";e.append(p)}e.scrollTop=100})()')
  const scrollPoint=await evaluate('(()=>{const e=document.querySelector(".comments-sheet"),r=e.getBoundingClientRect();return {x:r.left+r.width*.8,y:r.top+220}})()')
  await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[scrollPoint]})
  await page.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:scrollPoint.x,y:scrollPoint.y+95}]});await delay(40)
  await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(100)
  assert.equal(await evaluate('Boolean(document.querySelector(".comments-sheet"))'),true,'Scrolling a comment thread does not close it')
  await evaluate('document.querySelectorAll(".gesture-spacer").forEach(e=>e.remove());document.querySelector(".comments-sheet").scrollTop=0')
  await swipe('.comments-sheet',145)
  await wait('!document.querySelector(".comments-sheet")')

  await evaluate('(async()=>{(await import("/src/platform/motion.ts")).motionPreference.value="reduced"})()')
  await openMenu();await swipe('.track-action-menu',145)
  await wait('!document.querySelector(".track-action-menu")')
  assert.equal(await evaluate('document.querySelector(".app-shell").inert'),false)
  console.log('PASS: three drawable playback icons, short/cancelled pull recovery, drag-on-action suppression, song menu/queue/tuning/comments dismissal, value sliders and scrolled content preserved, reduced motion and focus restoration')
}
