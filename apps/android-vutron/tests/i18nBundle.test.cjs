const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadMobileI18n } = require('./helpers/i18n.cjs')

const app = path.resolve(__dirname, '..')
const repository = path.resolve(app, '../..')
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(path.join(directory, entry.name)) : /\.(?:vue|ts)$/.test(entry.name) ? [path.join(directory, entry.name)] : [])
}
function flatten(value, prefix = '', result = {}) {
  for (const [key, item] of Object.entries(value)) {
    const next = prefix ? prefix + '.' + key : key
    if (typeof item === 'string') result[next] = item
    else if (item && typeof item === 'object') flatten(item, next, result)
  }
  return result
}

test('every referenced original desktop word and dynamic prefix remains available in the mobile projection', () => {
  const full = flatten(JSON.parse(fs.readFileSync(path.join(repository, 'src/renderer/locales/zh-hans.json'), 'utf8')))
  const sources = [...files(path.join(app, 'src')), ...files(path.join(repository, 'packages/ui/src'))]
    .filter(file => !file.endsWith(path.join('platform', 'i18n.ts')))
  const referenced = new Set()
  for (const file of sources) {
    const code = fs.readFileSync(file, 'utf8')
    for (const match of code.matchAll(/['"`]([a-zA-Z][\w.]+)['"`]/g)) {
      const key = match[1]
      if (full[key]) referenced.add(key)
      // A dynamically appended namespace must retain that whole source subtree.
      if (key.endsWith('.')) for (const leaf of Object.keys(full)) if (leaf.startsWith(key)) referenced.add(leaf)
    }
  }
  assert.ok(referenced.size >= 20)
  const f = loadMobileI18n()
  for (const [locale, source] of [['zh', 'zh-hans'], ['zht', 'zh-hant'], ['en', 'en']]) {
    const original = flatten(JSON.parse(fs.readFileSync(path.join(repository, 'src/renderer/locales', source + '.json'), 'utf8')))
    const actual = flatten(f.i18n.global.getLocaleMessage(locale))
    for (const key of referenced) {
      if (original[key] !== undefined) assert.equal(actual[key], original[key], locale + ': ' + key)
    }
    assert.equal(Object.keys(actual).some(key => key.startsWith('settings.tray.')), false, 'Unused desktop tray settings are not copied into mobile messages')
  }
})

test('composition-only installation keeps synchronous translation, interpolation and complete plugin words in all languages', () => {
  const f = loadMobileI18n()
  for (const [locale, source] of [['zh', 'zh-hans'], ['zht', 'zh-hant'], ['en', 'en']]) {
    assert.equal(f.setAppLocale(locale), true)
    const plugin = flatten(JSON.parse(fs.readFileSync(path.join(app, 'src/plugins/locales', source + '.json'), 'utf8')))
    for (const key of Object.keys(plugin)) {
      const text = f.translate('mobile.plugins.' + key, { count: 2, name: 'Original title', value: 80, percent: 100 })
      assert.ok(text && text !== 'mobile.plugins.' + key, locale + ': ' + key)
    }
    assert.ok(f.translate('mobile.updates.found', { version: '1.2.3' }).includes('1.2.3'))
    assert.ok(f.translate('nav.home'))
  }
  for (const file of [...files(path.join(app, 'src')), ...files(path.join(repository, 'packages/ui/src'))]) {
    const code = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(code, /<(?:i18n-[tnd]|I18n[TDN])\b|\bv-t\s*=/, 'Full-install translation components/directive must be deliberately enabled before use: ' + file)
  }
})
