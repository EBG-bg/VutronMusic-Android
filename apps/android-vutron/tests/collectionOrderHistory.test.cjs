const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), vue = require('vue')
const plain = value => JSON.parse(JSON.stringify(value))
function fixture(storage = new Map()) {
  const modules = new Map(), events = new Map(), reads = new Map(), writes = [], undoOffers = []
  let now = 1000, failWrites = false, failedKey
  function file(name) {
    if (modules.has(name)) return modules.get(name).exports
    const module = { exports: {} }, filename = path.join(__dirname, '../src/composables/' + name + '.ts')
    modules.set(name, module)
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    vm.runInNewContext(code, { module, exports: module.exports, require: dep => dep === 'vue' ? vue : dep === '../platform/undo' ? { offerUndo: offer => undoOffers.push(offer) } : dep === '../platform/undoMessages' ? { undoText: key => key } : file(dep.slice(2)), Intl,
      Date: class extends Date { static now() { return now } },
      window: { addEventListener: (name, callback) => events.set(name, [...events.get(name) || [], callback]) },
      localStorage: {
        getItem(key) { reads.set(key, (reads.get(key) || 0) + 1); return storage.get(key) ?? null },
        setItem(key, value) { if (failWrites || key === failedKey) throw new Error('Quota fixture'); writes.push([key, value]); storage.set(key, value) },
        removeItem(key) { if (failWrites) throw new Error('Quota fixture'); storage.delete(key) }
      }
    })
    return module.exports
  }
  const api = file('collectionOrderHistory'), ordering = file('localTrackOrdering')
  return { api, ordering, storage, reads, writes, undoOffers, now: value => { now = value }, fail: value => { failWrites = value }, failKey: key => { failedKey = key },
    restore: () => (events.get('vutron-backup-restored') || []).forEach(callback => callback()) }
}
function collection(f, scope = 'netease:7:playlist:42', tracks = ['a', 'b', 'c']) {
  const effect = vue.effectScope(), key = vue.ref(scope), source = vue.ref(tracks.map((name, index) => ({ id: index + 1, name, localKey: name })))
  const state = effect.run(() => f.ordering.useCollectionTrackOrder(vue.computed(() => source.value), key))
  return { effect, key, source, state, ids: () => Array.from(state.ordered.value, row => row.localKey) }
}

test('different full sequences are kept once; matching sorted views preserve custom provenance and baseline time', () => {
  const f = fixture(), { api } = f, key = 'netease:7:playlist:42'
  const original = api.recordCollectionOrder(key, ['a', 'b'], 'original')
  f.now(2000); const custom = api.recordCollectionOrder(key, ['b', 'a'], 'custom')
  api.renameCollectionOrderHistory(key, custom.id, 'My order'); api.pinCollectionOrderHistory(key, custom.id, true)
  f.now(3000); api.recordCollectionOrder(key, ['b', 'a'], 'artist')
  const current = api.getCollectionOrderHistory(key)
  assert.equal(current.entries.length, 2)
  assert.deepEqual(plain(current.entries[0]), { ...plain(custom), mode: 'artist', createdAt: 3000, name: 'My order', pinned: true })
  assert.equal(api.recentCustomOrder(current).id, custom.id)
  f.now(4000); api.recordCollectionOrder(key, ['a', 'b'], 'original', { promote: false })
  assert.equal(api.getCollectionOrderHistory(key).entries.find(row => row.id === original.id).createdAt, 1000)
})

test('each playlist has its own automatic limit and permanent orders never occupy that limit', () => {
  const f = fixture(), { api } = f, one = 'netease:7:playlist:1', two = 'netease:7:playlist:2'
  const permanent = api.recordCollectionOrder(one, ['a'], 'custom'); api.pinCollectionOrderHistory(one, permanent.id, true)
  api.setCollectionOrderHistoryLimit(one, 1)
  f.now(2000); api.recordCollectionOrder(one, ['b'], 'title')
  f.now(3000); const latest = api.recordCollectionOrder(one, ['c'], 'artist')
  assert.deepEqual(plain(api.getCollectionOrderHistory(one).entries.map(row => row.id).sort()), [permanent.id, latest.id].sort())
  assert.equal(api.getCollectionOrderHistory(two).limit, 10)
  f.now(4000); api.pinCollectionOrderHistory(one, permanent.id, false)
  assert.deepEqual(plain(api.getCollectionOrderHistory(one).entries.map(row => row.id)), [permanent.id])
  assert.throws(() => api.setCollectionOrderHistoryLimit(one, 0), /Invalid/)
  assert.throws(() => api.renameCollectionOrderHistory(one, permanent.id, 'x'.repeat(81)), /80/)
})

test('legacy custom keys migrate once even when current mode is a named sort; load reconciles only its new view', () => {
  const scope = 'netease:7:playlist:42', orderKey = 'vutron:collection-orders:v1'
  const storage = new Map([[orderKey, JSON.stringify({ [scope]: { mode: 'title', keys: ['gone', 'b', 'a'] } })]])
  const f = fixture(storage), c = collection(f, scope, ['a', 'b', 'new'])
  assert.deepEqual(plain(c.state.history.value[0].keys), ['gone', 'b', 'a'])
  const migrated = c.state.recentCustomId.value
  f.now(9000); c.state.ensureLegacy()
  assert.equal(c.state.history.value[0].createdAt, 1000)
  assert.equal(c.state.loadRecentCustomHistory(), true)
  assert.equal(c.state.mode.value, 'custom'); assert.deepEqual(c.ids(), ['b', 'a', 'new'])
  assert.deepEqual(plain(c.state.history.value.find(row => row.id === migrated).keys), ['gone', 'b', 'a'])
  c.effect.stop()
})

test('manually removed histories do not reappear from legacy custom keys after recreation or backup reload', () => {
  const scope = 'bundle:one', storage = new Map([['vutron:collection-orders:v1', JSON.stringify({ [scope]: { mode: 'original', keys: ['b', 'a'] } })]])
  const f = fixture(storage), c = collection(f, scope, ['a', 'b'])
  c.state.removeHistory(c.state.history.value[0].id); assert.equal(c.state.history.value.length, 0)
  c.state.ensureLegacy(); f.restore(); assert.equal(c.state.history.value.length, 0)
  c.effect.stop()
  const recreated = collection(fixture(storage), scope, ['a', 'b'])
  assert.equal(recreated.state.history.value.length, 0); assert.equal(recreated.state.loadRecentCustomHistory(), false)
  recreated.effect.stop()
})

test('opening, source refresh, filtering consumers and repeated progress reads do not rewrite or reread histories', () => {
  const f = fixture(), c = collection(f), beforeReads = [...f.reads], beforeWrites = f.writes.length
  for (let n = 0; n < 20; n++) { c.source.value = c.source.value.map(row => ({ ...row })); void c.state.ordered.value; void c.state.history.value; void c.state.recentCustomId.value }
  assert.deepEqual([...f.reads], beforeReads); assert.equal(f.writes.length, beforeWrites)
  c.state.commit(['c', 'a', 'b']); c.state.saveDraft(); assert.equal(c.state.history.value.length, 2)
  const reads = [...f.reads], writes = f.writes.length
  for (let n = 0; n < 100; n++) { void c.state.history.value; void c.state.historyLimit.value; void c.state.mode.value; void c.state.ordered.value }
  assert.deepEqual([...f.reads], reads); assert.equal(f.writes.length, writes)
  c.effect.stop()
})

test('same-scope consumers share saved changes after confirmation while account and playlist scopes remain isolated', () => {
  const f = fixture(), a = collection(f), b = collection(f), other = collection(f, 'netease:8:playlist:42')
  a.state.commit(['b', 'c', 'a'])
  assert.deepEqual(b.ids(), ['a', 'b', 'c']); assert.equal(b.state.history.value.length, 0)
  a.state.saveDraft()
  assert.deepEqual(b.ids(), ['b', 'c', 'a']); assert.equal(b.state.history.value.length, 2)
  assert.deepEqual(other.ids(), ['a', 'b', 'c']); assert.equal(other.state.history.value.length, 0)
  a.state.mode.value = 'title'; a.state.saveDraft(); assert.equal(b.state.mode.value, 'title')
  a.effect.stop(); b.effect.stop(); other.effect.stop()
})

test('restore original keeps custom keys and history after the remote source was reordered', () => {
  const f = fixture(), c = collection(f)
  c.state.commit(['c', 'b', 'a']); c.state.saveDraft(); c.source.value.reverse()
  const ids = c.state.history.value.map(row => row.id)
  c.state.restore(); assert.equal(c.state.mode.value, 'original')
  assert.deepEqual(plain(c.state.history.value.map(row => row.id)), plain(ids))
  c.source.value = [c.source.value[1], c.source.value[2], c.source.value[0]]
  c.state.mode.value = 'custom'; assert.deepEqual(c.ids(), ['c', 'b', 'a'])
  c.effect.stop()
})

test('loading unrelated history leaves the current view unchanged; preview and deletion do not apply it', () => {
  const f = fixture(), c = collection(f), entry = f.api.recordCollectionOrder(c.key.value, ['unrelated'], 'custom')
  const before = c.ids(), preview = f.api.reconcileCollectionOrder(['c', 'gone', 'a'], ['a', 'b', 'c', 'new'])
  assert.deepEqual(plain(preview), ['c', 'a', 'b', 'new']); assert.deepEqual(c.ids(), before)
  assert.equal(c.state.loadHistory(entry.id), false); assert.deepEqual(c.ids(), before)
  c.state.removeHistory(entry.id); assert.deepEqual(c.ids(), before)
  c.effect.stop()
})

test('a history storage failure keeps the preview editable and leaves the saved order unchanged', () => {
  const f = fixture(), c = collection(f)
  f.fail(true)
  c.state.commit(['c', 'a', 'b'])
  assert.throws(() => c.state.saveDraft(), /Quota fixture/)
  assert.equal(c.state.savedMode.value, 'original'); assert.equal(c.state.dirty.value, true); assert.deepEqual(c.ids(), ['c', 'a', 'b'])
  f.fail(false); assert.equal(c.state.saveDraft(), true); assert.equal(c.state.dirty.value, false); assert.deepEqual(c.ids(), ['c', 'a', 'b'])
  c.effect.stop()
})

test('a failed legacy migration stays usable and its diagnostic clears after a successful retry', () => {
  const key = 'bundle:one', storage = new Map([['vutron:collection-orders:v1', JSON.stringify({ [key]: { mode: 'title', keys: ['b', 'a'] } })]])
  const f = fixture(storage); f.fail(true)
  const c = collection(f, key, ['a', 'b'])
  assert.match(c.state.historyError.value, /Quota fixture/)
  assert.deepEqual(c.ids(), ['a', 'b'])
  f.fail(false); c.state.ensureLegacy()
  assert.equal(c.state.historyError.value, ''); assert.equal(c.state.history.value.length, 1)
  c.effect.stop()
})

test('import sanitation and merge preserve names, permanent snapshots and custom timestamps without duplicate orders', () => {
  const f = fixture(), { api } = f, key = 'netease:7:playlist:42'
  const old = { [key]: { limit: 1, legacyMigrated: true, entries: [
    { id: 'old', createdAt: 1000, customAt: 2500, mode: 'custom', keys: ['b', 'a'], name: 'Permanent', pinned: true },
    { id: 'auto', createdAt: 3000, mode: 'title', keys: ['a', 'b'] }
  ] } }
  const incoming = { [key]: { limit: 1, entries: [
    { id: 'new', createdAt: 4000, mode: 'album', keys: ['b', 'a'] },
    { id: 'auto2', createdAt: 5000, mode: 'artist', keys: ['c', 'a'] },
    { createdAt: 6000, mode: 'title', keys: ['bad'] }
  ] } }
  const merged = api.mergeCollectionOrderHistories(old, incoming)[key]
  assert.equal(merged.entries.length, 2); assert.equal(merged.legacyMigrated, true)
  const permanent = merged.entries.find(row => row.pinned)
  assert.equal(permanent.name, 'Permanent'); assert.equal(permanent.customAt, 2500); assert.deepEqual(plain(permanent.keys), ['b', 'a'])
  assert.equal(merged.entries.find(row => !row.pinned).id, 'auto2')
})

test('fixed clocks and restarted sequences cannot duplicate IDs or change the last custom order via a named sort', () => {
  const key = 'netease:7:playlist:42', storage = new Map([['vutron:collection-order-history:v1', JSON.stringify({
    [key]: { limit: 10, entries: [{ id: 'o-rs-1', createdAt: 1, mode: 'original', keys: ['original'] }] }
  })]])
  const f = fixture(storage), { api } = f
  const first = api.recordCollectionOrder(key, ['b', 'a'], 'custom')
  assert.notEqual(first.id, 'o-rs-1')
  const second = api.recordCollectionOrder(key, ['a', 'b'], 'custom')
  assert.ok(second.customAt > first.customAt)
  api.recordCollectionOrder(key, ['b', 'a'], 'title')
  assert.equal(api.recentCustomOrder(api.getCollectionOrderHistory(key)).id, second.id)
  assert.equal(new Set(api.getCollectionOrderHistory(key).entries.map(row => row.id)).size, 3)
})

test('external timestamps beyond the Date range are dropped or ignored before history formatting', () => {
  const { api } = fixture(), key = 'netease:7:playlist:42'
  const result = api.sanitizeCollectionOrderHistories({ [key]: { limit: 10, entries: [
    { id: 'invalid-created', createdAt: 8_900_000_000_000_000, mode: 'custom', keys: ['a'] },
    { id: 'invalid-custom', createdAt: 1000, customAt: 8_900_000_000_000_000, mode: 'original', keys: ['b'] },
    { id: 'date-limit', createdAt: 8_640_000_000_000_000, mode: 'original', keys: ['c'] }
  ] } })[key]
  assert.equal(result.entries.some(entry => entry.id === 'invalid-created'), false)
  assert.equal(result.entries.find(entry => entry.id === 'invalid-custom').customAt, undefined)
  assert.equal(result.entries.find(entry => entry.id === 'date-limit').createdAt, 8_640_000_000_000_000)
  for (const entry of result.entries) assert.doesNotThrow(() => new Intl.DateTimeFormat('zh-CN').format(entry.createdAt))
})

test('a draft can be discarded and saving the identical configuration performs no writes or history promotion', () => {
  const f = fixture(), c = collection(f), initialWrites = f.writes.length
  c.state.commit(['c', 'b', 'a'])
  assert.equal(c.state.dirty.value, true); assert.equal(f.writes.length, initialWrites); assert.equal(c.state.history.value.length, 0)
  c.state.discardDraft(); assert.equal(c.state.dirty.value, false); assert.deepEqual(c.ids(), ['a', 'b', 'c'])
  assert.equal(c.state.saveDraft(), false); assert.equal(f.writes.length, initialWrites)
  c.state.commit(['c', 'b', 'a']); assert.equal(c.state.saveDraft(), true)
  const writes = f.writes.length, history = plain(c.state.history.value)
  f.now(9000); c.state.commit(['c', 'b', 'a']); c.state.mode.value = 'custom'
  assert.equal(c.state.dirty.value, false); assert.equal(c.state.saveDraft(), false)
  c.state.mode.value = 'title'; c.state.mode.value = 'custom'
  assert.equal(c.state.dirty.value, false); assert.equal(c.state.saveDraft(), false)
  assert.equal(f.writes.length, writes); assert.deepEqual(plain(c.state.history.value), history)
  c.effect.stop()
})

test('prepare archives only once and leaves the persisted baseline intact until remote synchronization succeeds', () => {
  const f = fixture(), c = collection(f)
  c.state.commit(['c', 'a', 'b']); assert.equal(c.state.prepareDraftSave(), true)
  const writes = f.writes.length, entries = plain(c.state.history.value)
  assert.equal(c.state.savedMode.value, 'original'); assert.equal(c.state.dirty.value, true)
  f.now(8000); c.state.prepareDraftSave(); assert.equal(f.writes.length, writes)
  assert.equal(c.state.saveDraft(), true)
  assert.equal(f.writes.length, writes + 1); assert.deepEqual(plain(c.state.history.value), entries)
  assert.equal(c.state.dirty.value, false); c.effect.stop()
})

test('same names, limits, pinned flags and full sequences do not rewrite history metadata', () => {
  const f = fixture(), { api } = f, scope = 'netease:7:playlist:42'
  const entry = api.recordCollectionOrder(scope, ['b', 'a'], 'custom')
  api.renameCollectionOrderHistory(scope, entry.id, 'Evening'); api.pinCollectionOrderHistory(scope, entry.id, true)
  const writes = f.writes.length, before = plain(api.getCollectionOrderHistory(scope))
  f.now(6000)
  api.setCollectionOrderHistoryLimit(scope, 10)
  assert.equal(api.renameCollectionOrderHistory(scope, entry.id, '  Evening  '), true)
  assert.equal(api.pinCollectionOrderHistory(scope, entry.id, true), true)
  api.recordCollectionOrder(scope, ['b', 'a'], 'custom')
  assert.equal(f.writes.length, writes); assert.deepEqual(plain(api.getCollectionOrderHistory(scope)), before)
})

test('legacy aggregate migration preserves every scope and later mutations write only that playlist shard', () => {
  const scope = 'netease:7:playlist:42', other = 'plugin:user:library:2', oldKey = 'vutron:collection-order-history:v1'
  const initial = {
    [scope]: { limit: 4, entries: [{ id: 'one', createdAt: 100, mode: 'custom', keys: ['a', 'b'], name: 'Mine', pinned: true }] },
    [other]: { limit: 8, legacyMigrated: true, entries: [{ id: 'two', createdAt: 200, mode: 'custom', keys: ['x', 'y'] }] }
  }
  const storage = new Map([[oldKey, JSON.stringify(initial)]]), f = fixture(storage), { api } = f
  api.getCollectionOrderHistory(scope)
  assert.equal(storage.has(oldKey), false)
  const otherValue = storage.get(api.collectionOrderHistoryStorageKey(other)), writes = f.writes.length
  api.renameCollectionOrderHistory(scope, 'one', 'Renamed')
  assert.deepEqual(f.writes.slice(writes).map(([key]) => key), [api.collectionOrderHistoryStorageKey(scope)])
  assert.equal(storage.get(api.collectionOrderHistoryStorageKey(other)), otherValue)
  const fresh = fixture(storage)
  assert.equal(fresh.api.getCollectionOrderHistory(scope).entries[0].name, 'Renamed')
  assert.equal(fresh.reads.has(api.collectionOrderHistoryStorageKey(other)), false, 'Cold opening one playlist does not load another playlist history')
  const exported = fresh.api.exportCollectionOrderHistories()
  assert.equal(exported[other].limit, 8); assert.equal(exported[other].legacyMigrated, true)
  assert.deepEqual(plain(exported[other].entries[0].keys), ['x', 'y'])
})

test('failed aggregate migration keeps the old copy readable and retries before a mutation', () => {
  const scope = 'bundle:one', oldKey = 'vutron:collection-order-history:v1'
  const storage = new Map([[oldKey, JSON.stringify({ [scope]: { limit: 10, entries: [{ id: 'one', createdAt: 100, mode: 'custom', keys: ['a'] }] } })]])
  const f = fixture(storage); f.fail(true)
  assert.equal(f.api.getCollectionOrderHistory(scope).entries[0].id, 'one'); assert.equal(storage.has(oldKey), true)
  assert.throws(() => f.api.renameCollectionOrderHistory(scope, 'one', 'New'), /Quota fixture/)
  assert.equal(f.api.getCollectionOrderHistory(scope).entries[0].name, undefined)
  f.fail(false); assert.equal(f.api.renameCollectionOrderHistory(scope, 'one', 'New'), true)
  assert.equal(storage.has(oldKey), false); assert.equal(f.api.getCollectionOrderHistory(scope).entries[0].name, 'New')
})

test('entering custom mode and dragging back to the saved sequence creates no dirty draft or history', () => {
  const f = fixture(), c = collection(f), writes = f.writes.length
  c.state.mode.value = 'custom'; assert.equal(c.state.dirty.value, false)
  c.state.commit(['b', 'a', 'c']); assert.equal(c.state.dirty.value, true)
  c.state.commit(['a', 'b', 'c']); assert.equal(c.state.dirty.value, false)
  assert.equal(c.state.prepareDraftSave(), false); assert.equal(c.state.saveDraft(), false)
  assert.equal(f.writes.length, writes); assert.equal(c.state.history.value.length, 0)
  c.state.mode.value = 'artist'; c.state.mode.value = 'original'; assert.equal(c.state.dirty.value, false)
  assert.equal(c.state.saveDraft(), false); assert.equal(f.writes.filter(([key]) => key !== f.ordering.ORDER_STORAGE_KEY).length, 0)
  c.state.commit(['b', 'a', 'c']); assert.equal(c.state.restore(), false)
  assert.equal(c.state.dirty.value, true); assert.deepEqual(c.ids(), ['b', 'a', 'c'])
  c.state.discardDraft(); assert.equal(c.state.dirty.value, false); assert.equal(c.state.saveDraft(), false)
  assert.equal(c.state.history.value.length, 0)
  c.effect.stop()
})

test('a failed prepare can be retried and discarding an attempted remote save never commits active preferences', () => {
  const f = fixture(), c = collection(f), oldPreference = f.storage.get(f.ordering.ORDER_STORAGE_KEY)
  c.state.commit(['b', 'c', 'a']); f.fail(true)
  assert.throws(() => c.state.prepareDraftSave(), /Quota fixture/)
  assert.equal(c.state.dirty.value, true); assert.equal(c.state.savedMode.value, 'original')
  assert.equal(f.storage.get(f.ordering.ORDER_STORAGE_KEY), oldPreference)
  f.fail(false); c.state.prepareDraftSave(); const writes = f.writes.length
  // A failed remote operation leaves this same prepared draft available for an explicit retry.
  c.state.prepareDraftSave(); assert.equal(f.writes.length, writes); assert.equal(c.state.dirty.value, true)
  c.state.discardDraft(); assert.equal(c.state.dirty.value, false); assert.deepEqual(c.ids(), ['a', 'b', 'c'])
  assert.equal(f.storage.get(f.ordering.ORDER_STORAGE_KEY), oldPreference)
  assert.equal(c.state.saveDraft(), false); assert.equal(f.writes.length, writes)
  c.effect.stop()
})

test('deleting a history offers an exact scoped inverse and does not overwrite later metadata or duplicate sequences', () => {
  const f = fixture(), c = collection(f), { api } = f, scope = c.key.value
  const first = api.recordCollectionOrder(scope, ['c', 'a', 'b'], 'custom')
  api.renameCollectionOrderHistory(scope, first.id, 'Pinned first'); api.pinCollectionOrderHistory(scope, first.id, true)
  const deleted = plain(api.getCollectionOrderHistory(scope).entries[0])
  assert.equal(c.state.removeHistory(first.id), true); assert.equal(f.undoOffers.length, 1)
  const later = api.recordCollectionOrder(scope, ['b', 'c', 'a'], 'custom')
  api.renameCollectionOrderHistory(scope, later.id, 'Later name'); api.setCollectionOrderHistoryLimit(scope, 3)
  c.key.value = 'netease:8:playlist:42'
  f.undoOffers[0].undo()
  const restored = api.getCollectionOrderHistory(scope)
  assert.equal(restored.limit, 3); assert.deepEqual(plain(restored.entries.find(row => row.id === first.id)), deleted)
  assert.equal(restored.entries.find(row => row.id === later.id).name, 'Later name'); assert.equal(c.state.history.value.length, 0)
  const writes = f.writes.length; f.undoOffers[0].undo(); assert.equal(f.writes.length, writes)
  assert.equal(api.restoreDeletedCollectionOrder(scope, { ...deleted, id: 'other-id' }), 'exists')
  assert.equal(f.writes.length, writes); c.effect.stop()
})

test('an undo that would evict a later automatic order waits for a larger limit instead of destroying it', () => {
  const f = fixture(), c = collection(f), { api } = f, scope = c.key.value
  api.setCollectionOrderHistoryLimit(scope, 1)
  const removed = api.recordCollectionOrder(scope, ['c', 'a', 'b'], 'custom')
  c.state.removeHistory(removed.id)
  const later = api.recordCollectionOrder(scope, ['b', 'c', 'a'], 'custom')
  assert.throws(() => f.undoOffers[0].undo(), /restoreHistoryFull/)
  assert.deepEqual(plain(api.getCollectionOrderHistory(scope).entries.map(row => row.id)), [later.id])
  api.setCollectionOrderHistoryLimit(scope, 2); f.undoOffers[0].undo()
  assert.equal(api.getCollectionOrderHistory(scope).entries.length, 2); c.effect.stop()
})

test('a malformed scope shard cannot erase the valid legacy copy during migration', () => {
  const scope = 'bundle:one', legacy = { [scope]: { limit: 2, entries: [{ id: 'one', createdAt: 100, mode: 'custom', keys: ['a'], name: 'Keep me' }] } }
  const storage = new Map([['vutron:collection-order-history:v1', JSON.stringify(legacy)], ['vutron:collection-order-history:v2:' + encodeURIComponent(scope), '{broken-json']])
  const f = fixture(storage)
  assert.equal(f.api.getCollectionOrderHistory(scope).entries[0].name, 'Keep me')
  assert.equal(storage.has(f.api.ORDER_HISTORY_STORAGE_KEY), false)
  assert.equal(fixture(storage).api.getCollectionOrderHistory(scope).entries[0].name, 'Keep me')
})

test('active-preference quota failure after a successful remote change keeps the draft and retries without rewriting history', () => {
  const f = fixture(), c = collection(f)
  c.state.commit(['c', 'a', 'b']); c.state.prepareDraftSave()
  const historyWrites = f.writes.filter(([key]) => key !== f.ordering.ORDER_STORAGE_KEY).length
  f.failKey(f.ordering.ORDER_STORAGE_KEY)
  assert.throws(() => c.state.saveDraft(), /Quota fixture/)
  assert.equal(c.state.savedMode.value, 'original'); assert.equal(c.state.dirty.value, true)
  c.source.value = c.state.ordered.value.slice() // Authoritative refresh after the already-successful cloud operation.
  f.failKey(undefined); assert.equal(c.state.saveDraft(), true)
  assert.equal(f.writes.filter(([key]) => key !== f.ordering.ORDER_STORAGE_KEY).length, historyWrites)
  assert.equal(c.state.dirty.value, false); c.effect.stop()
})

test('visiting many playlists releases older in-memory histories while their full saved versions remain available', () => {
  const f = fixture(), { api } = f
  for (let index = 0; index < 12; index++) api.recordCollectionOrder('bundle:' + index, ['b', 'a-' + index], 'custom')
  const firstKey = api.collectionOrderHistoryStorageKey('bundle:0'), before = f.reads.get(firstKey) || 0, writes = f.writes.length
  assert.deepEqual(plain(api.getCollectionOrderHistory('bundle:0').entries[0].keys), ['b', 'a-0'])
  assert.equal(f.reads.get(firstKey), before + 1, 'An evicted history is read from its own shard when revisited')
  for (let index = 0; index < 50; index++) api.getCollectionOrderHistory('bundle:0')
  assert.equal(f.reads.get(firstKey), before + 1); assert.equal(f.writes.length, writes)
  assert.equal(Object.keys(api.exportCollectionOrderHistories()).length, 12)
})

test('prepared complete orders survive one- and two-row server refreshes without partial histories or lost off-page changes', () => {
  for (const [desired, partial] of [[['c', 'a', 'b'], ['c', 'a']], [['a', 'c', 'b'], ['a']], [['a', 'c', 'b'], ['a', 'c']]]) {
    const f = fixture(), c = collection(f), complete = c.source.value.slice()
    c.state.commit(desired); assert.equal(c.state.prepareDraftSave(), true)
    const history = plain(c.state.history.value), writes = f.writes.length
    assert.ok(history.every(entry => entry.keys.length === 3))
    c.source.value = partial.map(key => complete.find(row => row.localKey === key))
    assert.equal(c.state.dirty.value, true, 'An already-prepared save stays pending when its moved track falls outside the refreshed page')
    assert.equal(c.state.saveDraft(), true)
    assert.equal(f.writes.length, writes + 1, 'Only the complete active preference is committed after the cloud response')
    assert.deepEqual(plain(c.state.history.value), history)
    assert.deepEqual(plain(c.state.savedKeys.value), desired)
    assert.deepEqual(JSON.parse(f.storage.get(f.ordering.ORDER_STORAGE_KEY))[c.key.value].keys, desired)
    c.source.value = complete
    assert.deepEqual(c.ids(), desired); assert.equal(c.state.dirty.value, false); c.effect.stop()
  }
})

test('saved custom and server views switch without editing, archiving or replacing the saved custom keys', () => {
  const f = fixture(), c = collection(f)
  c.state.commit(['c', 'a', 'b']); c.state.saveDraft()
  const history = plain(c.state.history.value), historyWrites = f.writes.filter(([key]) => key !== f.ordering.ORDER_STORAGE_KEY).length
  assert.equal(c.state.selectView('original'), true)
  assert.equal(c.state.mode.value, 'original'); assert.equal(c.state.savedMode.value, 'original')
  assert.equal(c.state.dirty.value, false); assert.equal(c.state.sequenceDirty.value, false)
  assert.deepEqual(c.ids(), ['a', 'b', 'c']); assert.deepEqual(plain(c.state.savedKeys.value), ['c', 'a', 'b'])
  assert.equal(c.state.saveDraft(), false)
  const writes = f.writes.length; c.state.selectView('original'); assert.equal(f.writes.length, writes)
  assert.equal(c.state.selectView('custom'), true); assert.deepEqual(c.ids(), ['c', 'a', 'b'])
  assert.equal(c.state.dirty.value, false); assert.equal(c.state.prepareDraftSave(), false)
  assert.equal(f.writes.filter(([key]) => key !== f.ordering.ORDER_STORAGE_KEY).length, historyWrites)
  assert.deepEqual(plain(c.state.history.value), history)
  c.effect.stop()
  const recreated = collection(fixture(f.storage)); assert.deepEqual(recreated.ids(), ['c', 'a', 'b']); assert.equal(recreated.state.dirty.value, false); recreated.effect.stop()
})

test('actual named sorting and new presets remain editable while server-view switching refuses to erase them', () => {
  const f = fixture(), c = collection(f, 'netease:7:playlist:42', ['Zulu', 'Alpha', 'Beta'])
  c.state.mode.value = 'title'
  assert.equal(c.state.dirty.value, true); assert.equal(c.state.sequenceDirty.value, true)
  assert.deepEqual(c.ids(), ['Alpha', 'Beta', 'Zulu'])
  assert.equal(c.state.selectView('original'), false); assert.equal(c.state.mode.value, 'title')
  c.state.discardDraft(); assert.equal(c.state.selectView('original'), true); assert.equal(c.state.dirty.value, false)
  const preset = f.api.recordCollectionOrder(c.key.value, ['Beta', 'Zulu', 'Alpha'], 'custom')
  assert.equal(c.state.loadHistory(preset.id), true); assert.equal(c.state.dirty.value, true)
  assert.equal(c.state.selectView('original'), false); assert.deepEqual(c.ids(), ['Beta', 'Zulu', 'Alpha'])
  c.state.saveDraft(); assert.equal(c.state.dirty.value, false)
  assert.equal(c.state.selectView('original'), true); assert.deepEqual(c.ids(), ['Zulu', 'Alpha', 'Beta'])
  c.effect.stop()
})

test('loading the already-visible saved preset is a no-op and stays clean', () => {
  const f = fixture(), c = collection(f)
  c.state.commit(['c', 'a', 'b']); c.state.saveDraft()
  const id = c.state.recentCustomId.value, writes = f.writes.length, history = plain(c.state.history.value)
  assert.equal(c.state.loadHistory(id), true)
  assert.equal(c.state.dirty.value, false); assert.equal(c.state.sequenceDirty.value, false)
  assert.equal(c.state.saveDraft(), false); assert.equal(f.writes.length, writes)
  assert.deepEqual(plain(c.state.history.value), history); c.effect.stop()
})
