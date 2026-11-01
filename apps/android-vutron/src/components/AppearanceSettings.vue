<script setup lang="ts">
import { accent, accentPresets, appearance } from '../platform/appearance'
import CollapsibleSettingsCard from './CollapsibleSettingsCard.vue'
import { motionPreference, reducedMotion, systemReducesMotion } from '../platform/motion'
import { fontScale } from '../platform/interfacePreferences'
import ThumbRange from './ThumbRange.vue'
import AccentColorEditor from './AccentColorEditor.vue'
</script>

<template>
  <CollapsibleSettingsCard class="appearance-settings" section-id="appearance" :title="$t('mobile.appearanceUi.title')" :subtitle="$t('mobile.appearanceUi.subtitle')">
    <div class="segmented-control appearance-mode" role="group" :aria-label="$t('settings.nav.appearance')">
      <button type="button" :class="{ selected: appearance === 'light' }" @click="appearance = 'light'">{{ $t('settings.theme.light') }}</button>
      <button type="button" :class="{ selected: appearance === 'dark' }" @click="appearance = 'dark'">{{ $t('settings.theme.dark') }}</button>
      <button type="button" :class="{ selected: appearance === 'auto' }" @click="appearance = 'auto'">{{ $t('settings.theme.auto') }}</button>
    </div>
    <div class="segmented-control motion-mode" role="group" :aria-label="$t('mobile.appearanceUi.motion')">
      <button type="button" :class="{ selected: motionPreference === 'full' }" :aria-pressed="motionPreference === 'full'" @click="motionPreference = 'full'">{{ $t('mobile.appearanceUi.full') }}</button>
      <button type="button" :class="{ selected: motionPreference === 'system' }" :aria-pressed="motionPreference === 'system'" @click="motionPreference = 'system'">{{ $t('settings.theme.auto') }}</button>
      <button type="button" :class="{ selected: motionPreference === 'reduced' }" :aria-pressed="motionPreference === 'reduced'" @click="motionPreference = 'reduced'">{{ $t('mobile.appearanceUi.reduced') }}</button>
    </div>
    <p class="setting-note motion-status">{{ $t('mobile.appearanceUi.status', { mode: $t(reducedMotion ? 'mobile.appearanceUi.reduced' : 'mobile.appearanceUi.full'), system: $t(systemReducesMotion ? 'mobile.appearanceUi.systemReduced' : 'mobile.appearanceUi.systemFull') }) }}</p>
    <div class="accent-presets" role="group" :aria-label="$t('settings.theme.accent')">
      <button v-for="preset in accentPresets" :key="preset.name" type="button" :class="{ selected: accent.toLowerCase() === preset.color }" :aria-pressed="accent.toLowerCase() === preset.color" @click="accent = preset.color"><span :style="{ backgroundColor: preset.color }"></span><small>{{ $t(`mobile.appearanceUi.${preset.name}`) }}</small></button>
    </div>
    <AccentColorEditor />
    <div class="font-size-setting"><label for="interface-font-scale">{{ $t('mobile.refinements.fontSize') }}</label><ThumbRange id="interface-font-scale" min="100" max="150" step="5" :value="fontScale" @input="fontScale = Number(($event.target as HTMLInputElement).value)" /><label class="percent-input"><input :value="fontScale" @change="fontScale = Number(($event.target as HTMLInputElement).value)" type="number" min="100" max="150" step="5" :aria-label="$t('mobile.refinements.fontSize')" /><span>%</span></label></div>
    <p class="setting-note">{{ $t('mobile.refinements.fontHint') }}</p>
  </CollapsibleSettingsCard>
</template>

<style scoped>
.font-size-setting { display:grid; grid-template-columns:minmax(0,1fr) 82px; gap:8px; align-items:center; margin-top:14px; }.font-size-setting > label:first-child { grid-column:1 / -1; }
/* Reuse ContextMenu.vue's 125ms state easing and ButtonIcon.vue's 0.2s press. */
.appearance-mode button { transition: color 125ms ease-out, background-color 125ms ease-out, box-shadow 125ms ease-out, transform .2s ease; }
.accent-presets button > span { outline: 2px solid transparent; outline-offset: 3px; transition: outline-color 125ms ease-out, transform .2s ease; }
.accent-presets button.selected > span { outline-color: var(--color-text); }
html[data-motion="reduced"] .appearance-mode button, html[data-motion="reduced"] .accent-presets button > span { transition: none; }
</style>
