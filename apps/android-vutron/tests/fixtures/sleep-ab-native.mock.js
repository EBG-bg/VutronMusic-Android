import { vutronPlugin as base } from './sliders-native.mock.js'
import { featureBackend } from './features-native.mock.js'
const key = 'sleep-ab-fixture'
const saved = JSON.parse(localStorage.getItem(key) || '{}')
const fixture = {
  position: 10000, trackId: 61, calls: [], abReads: 0, prepared: true,
  loop: { trackKey: 'track:61', trackId: 61, startMs: -1, endMs: -1, enabled: false, minSpanMs: 500, durationMs: 180000 },
  timer: { active: false, mode: 'duration', remainingMs: 0, deadlineMs: 0, remainingTracks: 0, fadeSeconds: 0 },
  ...saved
}
const save = () => localStorage.setItem(key, JSON.stringify({ loop: { ...fixture.loop, enabled: false }, timer: fixture.timer }))
featureBackend.sleepAb = fixture
featureBackend.setSleepAbPosition = position => { fixture.position = position }
featureBackend.completeSleepAbTrack = () => {
  if (!fixture.timer.active) return
  if (fixture.timer.mode === 'track') fixture.timer.active = false
  if (fixture.timer.mode === 'count' && --fixture.timer.remainingTracks <= 0) fixture.timer.active = false
}
featureBackend.changeSleepAbTrack = trackId => {
  fixture.trackId = trackId; fixture.loop = { ...fixture.loop, trackKey: 'track:' + trackId, trackId, startMs: -1, endMs: -1, enabled: false }
}
export const vutronPlugin = {
  ...base,
  async seek(value) { fixture.calls.push(['seek', value.position]); fixture.position = value.position; return base.seek(value) },
  async getPlaybackState() { return { ...await base.getPlaybackState(), trackId: fixture.trackId, track: { ...featureBackend.track, id: fixture.trackId }, position: fixture.position, abLoopEnabled: fixture.loop.enabled, ...(fixture.loop.enabled ? { abLoop: structuredClone(fixture.loop) } : {}) } },
  async getAbLoop() { fixture.abReads++; return fixture.prepared ? { ...structuredClone(fixture.loop), positionMs: fixture.position } : { trackKey: '', trackId: 0, startMs: -1, endMs: -1, enabled: false, minSpanMs: 500, durationMs: 0, positionMs: 0 } },
  async setAbLoop(patch) {
    fixture.calls.push(['ab', structuredClone(patch)])
    if (patch.expectedTrackKey !== fixture.loop.trackKey) throw new Error('The current track changed')
    const next = patch.action === 'clear' ? { ...fixture.loop, startMs: -1, endMs: -1, enabled: false } : { ...fixture.loop, ...patch }
    if (next.enabled && (next.startMs < 0 || next.endMs - next.startMs < 500 || next.endMs > next.durationMs)) throw new Error('Invalid A/B range')
    if (next.enabled && fixture.timer.active && fixture.timer.mode !== 'duration') throw new Error('Track-completion timer conflicts with looping')
    fixture.loop = next; save(); return structuredClone(next)
  },
  async getSleepTimer() {
    const timer = fixture.timer
    if (timer.mode === 'duration') { timer.remainingMs = Math.max(0, timer.deadlineMs - Date.now()); if (!timer.remainingMs) timer.active = false }
    return structuredClone(timer)
  },
  async setSleepTimer(options) {
    fixture.calls.push(['timer', structuredClone(options)])
    if (options.mode !== 'duration' && fixture.loop.enabled) throw new Error('A/B looping conflicts with track-completion timer')
    fixture.timer = { active: true, mode: options.mode || 'duration', remainingMs: options.durationMs || 0, deadlineMs: options.mode === 'duration' ? Date.now() + options.durationMs : 0, remainingTracks: options.mode === 'count' ? options.trackCount : options.mode === 'track' ? 1 : 0, fadeSeconds: options.fadeSeconds || 0 }
    save(); return this.getSleepTimer()
  },
  async clearSleepTimer() { fixture.calls.push(['cancelTimer']); fixture.timer = { ...fixture.timer, active: false, remainingMs: 0, deadlineMs: 0, remainingTracks: 0 }; save(); return this.getSleepTimer() }
}
