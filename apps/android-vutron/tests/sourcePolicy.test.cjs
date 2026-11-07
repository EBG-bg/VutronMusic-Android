const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')
const { renderToString } = require('@vue/server-renderer')
const { loadMobileI18n } = require('./helpers/i18n.cjs')
const policy = require('../../../vendor/android-runtime/src/main/assets/sources-runtime/source-policy.json')

test('the actual audio policy component renders the same runtime candidates and respects the saved fallback switch in three languages', async () => {
  const store = vue.reactive({ autoMatchSources: true, playback: { quality: 'Fixture source · FLAC' }, setAutoMatchSources() { throw new Error('SSR must not change settings') } })
  const filename = path.resolve(__dirname, '../src/components/PlaybackSourcePolicySettings.vue')
  const descriptor = parse(fs.readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = compileScript(descriptor, { id: 'source-policy-test', inlineTemplate: true })
  const code = ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const module = { exports: {} }
  const card = vue.defineComponent({ props: ['title'], setup: (props, { slots }) => () => vue.h('section', [vue.h('h2', props.title), slots.default?.()]) })
  vm.runInNewContext(code, { module, exports: module.exports, require(name) {
    if (name === 'vue') return vue
    if (name === '../stores/androidShell') return { useAndroidShellStore: () => store }
    if (name.endsWith('/source-policy.json')) return policy
    if (name === './CollapsibleSettingsCard.vue') return { __esModule: true, default: card }
    if (name === './OriginalIcon.vue') return { __esModule: true, default: vue.defineComponent({ render: () => vue.h('span') }) }
    throw new Error('Unexpected audio policy dependency: ' + name)
  } })
  const f = loadMobileI18n()
  for (const locale of ['zh', 'zht', 'en']) {
    f.setAppLocale(locale)
    store.autoMatchSources = true
    let html = await renderToString(vue.createSSRApp(module.exports.default).use(f.i18n))
    assert.ok(html.includes(f.translate('mobile.plugins.audioFallbackStep')))
    assert.ok(html.includes('Fixture source · FLAC'))
    const providers = html.match(/<ul class="audio-policy-providers[\s\S]*?<\/ul>/)?.[0]
    assert.ok(providers)
    assert.equal((providers.match(/<li>/g) || []).length, policy.fallbackSources.length)
    for (const id of policy.fallbackSources) assert.ok(providers.includes(f.translate('mobile.plugins.audioProviderNames.' + id)), id)
    assert.ok(!html.includes('mobile.plugins.'))
    store.autoMatchSources = false
    html = await renderToString(vue.createSSRApp(module.exports.default).use(f.i18n))
    assert.ok(html.includes(f.translate('mobile.plugins.audioFallbackOff')))
    assert.match(html, /class="audio-policy-providers inactive"/)
    store.playback.quality = ''
    html = await renderToString(vue.createSSRApp(module.exports.default).use(f.i18n))
    assert.ok(html.includes(f.translate('mobile.plugins.audioNotPlaying')))
    store.playback.quality = 'Fixture source · FLAC'
  }
})
