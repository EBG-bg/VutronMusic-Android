const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), vue = require('vue')
function fixture() {
  const module = { exports: {} }, timers = new Map(); let now = 1000, sequence = 0
  const source = fs.readFileSync(path.join(__dirname, '../src/platform/undo.ts'), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: () => vue, Date: { now: () => now },
      setTimeout: (callback, delay) => { timers.set(++sequence, { callback, deadline: now + delay }); return sequence }, clearTimeout: id => timers.delete(id) })
  return { api: module.exports, timers, advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.deadline <= now) { timers.delete(id); timer.callback() } } }
}
test('undo expires after eight seconds without scheduling or applying a deletion', async () => {
  const f = fixture(); let inverseCalls = 0
  f.api.offerUndo({ message: 'Removed', undo: () => { inverseCalls++ } })
  assert.equal(f.api.activeUndo.value.deadline, 9000); assert.equal(f.timers.size, 1)
  f.advance(8000); assert.equal(f.api.activeUndo.value, undefined); assert.equal(inverseCalls, 0)
  assert.equal(await f.api.performUndo(), false)
})
test('a new offer replaces the old inverse; dismissal cannot accidentally undo either operation', async () => {
  const f = fixture(), calls = []
  const first = f.api.offerUndo({ message: 'First', undo: () => calls.push('first') })
  f.api.offerUndo({ message: 'Second', undo: () => calls.push('second') })
  f.api.dismissUndo(first); assert.equal(f.api.activeUndo.value.message, 'Second'); assert.equal(f.timers.size, 1)
  assert.equal(await f.api.performUndo(), true); assert.deepEqual(calls, ['second']); assert.equal(f.timers.size, 0)
})
test('duplicate undo presses run the inverse once and an older completion keeps a newer offer', async () => {
  const f = fixture(); let resolve, calls = 0
  f.api.offerUndo({ message: 'First', undo: () => { calls++; return new Promise(done => { resolve = done }) } })
  const first = f.api.performUndo(); assert.equal(await f.api.performUndo(), false)
  f.api.offerUndo({ message: 'New', undo: () => {} }); resolve(); await first
  assert.equal(calls, 1); assert.equal(f.api.activeUndo.value.message, 'New'); assert.equal(f.timers.size, 1)
})
test('a failed inverse keeps its diagnostic and remaining time; elapsed background time cannot revive it', async () => {
  const f = fixture()
  f.api.offerUndo({ message: 'Removed', undo: () => { throw new Error('Queue changed') } })
  f.advance(2000); assert.equal(await f.api.performUndo(), false)
  assert.equal(f.api.activeUndo.value.error, 'Queue changed'); assert.equal(f.api.activeUndo.value.deadline, 9000)
  f.advance(6000); assert.equal(await f.api.performUndo(), false); assert.equal(f.api.activeUndo.value, undefined)
})
