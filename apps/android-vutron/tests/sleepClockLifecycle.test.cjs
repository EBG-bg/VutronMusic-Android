const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), vue = require('vue')

test('sleep countdown paints only settings and resumes from its unchanged native deadline', () => {
  const intervals = new Map(), scope = vue.effectScope(), activeTab = vue.ref('player'), document = { visibilityState: 'visible' }
  let now = 1000, sequence = 0
  class Clock extends Date { static now() { return now } }
  function read(relative, deps = {}) {
    const module = { exports: {} }, file = path.join(__dirname, '../src', relative)
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      module, exports: module.exports, require: name => name === 'vue' ? vue : deps[name], Date: Clock, document,
      setInterval: (callback, interval) => { intervals.set(++sequence, { callback, interval }); return sequence }, clearInterval: id => intervals.delete(id)
    })
    return module.exports
  }
  const factory = read('stores/domains/shellCache.ts', { '../../platform/vutronPlugin': { vutronPlugin: {} }, '../../utils/sleepTimer': read('utils/sleepTimer.ts') }).createShellCache
  const cache = scope.run(() => factory({ activeTab, playback: vue.ref({}), onlineAvailable: vue.ref(false), error: vue.ref(''), t: key => key, formatError: String, resolveCacheTrack() {}, loadOfflinePlaylists() {} }))
  cache.syncSleepTimer({ remainingMs: 9000, deadlineMs: 10000 })
  assert.equal(intervals.size, 0, 'Playing or browsing does not create a 250ms UI timer')
  now = 2000; activeTab.value = 'settings'
  assert.equal(intervals.size, 1); assert.equal(cache.sleepTimerRemainingMs.value, 8000)
  now = 2500; [...intervals.values()][0].callback(); assert.equal(cache.sleepTimerRemainingMs.value, 7500)
  activeTab.value = 'library'; assert.equal(intervals.size, 0)
  now = 6500; activeTab.value = 'settings'; assert.equal(cache.sleepTimerRemainingMs.value, 3500); assert.equal(intervals.size, 1)
  document.visibilityState = 'hidden'; cache.stopSleepClock(); assert.equal(intervals.size, 0)
  now = 8000; cache.startSleepClock(); assert.equal(intervals.size, 0, 'A hidden view cannot restart the paint clock')
  document.visibilityState = 'visible'; cache.syncSleepTimer({ remainingMs: 2000, deadlineMs: 10000 }); assert.equal(intervals.size, 1)
  now = 11000; [...intervals.values()][0].callback(); assert.equal(cache.sleepTimerRemainingMs.value, 0); assert.equal(intervals.size, 0)
  cache.syncSleepTimer({ remainingMs: 3000, deadlineMs: 14000 }); assert.equal(intervals.size, 1)
  cache.syncSleepTimer({ active: true, mode: 'count', remainingMs: 0, remainingTracks: 2, fadeSeconds: 5 })
  assert.equal(cache.sleepTimerActive.value, true, 'Completion timers remain active without a wall-clock deadline')
  assert.equal(cache.sleepTimerMode.value, 'count'); assert.equal(cache.sleepTimerRemainingTracks.value, 2); assert.equal(cache.sleepTimerFadeSeconds.value, 5)
  assert.equal(intervals.size, 0, 'Completion counters do not start a painting clock')
  cache.syncSleepTimer({ active: false, mode: 'count', remainingMs: 0, remainingTracks: 0 })
  assert.equal(cache.sleepTimerActive.value, false)
  scope.stop(); assert.equal(intervals.size, 0, 'Store scope disposal releases its clock')
})
