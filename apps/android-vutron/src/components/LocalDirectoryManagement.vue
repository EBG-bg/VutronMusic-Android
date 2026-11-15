<script setup lang="ts">
import { ref, watch } from 'vue'
import { useAndroidShellStore } from '../stores/androidShell'
import { useLibraryManagement } from '../composables/libraryManagement'
import { libraryMutationBusy } from '../platform/libraryActivity'
import { libraryTask } from '../platform/libraryTasks'
import CollapsibleSettingsCard from './CollapsibleSettingsCard.vue'
import OriginalIcon from './OriginalIcon.vue'
import { vutronPlugin, type VutronRemovedLocalTrack } from '../platform/vutronPlugin'
import { undoText } from '../platform/undoMessages'
const store = useAndroidShellStore()
const management = useLibraryManagement()
const recordsOpen = ref(false)
const records = ref<VutronRemovedLocalTrack[]>([])
const recordCount = ref(0)
const recordsLoading = ref(false)
async function loadRecords(append = false) {
  if (!vutronPlugin.getRemovedLocalTracks || recordsLoading.value) return
  recordsLoading.value = true
  try {
    const result = await vutronPlugin.getRemovedLocalTracks({ offset: append ? records.value.length : 0, limit: 80 })
    records.value = append ? [...records.value, ...result.records] : result.records
    recordCount.value = result.total ?? records.value.length
  } catch (cause) { store.error = cause instanceof Error ? cause.message : undoText('restoreFailed') }
  finally { recordsLoading.value = false }
}
async function toggleRecords() { recordsOpen.value = !recordsOpen.value; if (recordsOpen.value) await loadRecords() }
async function restoreRecord(id: string) { if (await management.restoreRemovedTrack(id)) await loadRecords() }
async function restoreAll() { if (await management.restoreRemoved()) await loadRecords() }
watch(() => store.localLibrary.excludedTrackCount, () => { if (recordsOpen.value) void loadRecords() })
</script>
<template>
  <CollapsibleSettingsCard section-id="directory-management" :title="$t('mobile.management.directories')">
    <div class="directory-management">
      <div v-for="folder in store.localLibrary.folders" :key="folder.id" class="directory-row"><span>{{ folder.name }}<small>{{ $t('mobile.common.tracks', { count: folder.trackCount }) }}</small></span><button class="text-button danger-text" type="button" :disabled="libraryMutationBusy" @click="management.removeCollection(folder, 'forgetFolder')">{{ $t('mobile.management.forgetFolder') }}</button></div>
      <button v-if="vutronPlugin.getRemovedLocalTracks" class="removed-toggle" type="button" :aria-expanded="recordsOpen" aria-controls="local-removal-records" @click="toggleRecords"><OriginalIcon name="list" /><span>{{ undoText('records') }}</span><OriginalIcon name="down" :class="{ expanded: recordsOpen }" /></button>
      <div id="local-removal-records" class="removed-records-region" :class="{ expanded: recordsOpen }" :inert="!recordsOpen">
        <div><p class="removed-hint">{{ undoText('recordsHint') }}</p><p v-if="!recordsLoading && !records.length" class="removed-hint">{{ undoText('noRecords') }}</p>
          <div v-for="record in records" :key="record.id" class="directory-row removed-track"><span>{{ record.name }}<small>{{ record.artists?.join(' / ') || record.album }}</small></span><button type="button" class="text-button" :disabled="libraryMutationBusy || libraryTask.running" @click="restoreRecord(record.id)">{{ undoText('restore') }}</button></div>
          <button v-if="records.length < recordCount" type="button" class="wide-outline-button" :disabled="recordsLoading" @click="loadRecords(true)">{{ undoText('loadMore') }}</button>
        </div>
      </div>
      <button v-if="store.localLibrary.excludedTrackCount" class="wide-outline-button" type="button" :disabled="libraryMutationBusy || libraryTask.running" @click="restoreAll">{{ $t('mobile.management.restoreRemoved') }} · {{ store.localLibrary.excludedTrackCount }}</button>
    </div>
  </CollapsibleSettingsCard>
</template>
<style scoped>
.directory-row { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-top: 1px solid var(--surface); }.directory-row > span { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: calc(12px * var(--ui-font-scale, 1)); }small { display: block; margin-top: 3px; color: var(--muted); }
.removed-toggle { display:flex; align-items:center; gap:8px; width:100%; min-height:44px; padding:8px 10px; border:0; border-radius:var(--radius-control); background:var(--surface); color:var(--ink); font-size:calc(12px * var(--ui-font-scale,1)); }
.removed-toggle > span:not(.original-icon) { flex:1; text-align:start; }.removed-toggle .original-icon:last-child { transition:transform var(--motion-state) ease; }.removed-toggle .expanded { transform:rotate(180deg); }
.removed-records-region { display:grid; grid-template-rows:0fr; opacity:0; transition:grid-template-rows var(--motion-state) ease,opacity var(--motion-state) ease; }.removed-records-region.expanded { grid-template-rows:1fr; opacity:1; }.removed-records-region > div { overflow:hidden; min-height:0; }.removed-hint { color:var(--muted); font-size:calc(11px * var(--ui-font-scale,1)); line-height:1.6; }.removed-track .text-button { min-height:44px; }
</style>
