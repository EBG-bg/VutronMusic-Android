<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ label: string; value?: string | number | null; multiline?: boolean; alwaysFloat?: boolean }>()
const filled = computed(() => props.value != null && props.value !== '')
</script>

<template>
  <label class="floating-field" :class="{ 'is-filled': alwaysFloat || filled, 'is-multiline': multiline }">
    <span class="floating-label">{{ label }}</span>
    <slot />
  </label>
</template>

<style scoped>
.floating-field { position: relative; display: block; min-width: 0; --field-inset: 12px; }
.floating-label { position: absolute; inset-inline: var(--field-inset); top: 50%; transform: translateY(-50%); z-index: 1; width: fit-content; max-width: calc(100% - 2 * var(--field-inset)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: calc(13px * var(--ui-font-scale, 1)); line-height: 1.25; pointer-events: none; transition: top var(--motion-feedback), transform var(--motion-feedback), color var(--motion-feedback), font-size var(--motion-feedback); }
.floating-field.is-multiline .floating-label { top: 16px; transform: none; }
.floating-field:is(.is-filled, :focus-within) .floating-label { top: 7px; transform: none; font-size: calc(10px * var(--ui-font-scale, 1)); }
.floating-field:focus-within .floating-label { color: var(--accent-ink); }
.floating-field :deep(:is(input, textarea)) { display: block; box-sizing: border-box; width: 100%; min-width: 0; min-height: 48px; padding: calc(14px + 10px * var(--ui-font-scale, 1)) var(--field-inset) 7px; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-control); font: inherit; font-size: calc(13px * var(--ui-font-scale, 1)); line-height: 1.35; transition: border-color var(--motion-feedback), background-color var(--motion-feedback); }
.floating-field :deep(textarea) { resize: vertical; }
.floating-field :deep(:is(input, textarea):focus) { border-color: var(--accent); outline: 1px solid var(--accent); outline-offset: -1px; }
.floating-field :deep(:is(input, textarea):not(:focus)::placeholder) { color: transparent; }
.floating-field :deep(:is(input, textarea):disabled) { opacity: .65; }
</style>
