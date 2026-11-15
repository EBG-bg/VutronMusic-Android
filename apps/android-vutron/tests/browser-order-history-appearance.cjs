const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {chromium}=require('@playwright/test')
;(async()=>{
 const app=path.resolve(__dirname,'..'),out=path.resolve(app,'../../_analysis/playlist-sort-2026-11-15');fs.mkdirSync(out,{recursive:true})
 const{createServer}=await import('vite');const server=await createServer({root:app,optimizeDeps:{entries:['tests/fixtures/order-history-appearance.html']},server:{host:'127.0.0.1',port:0},logLevel:'error'})
 let browser
 try{
  await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:360,height:800},deviceScaleFactor:1,colorScheme:'dark'})
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.addInitScript(()=>{localStorage.setItem('vutron:appearance','dark');localStorage.setItem('vutron:language','zht');localStorage.setItem('vutron:motion-preference','full')})
  await page.route(/^https?:\/\//,route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
  await page.goto(server.resolvedUrls.local[0]+'tests/fixtures/order-history-appearance.html');await page.locator('.history-entry').first().waitFor();await page.waitForTimeout(450)
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');assert.equal(await page.locator('html').getAttribute('lang'),'zh-TW')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.screenshot({path:path.join(out,'order-history-dark-zht.png')})
  await page.locator('.history-recent').click();await page.locator('.history-preview-list li').first().waitFor();await page.waitForTimeout(600)
  assert.deepEqual(await page.locator('.history-preview-list li b').allTextContents(),['Morning rain','Boreal lights','Evening colours'])
  assert.equal(await page.evaluate(()=>document.querySelector('.history-preview-list li').getBoundingClientRect().top<innerHeight-30),true)
  assert.deepEqual(await page.evaluate(()=>window.historyAppearance.loaded),[])
  await page.screenshot({path:path.join(out,'order-preview-dark-zht.png')})
  assert.deepEqual(errors,[])
  console.log('PASS: actual history sheet, dark Traditional Chinese 150%, initial tracks visible, preview order and no implicit apply')
 }finally{await browser?.close();await server.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
