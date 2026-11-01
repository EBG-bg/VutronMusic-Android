<script setup lang="ts">
import { appLocale, setAppLocale } from '../platform/i18n'
import CollapsibleSettingsCard from './CollapsibleSettingsCard.vue'
import AppSelect from './AppSelect.vue'
const languages = [{ value: 'zh', label: '简体中文' }, { value: 'zht', label: '繁體中文' }, { value: 'en', label: 'English' }]
</script>

<template>
  <CollapsibleSettingsCard section-id="language" :title="$t('mobile.language.title')" :subtitle="$t('settings.general.language.text')">
    <div class="settings-detail"><label for="app-language">{{ $t('settings.general.language.text') }}</label><AppSelect id="app-language" :model-value="appLocale" :label="$t('settings.general.language.text')" :options="languages" @update:model-value="setAppLocale" /></div>
    <p class="setting-note">{{ $t('mobile.language.description') }}</p>
  </CollapsibleSettingsCard>
</template>

<style scoped>
.app-select { max-width: 65%; }
</style>
