const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

async function main() {
  const app = path.resolve(__dirname, '..')
  const output = path.resolve(app, '../../_analysis/frontend-audit-2026-11-15/app')
  fs.mkdirSync(output, { recursive: true })
  const { createServer } = await import('vite')
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module">
    import { createApp } from 'vue'; import { createPinia } from 'pinia'; import { Capacitor } from '@capacitor/core';
    import { i18n } from '/src/platform/i18n.ts'; import { useAndroidShellStore } from '/src/stores/androidShell.ts';
    import '/src/style.css'; import '/src/adaptive.css'; import '/src/platform/appearance.ts';
    Capacitor.isNativePlatform=()=>true;
    const {default:App}=await import('/src/App.vue'); const pinia=createPinia(); const instance=createApp(App).use(pinia).use(i18n);
    window.auditApp=instance;window.auditStore=useAndroidShellStore(pinia);instance.mount('#app');window.auditMounted=true;
  </script></body></html>`
  const nativeModule = `
    import {vutronPlugin as base} from '/tests/visual/native.mock.js';
    const calls=window.auditCalls={checks:0,listeners:0,removed:0};
    const query=new URL(location.href).searchParams;
    export const vutronPlugin={...base,
      async getSession(){return {loggedIn:false}},
      async getLocalOnly(){return {enabled:true,manual:false,connected:true}},
      async getAppUpdateState(){return {status:'idle',autoCheck:false,currentVersion:'0.4.10',comparisonVersion:'1.2.1'}},
      async getLibraryTaskState(){if(query.has('hold'))await new Promise(resolve=>window.releaseLibrary=resolve);return {kind:'',running:false,done:0,total:0}},
      async addListener(){calls.listeners++;return {async remove(){calls.removed++}}},
      async createQrLogin(){return {key:'audit-key',imageData:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',url:'https://example.invalid/qr'}},
      async checkQrLogin(){calls.checks++;return {code:801,loggedIn:false}},
      async cancelQrLogin(){},async setLocalOnly(value){return {...value,connected:true}}
    };
  `
  const appModule = `export const App={async addListener(){window.auditCalls.listeners++;return {async remove(){window.auditCalls.removed++}}}};`
  const server = await createServer({ root: app, logLevel: 'error', server: { host:'127.0.0.1', port:0 }, plugins:[{
    name:'frontend-lifecycle-audit',enforce:'pre',
    resolveId(id){if(id==='virtual:audit-native'||id==='@capacitor/app')return '\0'+id},
    load(id){if(id==='\0virtual:audit-native')return nativeModule;if(id==='\0@capacitor/app')return appModule},
    transform(code,id){const file=id.replaceAll('\\','/');if(file.endsWith('/src/platform/vutronPlugin.ts'))return "export {vutronPlugin} from 'virtual:audit-native'"},
    configureServer(vite){vite.middlewares.use(async(request,response,next)=>{if(request.url.startsWith('/__frontend_audit.html')){try{response.setHeader('content-type','text/html');response.end(await vite.transformIndexHtml(request.url,html))}catch(error){next(error)}}else next()})}
  }] })
  let browser,page
  const errors=[]
  try {
    await server.listen();browser=await chromium.launch({headless:true})
    page=await browser.newPage({viewport:{width:360,height:800}})
    page.on('pageerror',error=>errors.push(error.message))
    await page.addInitScript(()=>{localStorage.setItem('vutron:language','zh');localStorage.setItem('vutron:motion-preference','reduced')})
    const url=server.resolvedUrls.local[0]+'__frontend_audit.html'
    await page.goto(url);await page.waitForFunction(()=>window.auditMounted&&window.auditStore.hasAccess)
    await page.evaluate(()=>window.auditStore.requestLogin())
    await page.locator('.qr-login-card').waitFor()
    await page.locator('.qr-login-card button').click()
    await page.waitForFunction(()=>window.auditCalls.checks===1)
    await page.evaluate(()=>{
      window.auditVisibility='hidden';Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.auditVisibility});
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.auditVisibility==='hidden'});document.dispatchEvent(new Event('visibilitychange'))
    })
    const hiddenStart=await page.evaluate(()=>window.auditCalls.checks)
    await page.waitForTimeout(2450)
    assert.equal(await page.evaluate(()=>window.auditCalls.checks),hiddenStart,'Native QR polling stops in the background')
    await page.evaluate(()=>{window.auditVisibility='visible';document.dispatchEvent(new Event('visibilitychange'))})
    await page.waitForFunction(count=>window.auditCalls.checks===count+1,hiddenStart)
    await page.evaluate(()=>window.auditApp.unmount())
    const stopped=await page.evaluate(()=>window.auditCalls.checks)
    await page.waitForTimeout(2300)
    assert.equal(await page.evaluate(()=>window.auditCalls.checks),stopped,'No polling resumes after unmount')
    await page.goto(url+'?hold=1');await page.waitForFunction(()=>window.releaseLibrary&&window.auditMounted)
    await page.evaluate(()=>{window.auditApp.unmount();window.releaseLibrary()})
    await page.waitForTimeout(80)
    const listeners=await page.evaluate(()=>window.auditCalls)
    assert.equal(listeners.listeners,listeners.removed,'Unmount during initialization releases registered listeners and does not continue startup')
    assert.deepEqual(errors,[])
    const result={passed:true,browser:browser.version(),nativeQrPolling:{firstPoll:true,backgroundNewRequests:0,resumePoll:true,afterUnmountNewRequests:0},lateInitialization:listeners,pageErrors:errors,scope:'Real App in browser with synthetic native bridge; no device or live-account claim'}
    fs.writeFileSync(path.join(output,'lifecycle-results.json'),JSON.stringify(result,null,2));console.log('PASS: App QR background/resume/unmount and late initialization lifecycle')
  } catch(error) {
    if(page)console.error(JSON.stringify({errors,body:await page.locator('body').innerText().catch(()=>''),calls:await page.evaluate(()=>window.auditCalls).catch(()=>undefined)}))
    throw error
  } finally { await browser?.close();await server.close() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
