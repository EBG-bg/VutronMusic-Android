const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), vue = require('vue')
function fixture() {
  const calls = [], reloads = [], offers = [], confirmations = [], busy = vue.ref(false)
  const plugin = {
    async manageLocalLibrary(options) { calls.push(options); return options.action.startsWith('restore') ? { changed: true } : { changed: true, undoToken: 'exact-group', removedCount: options.tracks.length } },
    async deleteCachedTracks(options) { calls.push(options); return { removed: options.trackIds.length, skipped: 0, failed: 0 } }
  }
  const store = { error: '', async reloadManagedLibrary(options) { reloads.push(options) }, async loadCacheStatus() { reloads.push('cache') } }
  const module = { exports: {} }, source = fs.readFileSync(path.join(__dirname, '../src/composables/libraryManagement.ts'), 'utf8')
  const deps = { '../stores/androidShell': { useAndroidShellStore: () => store }, '../platform/vutronPlugin': { vutronPlugin: plugin },
    '../platform/i18n': { translate: key => key }, '../platform/actionDialog': { askAction: async options => { confirmations.push(options); return 'confirm' } },
    '../platform/libraryActivity': { libraryMutationBusy: busy }, '../platform/undo': { offerUndo: options => offers.push(options) }, '../platform/undoMessages': { undoText: key => key } }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: id => deps[id], Set })
  return { api: module.exports.useLibraryManagement(), plugin, store, calls, reloads, offers, confirmations, busy }
}
const tracks = [{ id: 1, name: 'One', localUri: 'content://audio/1' }, { id: 2, name: 'Two', localUri: 'content://audio/2' }]
test('batch removal uses one native transaction and one refresh with an exact grouped inverse', async () => {
  const f = fixture(); assert.equal(await f.api.removeLocalTracks(tracks), true)
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].action, 'removeTracks'); assert.deepEqual(f.calls[0].tracks, tracks)
  assert.equal(f.confirmations.length, 1); assert.equal(f.reloads.length, 1); assert.equal(f.offers.length, 1)
  await f.offers[0].undo(); assert.equal(f.calls[1].action, 'restoreRemoval'); assert.equal(f.calls[1].recordId, 'exact-group')
  assert.equal(f.reloads[1].refreshLocalSnapshots, true); assert.equal(f.busy.value, false)
})
test('no-op native response performs no refresh and offers no fake inverse', async () => {
  const f = fixture(); f.plugin.manageLocalLibrary = async () => ({ changed: false })
  assert.equal(await f.api.removeLocalTracks(tracks), false); assert.equal(f.reloads.length, 0); assert.equal(f.offers.length, 0)
})
test('batch cache deletion deduplicates IDs, refreshes once and reports partial failure', async () => {
  const f = fixture(); f.plugin.deleteCachedTracks = async options => { f.calls.push(options); return { removed: 1, skipped: 1, failed: 0 } }
  assert.equal(await f.api.deleteCachedTracks([{ id: 1, name: 'One', cached: true }, { id: 1, name: 'Duplicate', cached: true }, { id: 2, name: 'Playing', cached: true }]), false)
  assert.deepEqual(Array.from(f.calls[0].trackIds), [1, 2]); assert.equal(f.reloads.length, 1); assert.equal(f.store.error, 'partialCache'); assert.equal(f.offers.length, 0)
})
test('duplicate activation during a pending confirmation does not submit a second native mutation', async () => {
  const f = fixture(), pending = f.api.removeLocalTracks(tracks), duplicate = f.api.removeLocalTracks(tracks)
  assert.equal(await duplicate, false); assert.equal(await pending, true); assert.equal(f.calls.length, 1); assert.equal(f.confirmations.length, 1)
})
