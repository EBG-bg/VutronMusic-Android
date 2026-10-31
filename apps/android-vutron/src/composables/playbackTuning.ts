import { computed, reactive, ref } from 'vue'
import { vutronPlugin, type VutronPlaybackTuning } from '../platform/vutronPlugin'
import { createLiveSettingWriter } from '../platform/liveSettingWrites'
import { registerLiveSettingsFlusher } from '../platform/liveSettingsLifecycle'
import { useAndroidShellStore } from '../stores/androidShell'

type TuningPatch = Partial<Pick<VutronPlaybackTuning, 'speed' | 'pitch' | 'prefetchWifi'>>
const settings = reactive<VutronPlaybackTuning>({ speed: 1, pitch: 1, prefetchWifi: false, actualSpeed: 1, actualPitch: 1, warning: '' })
const loaded = ref(false), loading = ref(false), saving = ref(false), error = ref('')
const pending = ref(false), errorKind = ref<'load' | 'save'>('load')
let readRequest = 0
let editRevision = 0
const revisions = new Map<keyof TuningPatch, number>()
const writer = createLiveSettingWriter<TuningPatch>({
  merge: (previous, next) => ({ ...previous, ...next }),
  async write(patch) {
    const revision = editRevision
    saving.value = true
    try {
      const result = await vutronPlugin.updatePlaybackTuning(patch)
      for (const key of ['speed', 'pitch', 'prefetchWifi'] as const) {
        if ((revisions.get(key) ?? 0) <= revision) {
          Object.assign(settings, { [key]: result[key] })
          revisions.delete(key)
        }
      }
      settings.actualSpeed = result.actualSpeed
      settings.actualPitch = result.actualPitch
      settings.warning = result.warning
      const store = useAndroidShellStore()
      store.playback.rate = result.actualSpeed
      store.playback.pitch = result.actualPitch
      store.playback.tuningWarning = result.warning
      error.value = ''
      pending.value = revisions.size > 0
    } finally { saving.value = false }
  },
  onError: cause => { errorKind.value = 'save'; error.value = cause instanceof Error ? cause.message : '保存播放设置失败' }
})
registerLiveSettingsFlusher(writer.flush)

async function load() {
  const request = ++readRequest, revision = editRevision
  loading.value = true
  try {
    const result = await vutronPlugin.getPlaybackTuning()
    if (request !== readRequest) return
    // A delayed read must never replace a slider draft or an uncommitted edit.
    if (revision === editRevision && !writer.pending()) Object.assign(settings, result)
    loaded.value = true
    if (!writer.pending()) error.value = ''
  } catch (cause) { if (request === readRequest) { errorKind.value = 'load'; error.value = cause instanceof Error ? cause.message : '读取播放设置失败' } }
  finally { if (request === readRequest) loading.value = false }
}
function update(patch: TuningPatch) {
  if (!loaded.value) return
  for (const key of ['speed', 'pitch'] as const) {
    const value = patch[key]
    if (value !== undefined && (!Number.isFinite(value) || value < .5 || value > 2)) return
  }
  const revision = ++editRevision
  for (const key of Object.keys(patch) as (keyof TuningPatch)[]) revisions.set(key, revision)
  Object.assign(settings, patch)
  pending.value = true
  error.value = ''
  void writer.queue(patch)
}
export function usePlaybackTuning() {
  return { settings, loading, saving, pending, error, errorKind, ready: computed(() => loaded.value), load, update, flush: writer.flush }
}
