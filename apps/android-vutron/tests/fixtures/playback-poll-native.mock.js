import { vutronPlugin as base } from './features-native.mock.js'
export { watch } from 'vue'

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#315c75"/></svg>')
export const pollingProbe = {
  artworkCalls: [], timerReads: 0, playbackReads: 0,
  deadline: Date.now() + 120000,
  state: {
    trackId: 901, title: 'Polling track', artist: 'Fixture artist', duration: 180000, position: 10000,
    playing: false, error: '', rate: 1, mode: 0,
    track: { id: 901, name: 'Polling track', artists: ['Fixture artist'], album: 'Fixture album',
      picUrl: 'https://artwork.example.invalid/901.jpg', pluginId: 'kugou:fixture', pluginTrackId: 'opaque-901', pluginAccountScope: 'fixture-a',
      pluginSourceContext: { hash: 'fixture-hash', album_id: 'a', nested: { tokens: ['public-context', 901] } },
      pluginTrack: { id: 'opaque-901', name: 'Polling track', artists: [{ id: 1, name: 'Fixture artist' }] }
    }
  }
}
export const vutronPlugin = {
  ...base,
  async getPlaybackState() { pollingProbe.playbackReads++; return structuredClone(pollingProbe.state) },
  async getSleepTimer() { pollingProbe.timerReads++; return { remainingMs: Math.max(0, pollingProbe.deadline-Date.now()), deadlineMs: pollingProbe.deadline } },
  async getLyrics() { return { lrc: '[00:01.000]Fixture lyrics' } }
}
export const musicPluginBridge = {
  async listMusicPlugins() { return { plugins: [] } },
  async resolveMusicPluginArtwork(value) {
    pollingProbe.artworkCalls.push(JSON.parse(JSON.stringify(value)));
    await new Promise(resolve => setTimeout(resolve, 5));
    return { uri: picture }
  }
}
