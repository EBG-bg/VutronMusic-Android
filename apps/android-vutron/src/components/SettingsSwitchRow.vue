<script setup lang="ts">
const props = defineProps<{ label: string; checked: boolean; disabled?: boolean }>()
const emit = defineEmits<{ change: [checked: boolean] }>()

function requestChange(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const requested = input.checked
  // The parent may need to confirm an asynchronous settings write.
  input.checked = props.checked
  emit('change', requested)
}
</script>

<template>
  <label class="settings-detail settings-switch-row" :data-disabled="disabled ? '' : undefined">
    <span>{{ label }}</span>
    <input role="switch" type="checkbox" :checked="checked" :disabled="disabled" @change="requestChange" />
    <span class="switch" :class="{ on: checked }" aria-hidden="true"><i /></span>
  </label>
</template>

<style scoped>
.settings-switch-row { position: relative; min-height: 44px; cursor: pointer; gap: 12px; }
.settings-switch-row[data-disabled] { opacity: .55; cursor: default; }
.settings-switch-row > input { position: absolute; inline-size: 1px; min-inline-size: 0; block-size: 1px; margin: 0; clip-path: inset(50%); }
.settings-switch-row > .switch { flex: none; }
.settings-switch-row > input:focus-visible + .switch { outline: 2px solid var(--accent); outline-offset: 3px; }
</style>
