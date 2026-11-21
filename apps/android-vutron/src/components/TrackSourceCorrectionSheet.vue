<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useModalFocus } from '../composables/modalFocus'
import { useModalIsolation } from '../composables/modalIsolation'
import { useSheetDrag } from '../composables/sheetDrag'
import { vutronPlugin, type VutronTrack, type VutronTrackSourceMatch } from '../platform/vutronPlugin'
import OriginalIcon from './OriginalIcon.vue'
import SheetDragHandle from './SheetDragHandle.vue'

const props = defineProps<{ track: VutronTrack }>()
const emit = defineEmits<{ close: []; saved: [message: string] }>()
const { t } = useI18n()
const panel = ref<HTMLElement>(), matches = ref<VutronTrackSourceMatch[]>([]), override = ref('')
const selected = ref(''), busy = ref(false), error = ref('')
const trackId = computed(() => props.track.neteaseId || props.track.id)

function provider(source: string) { return t(`mobile.plugins.audioProviderNames.${source}`) }
function duration(value: number) {
  if (!value) return t('mobile.trackSource.unknownDuration')
  const seconds = Math.floor(value / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
function quality(match: VutronTrackSourceMatch) {
  return match.lossless ? 'FLAC' : match.bitrate > 0 ? `${Math.round(match.bitrate / 1000)} kbps` : t('mobile.trackSource.unknownQuality')
}
async function load() {
  if (busy.value) return
  busy.value = true; error.value = ''; matches.value = []
  try {
    const result = await vutronPlugin.getTrackSourceMatches({ trackId: trackId.value })
    matches.value = Array.isArray(result.matches) ? result.matches : []
    override.value = result.override || ''
    selected.value = override.value
  } catch (cause) { error.value = cause instanceof Error ? cause.message : t('mobile.trackSource.failed') }
  finally { busy.value = false }
}
async function save(source: string) {
  if (busy.value || source === override.value) return
  busy.value = true; error.value = ''
  try {
    await vutronPlugin.setTrackSourceOverride({ trackId: trackId.value, source })
    const message = source ? t('mobile.trackSource.saved', { source: provider(source) }) : t('mobile.trackSource.restored')
    emit('saved', message); emit('close')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : t('mobile.trackSource.saveFailed') }
  finally { busy.value = false }
}
useModalFocus(panel, { close: () => emit('close') })
useModalIsolation(panel)
useSheetDrag(panel, { close: () => emit('close'), enabled: () => !busy.value })
onMounted(() => { void load() })
</script>

<template>
  <Teleport to="body">
    <div class="track-source-layer" @click.self="!busy && emit('close')">
      <section ref="panel" class="track-source-sheet" role="dialog" aria-modal="true" :aria-label="t('mobile.trackSource.title')" tabindex="-1">
        <SheetDragHandle @close="!busy && emit('close')" />
        <header><div><h3>{{ t('mobile.trackSource.title') }}</h3><p>{{ track.name }}</p></div><button type="button" class="icon-button" :disabled="busy" :aria-label="t('mobile.common.close')" @click="emit('close')"><OriginalIcon name="close" /></button></header>
        <p class="setting-note">{{ t('mobile.trackSource.hint') }}</p>
        <p v-if="busy" class="setting-note" role="status">{{ t('mobile.trackSource.searching') }}</p>
        <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
        <div v-if="matches.length" class="track-source-candidates" :aria-label="t('mobile.trackSource.candidates')">
          <button v-for="match in matches" :key="match.source" type="button" class="track-source-candidate" :class="{ selected: selected === match.source }" :aria-pressed="selected === match.source" :disabled="busy" @click="selected = match.source">
            <span class="track-source-check"><OriginalIcon v-if="selected === match.source" name="check" /></span>
            <span class="track-source-copy"><b>{{ provider(match.source) }}</b><span>{{ match.name }}</span><small>{{ match.artists.join(' / ') }}<template v-if="match.album"> · {{ match.album }}</template></small></span>
            <span class="track-source-meta"><small>{{ duration(match.duration) }}</small><small>{{ quality(match) }}</small></span>
          </button>
        </div>
        <p v-else-if="!busy && !error" class="setting-note">{{ t('mobile.trackSource.noMatches') }}</p>
        <p v-if="override && !matches.some(match => match.source === override)" class="track-source-current" role="status">{{ t('mobile.trackSource.savedProvider', { source: provider(override) }) }}</p>
        <div class="track-source-actions">
          <button v-if="override" type="button" class="text-button" :disabled="busy" @click="save('')"><OriginalIcon name="refresh" />{{ t('mobile.trackSource.restoreAutomatic') }}</button>
          <button type="button" class="secondary-button" :disabled="busy || !selected || selected === override" @click="save(selected)">{{ t('mobile.trackSource.saveChoice') }}</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.track-source-layer{position:fixed;inset:0;z-index:145;display:flex;align-items:flex-end;justify-content:center;background:var(--scrim);padding-top:max(12px,env(safe-area-inset-top))}.track-source-sheet{width:min(100%,640px);max-height:90dvh;overflow:auto;overscroll-behavior:contain;padding:16px max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));border:1px solid var(--line);border-bottom:0;border-radius:var(--radius-sheet) var(--radius-sheet) 0 0;background:var(--color-body-bg);color:var(--color-text);box-shadow:var(--shadow-sheet);animation:track-source-in var(--motion-panel) ease both}.track-source-sheet header{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-bottom:10px;border-bottom:1px solid var(--line)}.track-source-sheet header>div{min-width:0}.track-source-sheet h3{margin:0;font-size:calc(17px * var(--ui-font-scale,1))}.track-source-sheet header p{margin:4px 0 0;color:var(--muted);overflow-wrap:anywhere}.track-source-candidates{display:grid;gap:6px;margin-top:10px}.track-source-candidate{display:grid;grid-template-columns:24px minmax(0,1fr) auto;align-items:center;gap:9px;width:100%;min-height:66px;padding:10px;border:1px solid var(--line);border-radius:var(--radius-card);background:var(--surface-card);color:inherit;text-align:left;font:inherit;transition:border-color var(--motion-control) ease,background-color var(--motion-control) ease}.track-source-candidate.selected{border-color:var(--accent);background:var(--accent-soft)}.track-source-check{display:grid;place-items:center;width:20px;height:20px;border:1px solid var(--line-strong);border-radius:50%;color:var(--accent)}.track-source-candidate.selected .track-source-check{border-color:var(--accent)}.track-source-copy,.track-source-meta{display:grid;min-width:0;gap:3px}.track-source-copy>span,.track-source-copy>small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.track-source-copy>span{font-size:calc(13px * var(--ui-font-scale,1))}.track-source-copy>small,.track-source-meta small{color:var(--muted);font-size:calc(11px * var(--ui-font-scale,1))}.track-source-meta{text-align:right}.track-source-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px}.track-source-current{padding:9px 10px;border-radius:var(--radius-card);background:var(--surface);font-size:calc(12px * var(--ui-font-scale,1))}@keyframes track-source-in{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}html[data-motion='reduced'] .track-source-sheet{animation:none}
</style>
