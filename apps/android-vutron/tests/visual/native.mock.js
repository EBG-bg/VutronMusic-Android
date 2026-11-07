import { vutronPlugin as base } from '../fixtures/personal-ui-native.mock.js'

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#193c54"/><circle cx="250" cy="135" r="94" fill="#1db9b5"/><path d="M0 320L140 160L400 400H0Z" fill="#e5a46c"/></svg>')
const track = { id: 61, name: 'Boreal lights', artists: ['Vutron Demo Ensemble'], duration: 180000, picUrl: picture, playlistVolumeKey: 'visual:playlist', playlistVolumeName: 'Evening collection' }
const playlists = ['Evening collection', '長い名前のプレイリスト — 夜間音樂', 'Instrumental recordings', 'A quiet morning'].map((name, index) => ({ id: 71 + index, name, picUrl: picture, trackCount: 12 + index, createTime: index + 1, creatorUserId: 7, subscribed: false, privacy: 0 }))
const sourceSettingsKey = 'visual-audio-source-settings'
export const visualNativeBackend = { sourceWrites: 0 }
export const vutronPlugin = {
  ...base,
  async getSourceSettings() { return { autoMatch: localStorage.getItem(sourceSettingsKey) !== 'false' } },
  async updateSourceSettings({ autoMatch }) { visualNativeBackend.sourceWrites++; localStorage.setItem(sourceSettingsKey, String(autoMatch)); return this.getSourceSettings() },
  async getSession() { return { loggedIn: true, profile: { userId: 7, nickname: 'Demo listener', avatarUrl: picture } } },
  async getPlaybackState() { return { ...await base.getPlaybackState(), track, trackId: track.id, title: track.name, artist: track.artists[0], duration: track.duration, position: 2000, playing: false, quality: 'FLAC · 44.1 kHz', cover: picture, error: '' } },
  async getLyrics() { return { lrc: '[00:00.00]Boreal lights\n[00:02.00]A quiet song beyond the city\n[00:10.00]夜空下緩緩流動的旋律\n[00:20.00]Let the evening settle', tlyric: '[00:02.00]城市之外的一首安靜的歌' } },
  async getPlaylists() { return { playlists } },
  async getPlaylistTracks() { return { tracks: [track] } },
  async getLocalMusicIndex() { return { tracks: [], indexed: true, updatedAt: Date.now() } },
  async getLocalLibrary() { return { folders: [], playlists: [] } },
  async getHomeData() { return { banners: [], playlists, artists: [], albums: [], charts: [], dailyTracks: [] } }
}
