// Synthetic bridges for the real App source integration check. No real accounts,
// imported files or remote services are read by this fixture.
import builtinIndex from '../../../../vendor/android-runtime/src/main/assets/sources-runtime/plugins/builtin-index.json'
import { vutronPlugin as nativeBase, offlineTestBackend } from './offline-native.mock.js'

// Capacitor serializes bridge payloads; Vue proxy objects are valid at that boundary.
const clone = value => JSON.parse(JSON.stringify(value))
const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#193c54"/><circle cx="250" cy="135" r="94" fill="#1db9b5"/><path d="M0 320L140 160L400 400H0Z" fill="#e5a46c"/></svg>')
const context = (owner, id) => ({ owner, originalId: id, opaque: ['unchanged', id] })
const methods = ['systemPing', 'getAccount', 'getBanner', 'getRecommendPlaylist', 'getRecommendTracks', 'userPlaylist', 'getAllTracks', 'getPlaylistDetail', 'getPlaylistTracks', 'search', 'getTrackDetail', 'getLyric', 'likelist', 'likeATrack', 'addOrRemoveTracksToPlaylist']
const originals = builtinIndex.map(row => ({ ...clone(row), baseId: row.id, builtIn: true, installed: true, enabled: ['netease', 'local'].includes(row.id), accountScope: 'native-duplicate-' + row.id }))
let plugins = [...originals,
  { id: 'fixture', baseId: 'fixture', name: 'Alpha library', type: 'library', enabled: true, builtIn: false, installed: true, accountScope: 'alpha-account', status: 'login', methods, capabilities: { getLyric: true } },
  { id: 'fixture:second', baseId: 'fixture', name: 'Beta library', type: 'library', enabled: true, builtIn: false, installed: true, accountScope: 'beta-account', status: 'login', methods, capabilities: { getLyric: true } }
]
const source = id => plugins.find(row => row.id === id)
const label = id => id === 'fixture' ? 'Alpha' : 'Beta'
const tracks = id => [1, 2].map(index => ({ id: 'song-' + index, name: label(id) + ' song ' + index, pluginId: id, sourceContext: context(id, 'song-' + index), picUrl: picture, duration: 180000, playable: true, artists: [{ id: 'artist', name: label(id) + ' artist', sourceContext: context(id, 'artist') }] }))
const playlist = id => ({ id: 'playlist-1', name: label(id) + ' playlist', pluginId: id, sourceContext: context(id, 'playlist-1'), picUrl: picture, trackCount: 2, isMine: true, creator: { userId: label(id) + '-user', nickname: label(id) + ' listener' } })
const snapshot = () => ({ plugins: clone(plugins), catalog: [] })
const calls = [], held = []
let hold, current, playing = false, queue = { tracks: [], index: -1, upNext: [], mode: 0 }
const record = (method, value = {}) => calls.push({ method, ...clone(value) })
const nativeTrack = (track, pluginId, accountScope) => ({ id: (pluginId === 'fixture' ? 1000 : 2000) + Number(String(track.id).split('-').at(-1)), name: track.name, artists: track.artists?.map(row => row.name) || [], duration: track.duration || 180000, picUrl: track.picUrl, pluginId, pluginTrackId: String(track.id), pluginTrack: clone(track), pluginSourceContext: clone(track.sourceContext), pluginAccountScope: accountScope })

export const musicSourcesBackend = {
  calls, held, picture,
  get plugins() { return plugins },
  setNativeLogin(value) { localStorage.setItem('source-integration:native-login', String(value)) },
  setConnected: offlineTestBackend.setConnected,
  holdNext(pluginId, method) { hold = { pluginId, method } },
  releaseHeld() { for (const complete of held.splice(0)) complete() },
  setEnabled(id, enabled) { source(id).enabled = enabled; return snapshot() },
  remove(id) { plugins = plugins.filter(row => row.id !== id); return snapshot() },
  snapshot
}

export const musicPluginBridge = {
  async listMusicPlugins() { record('list'); return snapshot() },
  async manageMusicPlugin(params) {
    record('manage', { params })
    if (params.action === 'sourcePriorities') return { lyric: ['self'], comment: ['self'] }
    const plugin = source(params.id)
    if (!plugin) throw new Error('Unknown synthetic source')
    if (params.action === 'enable') plugin.enabled = true
    else if (params.action === 'disable') plugin.enabled = false
    else if (params.action === 'remove') plugins = plugins.filter(row => row.id !== params.id)
    else throw new Error('Unexpected synthetic management operation: ' + params.action)
    return snapshot()
  },
  async resolveMusicPluginArtwork({ uri }) { return { uri } },
  async getMusicPluginPlaylistProgress() { return { available: false } },
  async callMusicPlugin({ pluginId, accountScope, method, params }) {
    record('call', { pluginId, accountScope, operation: method, params })
    const plugin = source(pluginId)
    if (!plugin?.enabled || accountScope !== plugin.accountScope) throw new Error('Synthetic source unavailable or account scope changed')
    const mode = await nativeBase.getLocalOnly()
    if (mode.manual || !mode.connected) throw new Error('Unexpected network call in offline mode')
    let result
    if (method === 'systemPing') result = { code: 200, status: 'login' }
    else if (method === 'getAccount') result = { code: 200, userName: label(pluginId) + '-listener' }
    else if (method === 'getBanner') result = { code: 200, data: [{ id: 'banner-1', sourceId: 'playlist-1', name: label(pluginId) + ' banner', picUrl: picture, type: 'playlist', sourceContext: context(pluginId, 'playlist-1') }] }
    else if (method === 'getRecommendPlaylist') result = { code: 200, data: [playlist(pluginId)], count: 1, sourceContext: {} }
    else if (method === 'userPlaylist') result = { code: 200, playlists: [playlist(pluginId)], albums: [], sourceContext: {} }
    else if (method === 'getPlaylistDetail') result = { code: 200, data: { ...playlist(pluginId), tracks: tracks(pluginId), trackIds: ['song-1', 'song-2'] } }
    else if (method === 'getPlaylistTracks' || method === 'getAllTracks' || method === 'getRecommendTracks') result = { code: 200, data: tracks(pluginId), count: 2, sourceContext: {} }
    else if (method === 'search') result = { code: 200, data: params.tab === 'playlists' ? [playlist(pluginId)] : tracks(pluginId).map(row => ({ ...row, name: row.name + ' · ' + params.keywords })), count: 2, sourceContext: {} }
    else if (method === 'getTrackDetail') result = { code: 200, data: tracks(pluginId).filter(row => params.tracks.some(wanted => wanted.id === row.id)) }
    else if (method === 'getLyric') result = { code: 200, lrc: '[00:00.00]' + label(pluginId) + ' lyric' }
    else if (method === 'likelist') result = { code: 200, data: [], count: 0, sourceContext: {} }
    else if (method === 'likeATrack' || method === 'addOrRemoveTracksToPlaylist') result = { code: 200 }
    else throw new Error('Unexpected synthetic plugin operation: ' + method)
    if (hold?.pluginId === pluginId && hold.method === method) {
      hold = undefined
      await new Promise(resolve => held.push(resolve))
    }
    return clone(result)
  }
}

export const vutronPlugin = {
  ...nativeBase,
  async getSession() { record('nativeSession'); return localStorage.getItem('source-integration:native-login') === 'false' ? { loggedIn: false } : { loggedIn: true, profile: { userId: 7, nickname: 'Native listener', avatarUrl: picture } } },
  async getHomeData() { record('nativeHome'); return { banners: [], playlists: [{ id: 71, name: 'Native playlist', trackCount: 1, picUrl: picture }], artists: [], albums: [], charts: [], dailyTracks: [] } },
  async getPlaylists() { record('nativeLibrary'); return { playlists: [{ id: 71, name: 'Native playlist', trackCount: 1, picUrl: picture }] } },
  async search(params) { record('nativeSearch', { params }); return { items: [{ id: 81, name: 'Native search ' + params.keywords, artists: ['Native artist'] }], count: 1, page: 1, nextPage: 2 } },
  async getPlaybackState() { return current ? { trackId: current.id, title: current.name, artist: current.artists?.join(' / ') || '', track: clone(current), duration: current.duration || 180000, position: 2000, playing, error: '' } : { playing: false, trackId: 0, duration: 0, position: 0, title: '', artist: '', error: '' } },
  async getPlaybackQueue() { return clone(queue) },
  async playMusicPlugin(value) { record('pluginPlay', { value }); current = nativeTrack(value.track, value.pluginId, value.accountScope); queue = { tracks: value.queue.map(row => nativeTrack(row, value.pluginId, value.accountScope)), index: 0, upNext: [], mode: 0 }; playing = true; return { track: clone(current) } },
  async queueMusicPlugin(value) { record('pluginQueue', { value }); queue.upNext.push(nativeTrack(value.track, value.pluginId, value.accountScope)); return clone(queue) },
  async play(value) { record('nativePlay', { value }); current = clone(value.track); queue = { tracks: clone(value.queue || [value.track]), index: value.index || 0, upNext: [], mode: 0 }; playing = true },
  async pause() { playing = false },
  async resume() { playing = true },
  async getLyrics() { return { lrc: '[00:00.00]Fixture lyric\n[00:10.00]Second line' } },
  async getVolumeSettings() { return { trackPercent: 100, playlistPercent: 100 } },
  async getPlaybackTuning() { return { speed: 1, pitch: 1, prefetchWifi: false, actualSpeed: 1, actualPitch: 1 } }
}
