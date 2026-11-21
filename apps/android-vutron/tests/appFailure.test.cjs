const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const vue = require('vue'), { parse, compileScript } = require('@vue/compiler-sfc'), { renderToString } = require('@vue/server-renderer')
const { loadMobileI18n } = require('./helpers/i18n.cjs')
function evaluate(source, dependencies = {}) {
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, {
    module, exports: module.exports, require(name) { if (dependencies[name]) return dependencies[name]; throw new Error('Unexpected dependency '+name) }
  })
  return module.exports
}
const failure = evaluate(fs.readFileSync(path.resolve(__dirname, '../src/platform/appFailure.ts'), 'utf8'))

test('known app failures select a specific recovery while unknown errors stay generic', () => {
  for (const [message, kind] of [
    ['目录授权失效，请重新选择文件夹','folders'], ['java.lang.SecurityException: uri permission denied','folders'],
    ['ENOSPC: no space left on device','storage'], ['登录已过期','auth'], ['HTTP 401 unauthorized','auth'],
    ['SocketTimeoutException','timeout'], ['请求超时','timeout'], ['java.net.UnknownHostException','network'],
    ['网络连接失败','network'], ['playlist mutation response ambiguous','unknown']
  ]) assert.equal(failure.describeAppFailure(message).kind, kind, message)
})

test('error explanations and recovery hints resolve in all three languages', () => {
  const f = loadMobileI18n()
  for (const locale of ['zh', 'zht', 'en']) {
    f.setAppLocale(locale)
    for (const message of ['目录权限失效','ENOSPC','请先登录','timeout','network','other']) {
      const d = failure.describeAppFailure(message)
      assert.notEqual(f.translate(d.messageKey),d.messageKey)
      assert.notEqual(f.translate(d.hintKey),d.hintKey)
    }
  }
})
test('native A/B and enhanced sleep errors have localized explanations and retain their diagnostic source', async()=>{
  const f=loadMobileI18n()
  for(const locale of ['zh','zht','en']){
    f.setAppLocale(locale)
    for(const message of ['歌曲尚未准备好，暂时无法设置 A/B 循环','歌曲已切换，请重新设置 A/B 循环','A/B 标记超出歌曲范围','请设置 A、B 两个位置，间隔至少0.5秒','请先取消按歌曲结束的睡眠定时，再开启 A/B 循环','请先关闭 A/B 循环，再设置按歌曲结束的睡眠定时','歌曲数量应为1至100首','淡出时间无效']){
      const result=failure.describeAppFailure(message)
      assert.equal(result.kind,'playbackFeature');assert.notEqual(f.translate(result.messageKey),result.messageKey);assert.notEqual(f.translate(result.hintKey),result.hintKey)
      if(locale==='en')assert.doesNotMatch(f.translate(result.messageKey),/[\u3400-\u9fff]/)
    }
  }
  assert.equal(failure.describeAppFailure('Unfamiliar decoder failure 123').kind,'unknown','Unknown diagnostics still use the existing details path')
})

test('actual error notice keeps original diagnostics as escaped details and offers only available recovery', async () => {
  const filename = path.resolve(__dirname, '../src/components/AppErrorNotice.vue')
  const script = compileScript(parse(fs.readFileSync(filename, 'utf8'), { filename }).descriptor, { id:'app-error-test', inlineTemplate:true })
  const component = evaluate(script.content, { vue, '../platform/appFailure': failure, './OriginalIcon.vue': { __esModule:true, default:vue.defineComponent({ render:()=>vue.h('span') }) } }).default
  const f = loadMobileI18n({locale:'en'})
  const render = props => renderToString(vue.createSSRApp(component, props).use(f.i18n))
  const raw = 'network failure: <img src=x onerror=alert(1)>'
  const network = await render({message:raw, offline:true})
  assert.match(network,/The service cannot be reached/)
  assert.match(network,/Local &amp; offline music/)
  assert.match(network,/&lt;img/)
  assert.doesNotMatch(network,/<img/)
  assert.doesNotMatch(network,/Reload current page/,'A missing retry callback must not show a reload button')
  assert.match(await render({message:raw,retry:async()=>{}}),/Reload current page/)
  assert.match(await render({message:'directory SecurityException'}),/Authorize folder again/)
})
