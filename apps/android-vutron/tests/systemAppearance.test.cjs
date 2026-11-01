const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const vue = require('vue'), ts = require('typescript')

function fixture({ native = true, stored = 'auto', systemDark = false, failure } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/platform/appearance.ts'), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const calls = [], warnings = [], listeners = new Map(), storage = new Map([['vutron:appearance', stored]])
  const root = { dataset: {}, style: { setProperty() {} } }, module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(id) {
      if (id === 'vue') return vue
      if (id === '@capacitor/core') return { Capacitor: { isNativePlatform: () => native } }
      if (id === './vutronPlugin') return { vutronPlugin: { setSystemAppearance(value) {
        calls.push({ ...value }); return failure ? Promise.reject(failure) : Promise.resolve()
      } } }
      if (id.endsWith('?raw')) return { __esModule: true, default: ":root, [data-theme='light'] {--color-body-bg:#fff;} [data-theme='dark'] {--color-body-bg:#222;}" }
      throw new Error(id)
    },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) },
    document: { documentElement: root, createElement: () => ({ dataset: {} }), head: { append() {} }, querySelector: () => ({ setAttribute() {} }) },
    window: { matchMedia: () => ({ matches: systemDark, addEventListener: (name,fn) => listeners.set(name,fn) }) },
    console: { warn: (...args) => warnings.push(args) }
  })
  return { api: module.exports, calls, warnings, listeners, root }
}

test('native system bars follow the resolved theme and ignore accent-only changes', async () => {
  const f = fixture()
  assert.deepEqual(f.calls,[{ dark: false }])
  f.api.accent.value = '#335eea'; await vue.nextTick()
  assert.equal(f.calls.length,1)
  f.api.appearance.value = 'dark'; await vue.nextTick()
  assert.deepEqual(f.calls,[{ dark: false },{ dark: true }])
  assert.equal(f.root.dataset.theme,'dark')
  f.listeners.get('change')({ matches: false }); await vue.nextTick()
  assert.equal(f.calls.length,2,'Explicit dark remains dark when the system changes')
  f.api.appearance.value = 'auto'; await vue.nextTick()
  assert.deepEqual(f.calls.at(-1),{ dark: false })
  f.listeners.get('change')({ matches: true }); await vue.nextTick()
  assert.deepEqual(f.calls.at(-1),{ dark: true })
})

test('restored theme is applied on initialization and browser previews make no native calls', () => {
  const restored = fixture({ stored: 'dark' })
  assert.deepEqual(restored.calls,[{ dark: true }])
  assert.equal(restored.root.dataset.theme,'dark')
  assert.equal(fixture({ native: false }).calls.length,0)
})

test('system-bar bridge failure preserves the page theme and reports its diagnostic', async () => {
  const error = new Error('Activity is unavailable'), f = fixture({ stored: 'dark', failure: error })
  await Promise.resolve()
  assert.equal(f.root.dataset.theme,'dark')
  assert.equal(f.warnings.length,1)
  assert.equal(f.warnings[0][1],error)
})
