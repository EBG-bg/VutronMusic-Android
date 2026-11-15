const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')

function fixture() {
  const instances = [], module = { exports: {} }
  class Observer {
    constructor(callback, options) { this.callback = callback; this.margin = options.rootMargin; this.targets = new Set(); instances.push(this) }
    observe(element) { this.targets.add(element) }
    unobserve(element) { this.targets.delete(element) }
    disconnect() { this.targets.clear() }
    show(targets = [...this.targets]) { this.callback(targets.map(target => ({ target, isIntersecting: true }))) }
  }
  const source = fs.readFileSync(path.join(__dirname, '../src/composables/artworkVisibility.ts'), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports, IntersectionObserver: Observer })
  return { instances, observe: module.exports.observeArtworkVisibility }
}

test('artwork shares one observer per preload margin and releases visible targets once', () => {
  const f = fixture(), hits = [], elements = Array.from({ length: 800 }, () => ({}))
  elements.forEach((element, index) => f.observe(element, '180px', () => hits.push(index)))
  assert.equal(f.instances.length, 1)
  assert.equal(f.instances[0].targets.size, 800)
  f.instances[0].show(elements.slice(0, 5)); f.instances[0].show(elements.slice(0, 5))
  assert.deepEqual(hits, [0, 1, 2, 3, 4])
  assert.equal(f.instances[0].targets.size, 795)
  f.instances[0].show()
  assert.equal(hits.length, 800)
  assert.equal(f.instances[0].targets.size, 0)
})

test('different artwork margins stay independent and unmount before visibility never loads', () => {
  const f = fixture(), element = {}, other = {}, calls = []
  const stop = f.observe(element, '100px', () => calls.push('avatar'))
  f.observe(other, '160px', () => calls.push('plugin'))
  assert.deepEqual(f.instances.map(row => row.margin), ['100px', '160px'])
  stop(); stop(); f.instances[0].show([element]); f.instances[1].show()
  assert.deepEqual(calls, ['plugin'])
})

test('late callbacks from an emptied observer cannot detach a newer artwork pool', () => {
  const f = fixture(), calls = [], first = {}, second = {}, third = {}
  f.observe(first, '180px', () => calls.push('old'))()
  f.observe(second, '180px', () => calls.push('second'))
  f.instances[0].show([first])
  f.observe(third, '180px', () => calls.push('third'))
  assert.equal(f.instances.length, 2)
  f.instances[1].show()
  assert.deepEqual(calls, ['second', 'third'])
})
