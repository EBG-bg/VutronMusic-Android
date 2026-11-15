const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const moduleValue = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/lyricPlayback.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, { module: moduleValue, exports: moduleValue.exports, Math })
const { estimatedLyricWords, lyricDisplayLines, lyricWordProgress } = moduleValue.exports
const line = (text, start = 1000, end = 5000, words = []) => ({ text, start, end, words })

test('short estimated lyrics finish before an obvious interlude or outro', () => {
  const rows = [line('ABCD', 1000, 26000), line('Next', 26000, 30000)]
  const display = lyricDisplayLines(rows, true, 60000)
  assert.equal(display[0].words.at(-1).end, 2800)
  assert.equal(display[1].words.at(-1).end, 27800)
  assert.equal(rows[0].words.length, 0)
  assert.equal(lyricDisplayLines(rows, false), rows)
})

test('spaces and punctuation remain visible without consuming estimated vocal time', () => {
  const words = estimatedLyricWords(line('A, B'), 5000)
  assert.deepEqual(Array.from(words, item => [item.text, item.start, item.end]), [
    ['A', 1000, 3000], [',', 3000, 3000], [' ', 3000, 3000], ['B', 3000, 5000]
  ])
  assert.equal(lyricWordProgress(words[0], 2000), .5)
})

test('ordinary line pacing and Unicode display groups stay intact', () => {
  const words = estimatedLyricWords(line('A\u0301😀👩‍👩‍👧‍👦🇨🇳中'), 6000)
  assert.equal(words.length, 5)
  assert.deepEqual(Array.from(words, item => item.end), [2000, 3000, 4000, 5000, 6000])
})

test('real provider gaps and word timing always win over estimates', () => {
  const actual = [{ text: 'A', start: 2000, end: 2200 }, { text: 'B', start: 4000, end: 4500 }]
  const source = line('AB', 1000, 9000, actual)
  assert.equal(estimatedLyricWords(source, 20000), actual)
  assert.equal(lyricDisplayLines([source], true, 20000)[0], source)
})
