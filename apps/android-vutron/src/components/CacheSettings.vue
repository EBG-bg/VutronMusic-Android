<script setup lang="ts">
import { computed } from 'vue'
import { useAndroidShellStore } from '../stores/androidShell'
import { formatBytes } from '../utils/formatting'
import CollapsibleSettingsCard from './CollapsibleSettingsCard.vue'
import PlaybackPrefetchSettings from './PlaybackPrefetchSettings.vue'
import OriginalIcon from './OriginalIcon.vue'
import ThumbRange from './ThumbRange.vue'
const store = useAndroidShellStore()
const emit = defineEmits<{ openOffline: [] }>()
const cacheUsedPercent = computed(() => store.cacheStatus.capacityMb > 0
  ? Math.min(100, store.cacheStatus.usedBytes / (store.cacheStatus.capacityMb * 1024 * 1024) * 100) : 0)
function updateCacheCapacity(event: Event) { store.cacheCapacityMb = Number((event.target as HTMLInputElement).value) }
function updateArtworkCacheCapacity(event: Event) { store.artworkCacheCapacityMb = Number((event.target as HTMLInputElement).value) }
</script>
<template>
<CollapsibleSettingsCard section-id="cache" :title="$t('mobile.library.cache')">
          <template #heading><span class="settings-icon blue"><OriginalIcon name="down" /></span><div><h3>{{ $t('mobile.library.cache') }}</h3><p>{{ $t('mobile.settingsUi.audioUsage', { used: formatBytes(store.cacheStatus.usedBytes), capacity: store.cacheStatus.capacityMb, count: store.cacheStatus.trackCount }) }}</p><p>{{ $t('mobile.settingsUi.artworkUsage', { size: formatBytes(store.cacheStatus.libraryBytes ?? 0) }) }}</p></div></template>
          <label class="settings-detail"><span>{{ $t('mobile.settingsUi.autoCache') }}</span><input type="checkbox" :checked="store.cacheStatus.enabled !== false" @change="store.setAutomaticCache(($event.target as HTMLInputElement).checked)" /></label>
          <p class="setting-note">{{ $t('mobile.settingsUi.autoCacheHint') }}</p>
          <PlaybackPrefetchSettings />
          <CollapsibleSettingsCard class="cache-advanced" section-id="cache-prefetch" :title="$t('mobile.settingsUi.prefetchLibrary')" :remember="false"><button class="secondary-button" type="button" :disabled="store.cacheAllPlaylistsLoading" @click="store.cacheAllPlaylists()">{{ $t(store.cacheAllPlaylistsLoading ? 'mobile.settingsUi.savingLibrary' : 'mobile.settingsUi.saveLibrary') }}</button><p class="setting-note">{{ store.cacheAllPlaylistsResult }}</p></CollapsibleSettingsCard>
          <p v-if="store.cacheStatus.downloading || store.cacheStatus.queued" class="setting-note">{{ store.cacheStatus.downloading ? $t('mobile.settingsUi.downloading', { done: formatBytes(store.cacheStatus.downloadedBytes ?? 0), total: formatBytes(store.cacheStatus.downloadTotalBytes ?? 0) }) + ' · ' : '' }}{{ $t('mobile.settingsUi.queued', { count: store.cacheStatus.queued ?? 0 }) }}</p>
          <p v-if="store.cacheStatus.error" class="inline-error">{{ store.cacheStatus.error }}</p>
          <div class="storage-meter"><span :style="{ width: `${cacheUsedPercent}%` }"></span></div>
          <label class="setting-range"><span>{{ $t('mobile.settingsUi.capacity') }}</span><b>{{ store.cacheCapacityMb }} MB</b></label>
          <div class="cache-input-row"><input v-model.number="store.cacheCapacityMb" type="number" min="256" max="10240" inputmode="numeric" :aria-label="$t('mobile.settingsUi.audioCapacityMiB')" /><button class="secondary-button" type="button" @click="store.setCacheCapacity()">{{ $t('mobile.settingsUi.saveCapacity') }}</button></div>
          <ThumbRange class="settings-slider" min="256" max="10240" step="256" :value="store.cacheCapacityMb" :aria-label="$t('mobile.settingsUi.audioCapacity')" @input="updateCacheCapacity" @change="store.setCacheCapacity" />
          <div class="settings-detail"><span>{{ $t('mobile.settingsUi.cacheHint') }}</span><button class="text-button danger-text" type="button" @click="store.clearCache">{{ $t('mobile.settingsUi.clear') }}</button></div>
          <button class="wide-outline-button" type="button" @click="emit('openOffline')">{{ $t('mobile.settingsUi.viewOffline') }}</button>
          <label class="setting-range"><span>{{ $t('mobile.settingsUi.artworkCapacity') }}</span><b>{{ store.artworkCacheCapacityMb }} MB</b></label>
          <ThumbRange class="settings-slider" min="32" max="1024" step="32" :value="store.artworkCacheCapacityMb" aria-label="封面缓存容量" @input="updateArtworkCacheCapacity" @change="store.setArtworkCacheCapacity" />
        </CollapsibleSettingsCard>
</template>
