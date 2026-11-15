const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const moduleUnderTest = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/composables/windowedTracks.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: moduleUnderTest, exports: moduleUnderTest.exports })
const { MeasuredTrackHeights, readWindowedViewState, saveWindowedViewState } = moduleUnderTest.exports

test('variable track heights preserve exact prefix offsets and containing indices', () => {
  const heights = new MeasuredTrackHeights(['a', 'b', 'c', 'd'], 64, new Map([['b', 110]]))
  assert.equal(heights.offset(2), 174); assert.equal(heights.total, 302)
  assert.equal(heights.indexAt(63.9), 0); assert.equal(heights.indexAt(64), 1)
  assert.equal(heights.indexAt(173.9), 1); assert.equal(heights.indexAt(174), 2)
  assert.equal(heights.update(0, 90), true); assert.equal(heights.offset(2), 200)
  assert.equal(heights.indexAt(199.9), 1); assert.equal(heights.indexAt(200), 2)
  assert.equal(heights.indexAt(999_999), 3); assert.equal(heights.indexAt(-100), 0)
})

test('deep positioning does not materialize or inspect preceding track objects', () => {
  const keys = Array.from({ length: 50_000 }, (_, index) => index)
  const heights = new MeasuredTrackHeights(keys, 70)
  heights.update(3, 130); heights.update(40_000, 200)
  assert.equal(heights.offset(45_000), 45_000 * 70 + 190)
  assert.equal(heights.indexAt(heights.offset(45_000) + 20), 45_000)
  assert.equal(heights.total, 3_500_190)
  assert.equal(heights.update(3, 130.1), false)
})

test('view measurements and anchors are scoped and bounded by total entries and view count', () => {
  const many = new Map(Array.from({ length: 10_000 }, (_, index) => [index, 70]))
  saveWindowedViewState('account-a/playlist-1', many, { key: 8000, index: 8000, offset: 12 })
  saveWindowedViewState('account-b/playlist-1', many, { key: 4000, index: 4000, offset: 8 })
  saveWindowedViewState('third', new Map([[1, 90]]))
  assert.equal(readWindowedViewState('account-a/playlist-1'), undefined, 'Global 20,000-height budget evicts the least recent view')
  assert.equal(readWindowedViewState('account-b/playlist-1').position.key, 4000)
  for (let index = 0; index < 25; index++) saveWindowedViewState('view-' + index, new Map([[index, 70]]))
  assert.equal(readWindowedViewState('view-0'), undefined)
  assert.equal(readWindowedViewState('view-24').position, undefined, 'Being above a list does not create a scroll-into-list anchor')
})
