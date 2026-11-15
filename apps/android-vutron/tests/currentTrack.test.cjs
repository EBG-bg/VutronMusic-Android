const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const { computed, ref } = require('vue')
const moduleUnderTest = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/platform/currentTrack.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: moduleUnderTest, exports: moduleUnderTest.exports })
const { isCurrentTrack, isCurrentPluginTrack } = moduleUnderTest.exports
const track = fields => ({ id: 42, name: 'Track', ...fields })

test('online and audio-cache copies share the recording, but native account scopes remain separate', () => {
  const online = track({ playlistOrderScope: 'netease:7' }), cache = track({ cached: true, localUri: 'file:///cache/42.audio' })
  assert.equal(isCurrentTrack(cache, online, 'netease:7'), true)
  assert.equal(isCurrentTrack(cache, online, 'netease:8'), false)
  assert.equal(isCurrentTrack(track({ id: 100, neteaseId: 42 }), online, 'netease:7'), true)
  assert.equal(isCurrentTrack(track({ id: 0 }), track({ id: 0 })), false)
  assert.equal(isCurrentTrack(cache, undefined), false)
})

test('local files and CUE segments do not highlight a different recording sharing an id', () => {
  const local = track({ localUri: 'content://music/a', localFolderId: 'folder-a' })
  assert.equal(isCurrentTrack({ ...local }, local), true)
  assert.equal(isCurrentTrack({ ...local, localUri: 'content://music/b' }, local), false)
  assert.equal(isCurrentTrack({ ...local, localFolderId: 'folder-b', playlistVolumeKey: 'another-list' }, local), true)
  assert.equal(isCurrentTrack(track({}), local), false)
  const cue = { ...local, cueTrackNo: 2, cueOffsetMs: 120000 }
  assert.equal(isCurrentTrack({ ...cue }, cue), true)
  assert.equal(isCurrentTrack({ ...cue, cueTrackNo: 1, cueOffsetMs: 0 }, cue), false)
  assert.equal(isCurrentTrack(local, cue), false)
})

test('restored imported entries retain their collection identity and plugins require exact account scopes', () => {
  const restored = track({ localPlaylistId: 'restored:a', localEntryKey: 'entry-1' })
  assert.equal(isCurrentTrack({ ...restored }, restored), true)
  assert.equal(isCurrentTrack({ ...restored, localPlaylistId: 'restored:b' }, restored), false)
  const plugin = track({ pluginId: 'kugou', pluginTrackId: '42', pluginAccountScope: 'account-a' })
  assert.equal(isCurrentTrack({ ...plugin, cached: true, localUri: 'file:///cache/plugin.audio' }, plugin), true)
  assert.equal(isCurrentTrack({ ...plugin, pluginAccountScope: 'account-b' }, plugin), false)
  assert.equal(isCurrentTrack(track({}), plugin), false)
  assert.equal(isCurrentPluginTrack({ id: 42, name: 'Track', sourceContext: {} }, plugin, 'kugou', 'account-a'), true)
  assert.equal(isCurrentPluginTrack({ id: 42, name: 'Track', sourceContext: {} }, plugin, 'kugou', 'account-b'), false)
  assert.equal(isCurrentPluginTrack({ id: 42, name: 'Track', sourceContext: {} }, plugin, 'kugou'), false)
})

test('stable recording metadata skips native-list scans on progress and pause updates, then reacts to the next track', () => {
  const playback = ref({ track: track({ id: 1800, playlistOrderScope: 'netease:7' }), position: 0, playing: true })
  const recording = computed(() => playback.value.track), rows = Array.from({ length: 2000 }, (_, id) => track({ id: id + 1 }))
  let scans = 0, reads = 0
  const index = computed(() => { scans++; return rows.findIndex(row => { reads++; return isCurrentTrack(row, recording.value, 'netease:7') }) })
  assert.equal(index.value, 1799); const firstReads = reads
  for (let sample = 1; sample <= 8; sample++) {
    playback.value = { ...playback.value, position: sample * 1000, playing: sample < 8 }
    assert.equal(index.value, 1799)
  }
  assert.equal(scans, 1); assert.equal(reads, firstReads, 'Position and pause snapshots reuse the cached native index')
  playback.value = { ...playback.value, track: track({ id: 1801, playlistOrderScope: 'netease:7' }) }
  assert.equal(index.value, 1800); assert.equal(scans, 2)
})

test('stable recording metadata skips plugin-list scans but account metadata changes still invalidate the marker', () => {
  const playback = ref({ track: track({ pluginId: 'fixture', pluginTrackId: 'item-1500', pluginAccountScope: 'account-a' }), position: 0 })
  const recording = computed(() => playback.value.track), rows = Array.from({ length: 2000 }, (_, id) => ({ id: 'item-' + id, name: 'Track', sourceContext: {} }))
  let scans = 0
  const index = computed(() => { scans++; return rows.findIndex(row => isCurrentPluginTrack(row, recording.value, 'fixture', 'account-a')) })
  assert.equal(index.value, 1500)
  for (let sample = 1; sample <= 8; sample++) { playback.value = { ...playback.value, position: sample * 1000 }; assert.equal(index.value, 1500) }
  assert.equal(scans, 1)
  playback.value.track.pluginAccountScope = 'account-b'
  assert.equal(index.value, -1); assert.equal(scans, 2, 'Reactive identity fields still invalidate a stable object reference')
  playback.value = { ...playback.value, track: track({ pluginId: 'fixture', pluginTrackId: 'item-1501', pluginAccountScope: 'account-a' }) }
  assert.equal(index.value, 1501); assert.equal(scans, 3)
})
