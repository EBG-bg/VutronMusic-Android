<template>
  <button class="button-icon" @click="handleClick"><slot></slot></button>
</template>

<script setup lang="ts">
interface Props {
  preventBlur?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  preventBlur: false
})

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()

const handleClick = (e: MouseEvent) => {
  const button = e.currentTarget
  emit('click', e)

  // Pointer taps need no persistent focus fill. Keyboard activation must keep
  // its focus, and opening a dialog must not blur its newly focused control.
  if (!props.preventBlur && e.detail > 0) {
    setTimeout(() => {
      if (button instanceof HTMLElement && document.activeElement === button) button.blur()
    }, 0)
  }
}
</script>

<style scoped>
button {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 8px;
  background: transparent;
  margin: 4px;
  border-radius: 25%;
  transition: 0.2s;
}
button :deep(.svg-icon) {
  height: 16px;
  width: 16px;
  color: var(--color-text);
  transition: color 0.3s;
}
button:first-child { margin-left: 0; }
@media (hover: hover) and (pointer: fine) {
  button:hover { background: var(--color-secondary-bg-for-transparent); }
}
button:active { transform: scale(0.92); }
</style>
