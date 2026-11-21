<script setup lang="ts">
import { ref, useId } from 'vue'
import CollapsibleSettingsCard from './CollapsibleSettingsCard.vue'
import { vRangeSelect, type RangeSelection } from '../composables/rangeSelect'
import { useUserBackup } from '../composables/userBackup'
const { busy, message, retryImportAvailable, exportBackup, importBackup, retryImport } = useUserBackup()
const includePrivacy = ref(false), includeCache = ref(false)
const fieldId = useId()
const backupParts = ['privacy', 'cache'] as const
const optionsRange: RangeSelection = {
  order: () => backupParts,
  selected: () => new Set(backupParts.filter(key => key === 'privacy' ? includePrivacy.value : includeCache.value)),
  apply(keys) {
    if (busy.value) return
    includePrivacy.value = keys.has('privacy')
    includeCache.value = keys.has('cache')
  },
}
</script>
<template>
  <CollapsibleSettingsCard section-id="user-backup" :title="$t('mobile.backup.title')" :subtitle="$t('mobile.backup.subtitle')">
    <div v-range-select="busy ? undefined : optionsRange" class="backup-options">
      <div class="settings-detail" data-range-key="privacy">
        <div><b :id="`${fieldId}-privacy`">{{ $t('mobile.backup.privacy') }}</b><p class="setting-note" :id="`${fieldId}-privacy-note`">{{ $t('mobile.backup.privacyHint') }}</p></div>
        <button class="switch" :class="{ on: includePrivacy }" type="button" role="switch" :aria-checked="includePrivacy" :aria-labelledby="`${fieldId}-privacy`" :aria-describedby="`${fieldId}-privacy-note`" :disabled="busy" @click="includePrivacy = !includePrivacy"><i></i></button>
      </div>
      <div class="settings-detail" data-range-key="cache">
        <div><b :id="`${fieldId}-cache`">{{ $t('mobile.backup.cache') }}</b><p class="setting-note" :id="`${fieldId}-cache-note`">{{ $t('mobile.backup.cacheHint') }}</p></div>
        <button class="switch" :class="{ on: includeCache }" type="button" role="switch" :aria-checked="includeCache" :aria-labelledby="`${fieldId}-cache`" :aria-describedby="`${fieldId}-cache-note`" :disabled="busy" @click="includeCache = !includeCache"><i></i></button>
      </div>
    </div>
    <div class="timer-actions">
      <button class="secondary-button" type="button" :disabled="busy" @click="exportBackup({ includePrivacy, includeCache })">{{ $t(includeCache ? 'mobile.backup.exportZip' : 'mobile.backup.export') }}</button>
      <button class="secondary-button" type="button" :disabled="busy" @click="importBackup(includePrivacy, includeCache)">{{ $t('mobile.backup.import') }}</button>
    </div>
    <p v-if="busy || message" class="setting-note" role="status">{{ busy ? $t('mobile.backup.working') : message }}</p>
    <button v-if="retryImportAvailable && !busy" class="secondary-button" type="button" @click="retryImport">{{ $t('mobile.backup.retryImport') }}</button>
  </CollapsibleSettingsCard>
</template>
<style scoped>
.backup-options { display: grid; gap: 6px; }
.backup-options .settings-detail { gap: 12px; }
.backup-options .setting-note { margin: 2px 0 0; }
.backup-options .switch { flex-shrink: 0; }
</style>
