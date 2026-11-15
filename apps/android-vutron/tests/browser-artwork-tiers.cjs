const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('@playwright/test');
(async()=>{
 const app=path.resolve(__dirname,'..'),out=path.resolve(app,'../../_analysis/personal-0.4.14');fs.mkdirSync(out,{recursive:true});
 const {createServer}=await import('vite');
 const server=await createServer({root:app,plugins:[{name:'artwork-native-fixture',enforce:'pre',transform(code,id){
  const name=id.replaceAll('\\','/');
  if(name.endsWith('/src/platform/vutronPlugin.ts'))return "export {vutronPlugin} from '/tests/fixtures/artwork-tiers.mock.js'";
  if(name.endsWith('/src/plugins/bridge.ts'))return "export {musicPluginBridge} from '/tests/fixtures/artwork-tiers.mock.js'";
  if(name.endsWith('/src/platform/artwork.ts'))return code.replace("import { Capacitor } from '@capacitor/core'","const Capacitor={isNativePlatform:()=>true,convertFileSrc:value=>location.origin+'/_capacitor_file_/'+encodeURIComponent(value)}");
 } }],optimizeDeps:{entries:['tests/fixtures/artwork-tiers.html']},server:{host:'127.0.0.1',port:0},logLevel:'error'});
 let browser;
 try{
  await server.listen();browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:900,height:800},deviceScaleFactor:3});const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:\/\//,route=>{
   const url=new URL(route.request().url());
   if(url.pathname.startsWith('/_capacitor_file_/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><rect width="100%" height="100%" fill="#29aaa5"/></svg>'});
   return url.hostname==='127.0.0.1'?route.continue():route.abort();
  });
  await page.goto(server.resolvedUrls.local[0]+'tests/fixtures/artwork-tiers.html');
  await page.waitForFunction(()=>Object.entries({small:192,duplicate:192,card:512,player:512,plugin:192,cached:192,avatar:192}).every(([id,width])=>document.querySelector('#'+id+' img')?.naturalWidth===width));
  const initial=await page.evaluate(()=>({images:Object.fromEntries(['small','duplicate','card','player','plugin','cached','avatar'].map(id=>[id,document.querySelector('#'+id+' img').naturalWidth])),calls:window.artworkTiers.calls.slice()}));
  assert.deepEqual(initial.images,{small:192,duplicate:192,card:512,player:512,plugin:192,cached:192,avatar:192});
  assert.equal(initial.calls.filter(c=>c.kind==='native'&&c.url.includes('/sample.jpg')&&c.size===192).length,1,'Equal-size concurrent images share one native request');
  assert.equal(initial.calls.filter(c=>c.kind==='plugin').length,1,'Plugin images resolve once');
  assert.ok(initial.calls.filter(c=>c.kind==='native').every(c=>!c.url.includes('imge.kugou.com')),'Prepared plugin image avoids a second cover bridge request');
  assert.ok(initial.calls.some(c=>c.localUri?.includes('artwork-cache-v1')&&c.size===192),'Old cached full cover is supplied for local derivation');
  await page.evaluate(()=>window.artworkTiers.state.compact=true);
  await page.waitForFunction(()=>document.querySelector('#switch img').naturalWidth===192);
  assert.equal(await page.locator('#player img').evaluate(e=>e.naturalWidth),512,'Shrinking a list does not downgrade the player');
  await page.screenshot({path:path.join(out,'artwork-tiers.png')});
  await page.evaluate(()=>{window.artworkTiers.localOnlyMode.value=true;window.artworkTiers.state.showLocalPlugin=true});
  await page.waitForFunction(()=>['plugin-file','plugin-content'].every(id=>document.querySelector('#'+id+' img')?.naturalWidth===192));
  const local=await page.evaluate(()=>({calls:window.artworkTiers.calls.filter(c=>!c.url&&c.localUri),images:['plugin-file','plugin-content'].map(id=>({id,src:document.querySelector('#'+id+' img').src,width:document.querySelector('#'+id+' img').naturalWidth}))}));
  assert.equal(local.calls.length,2,'Direct file/content covers each take one native thumbnail request');
  assert.ok(local.calls.every(c=>c.size===192));assert.ok(local.images.every(image=>image.src.includes('/_capacitor_file_/')),'Local native proxy URLs remain visible in local-only mode');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'artwork-tiers-results.json'),JSON.stringify({density:3,initial,compactWidth:192,local,errors},null,2));
  console.log('PASS: display-density tiers, full player, shared requests, cached URI reuse, plugin single resolution, live list-size change, avatar and local-only file/content native proxy covers.');
 }finally{await browser?.close();await server.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
