<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { accent } from '../platform/appearance'
import { argbToHsv, hsvToArgb } from '../utils/lyricColors'
import ThumbRange from './ThumbRange.vue'
import CollapsibleSettingsCard from './CollapsibleSettingsCard.vue'
const draft = ref(accent.value)
const rememberedHue = ref(0)
const hsv = computed(() => argbToHsv((0xff000000 | parseInt(accent.value.slice(1), 16)) >>> 0, rememberedHue.value))
watch(accent, value => { draft.value = value })
function update(kind: 'hue' | 'saturation' | 'value', event: Event) {
  const number = Number((event.target as HTMLInputElement).value)
  if (kind === 'hue') rememberedHue.value = number
  accent.value = '#' + (hsvToArgb({ ...hsv.value, [kind]: kind === 'hue' ? number : number / 100, alpha: 255 }) & 0xffffff).toString(16).padStart(6, '0')
}
function commitHex() { if (/^#[0-9a-f]{6}$/i.test(draft.value)) accent.value = draft.value; else draft.value = accent.value }
</script>
<template>
  <CollapsibleSettingsCard section-id="appearance-accent" class="accent-editor" :title="$t('mobile.appearanceUi.custom')" :remember="false"><template #heading><span class="accent-preview" :style="{ background: accent }"></span><span>{{ $t('mobile.appearanceUi.custom') }}</span></template>
    <label class="accent-hex">HEX<input v-model="draft" maxlength="7" spellcheck="false" aria-label="HEX" @change="commitHex" @keydown.enter="commitHex" /></label>
    <label v-for="kind in (['hue', 'saturation', 'value'] as const)" :key="kind" class="accent-channel"><span>{{ $t('mobile.refinements.' + kind) }}</span><ThumbRange :min="0" :max="kind === 'hue' ? 359 : 100" :value="kind === 'hue' ? hsv.hue : Math.round(hsv[kind] * 100)" :aria-label="$t('mobile.refinements.' + kind)" @input="update(kind, $event)" /><output>{{ Math.round(kind === 'hue' ? hsv.hue : hsv[kind] * 100) }}</output></label>
  </CollapsibleSettingsCard>
</template>
<style scoped>
.accent-channel > span { min-width:0; overflow-wrap:anywhere; }
.accent-editor { margin-top:12px; padding:10px 12px; border:1px solid var(--line); border-radius:14px; background:var(--surface); }
.accent-editor :deep(> summary) { min-height:44px; }
.accent-editor :deep(.settings-title) { display:flex; align-items:center; gap:10px; font-size:calc(13px * var(--ui-font-scale, 1)); }
.accent-preview { flex:0 0 24px; width:24px; height:24px; border-radius:8px; border:1px solid var(--line); }
.accent-hex { display:flex; align-items:center; gap:12px; margin:12px 0; }.accent-hex input { min-width:0; width:130px; padding:9px; border:1px solid var(--line); border-radius:10px; color:var(--ink); background:var(--color-body-bg); }
.accent-channel { display:grid; grid-template-columns:65px minmax(0,1fr) 32px; gap:6px; align-items:center; min-height:44px; font-size: calc(12px * var(--ui-font-scale, 1)); }output { text-align:right; }
</style>
