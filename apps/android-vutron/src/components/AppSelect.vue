<script setup lang="ts" generic="T extends string | number">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { activeAppSelect, closeAppSelect } from '../platform/appSelect'
import OriginalIcon from './OriginalIcon.vue'

const props = defineProps<{ modelValue: T; options: readonly { value: T; label: string; disabled?: boolean }[]; label: string; id?: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
const uid = useId(), expanded = ref(false), trigger = ref<HTMLButtonElement>(), panel = ref<HTMLElement>()
const selected = computed(() => props.options.find(option => option.value === props.modelValue))
const request = { close }
let returnFocus: HTMLElement | null = null
let isolated: { element: HTMLElement; inert: boolean }[] = []
let search = '', searchAt = 0
let backgroundScroll: { x: number; y: number; styles: [HTMLElement, string, string, string][] } | undefined

function lockScroll() {
  backgroundScroll = { x: window.scrollX, y: window.scrollY, styles: [] }
  for (const element of [document.documentElement, document.body]) {
    for (const property of ['overflow', 'overscroll-behavior']) {
      backgroundScroll.styles.push([element, property, element.style.getPropertyValue(property), element.style.getPropertyPriority(property)])
      element.style.setProperty(property, property === 'overflow' ? 'hidden' : 'none')
    }
  }
}
function unlockScroll() {
  if (!backgroundScroll) return
  const saved = backgroundScroll; backgroundScroll = undefined
  for (const [element, property, value, priority] of saved.styles) {
    if (value) element.style.setProperty(property, value, priority)
    else element.style.removeProperty(property)
  }
  window.scrollTo({ left: saved.x, top: saved.y, behavior: 'instant' })
}

function restoreBackground() {
  for (const item of isolated) item.element.inert = item.inert
  isolated = []
}
function close() {
  if (!expanded.value) return
  expanded.value = false
  if (activeAppSelect.value === request) activeAppSelect.value = undefined
  document.removeEventListener('keydown', keyboard, true)
  document.removeEventListener('focusin', keepFocus, true)
  restoreBackground()
  unlockScroll()
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
}
async function open() {
  if (expanded.value || props.disabled || trigger.value?.matches(':disabled')) return
  closeAppSelect()
  returnFocus = trigger.value || (document.activeElement instanceof HTMLElement ? document.activeElement : null)
  expanded.value = true
  lockScroll()
  activeAppSelect.value = request
  search = ''; searchAt = 0
  document.addEventListener('keydown', keyboard, true)
  document.addEventListener('focusin', keepFocus, true)
  await nextTick()
  if (!expanded.value || !panel.value) return
  // Teleport keeps the picker outside its inert background, including nested dialogs.
  const layer = panel.value.parentElement
  for (const element of Array.from(document.body.children)) {
    if (element instanceof HTMLElement && element !== layer && !element.contains(layer)) {
      isolated.push({ element, inert: element.inert }); element.inert = true
    }
  }
  const option = panel.value.querySelector<HTMLElement>('[aria-selected="true"]:not(:disabled)') || optionButtons()[0]
  option?.focus({ preventScroll: true }); option?.scrollIntoView({ block: 'nearest' })
}
function optionButtons() { return Array.from(panel.value?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') || []) }
function keepFocus(event: FocusEvent) {
  if (expanded.value && panel.value && !panel.value.contains(event.target as Node)) optionButtons()[0]?.focus({ preventScroll: true })
}
function choose(value: T) { close(); emit('update:modelValue', value) }
function keyboard(event: KeyboardEvent) {
  if (!expanded.value) return
  if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); return }
  if (event.key === 'Tab') {
    event.preventDefault(); event.stopImmediatePropagation()
    const controls = Array.from(panel.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])
    const index = controls.indexOf(document.activeElement as HTMLButtonElement)
    controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus()
    return
  }
  const buttons = optionButtons(), index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
    event.preventDefault(); event.stopImmediatePropagation()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
    buttons[next]?.focus(); buttons[next]?.scrollIntoView({ block: 'nearest' })
  } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.stopImmediatePropagation()
    const now = performance.now(); search = now - searchAt < 700 ? search + event.key : event.key; searchAt = now
    const match = buttons.find(button => button.textContent?.trim().toLocaleLowerCase().startsWith(search.toLocaleLowerCase()))
    match?.focus(); match?.scrollIntoView({ block: 'nearest' })
  }
}
watch(() => props.disabled, value => { if (value) close() })
onBeforeUnmount(() => { close(); restoreBackground(); unlockScroll() })
</script>

<template>
  <div class="app-select">
    <button :id="id" ref="trigger" class="app-select-trigger secondary-button" type="button" :disabled="disabled" :aria-label="label + ': ' + (selected?.label || '')" aria-haspopup="listbox" :aria-expanded="expanded" :aria-controls="expanded ? uid + '-options' : undefined" :data-value="modelValue" @click="open">
      <span>{{ selected?.label }}</span><OriginalIcon name="down" />
    </button>
    <Teleport to="body"><Transition name="app-select">
      <div v-if="expanded" class="app-select-layer" @click.self="close">
        <section ref="panel" class="app-select-panel" role="dialog" aria-modal="true" :aria-label="label">
          <header><h2>{{ label }}</h2><button class="icon-button" type="button" :aria-label="$t('mobile.common.close')" @click="close"><OriginalIcon name="close" /></button></header>
          <div :id="uid + '-options'" class="app-select-options" role="listbox" :aria-label="label">
            <button v-for="option in options" :key="option.value" class="secondary-button" type="button" role="option" :aria-selected="option.value === modelValue" :disabled="option.disabled" :data-value="option.value" @click="choose(option.value)"><span>{{ option.label }}</span><span class="selection-mark" aria-hidden="true"></span></button>
          </div>
        </section>
      </div>
    </Transition></Teleport>
  </div>
</template>

<style scoped>
.app-select { display: inline-flex; min-width: 0; max-width: 100%; }
.app-select-trigger { display: inline-flex; align-items: center; justify-content: space-between; gap: 9px; min-height: 38px; min-width: 46px; max-width: 100%; border: 1px solid var(--line); border-radius: 11px; padding: 7px 10px; font: inherit; color: var(--ink); background: var(--surface); }
.app-select-trigger > span { min-width: 0; overflow-wrap: anywhere; }
.app-select-trigger .original-icon { flex: 0 0 13px; font-size: 13px; transition: transform 180ms ease; }
.app-select-trigger[aria-expanded="true"] .original-icon { transform: rotate(180deg); }
.app-select-layer { position: fixed; inset: 0; z-index: 800; display: grid; place-items: center; padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); background: rgb(0 0 0 / 40%); overscroll-behavior: contain; overflow: hidden; }
.app-select-panel { width: min(100%, 380px); max-height: min(85dvh, calc(100dvh - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom))); display: flex; flex-direction: column; box-sizing: border-box; padding: 12px; border: 1px solid var(--line); border-radius: 18px; background: var(--color-body-bg); color: var(--ink); box-shadow: 0 14px 50px #0004; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 2px 8px 10px; }
h2 { margin: 0; font-size: calc(15px * var(--ui-font-scale, 1)); overflow-wrap: anywhere; }
header button { width: 36px; height: 36px; flex-shrink: 0; border-radius: 10px; }
.app-select-options { min-height: 0; overflow: auto; overscroll-behavior: contain; display: grid; gap: 4px; }
.app-select-options button { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 44px; padding: 11px 12px; border: 1px solid transparent; border-radius: 11px; color: var(--ink); background: transparent; text-align: start; font: inherit; font-size: calc(13px * var(--ui-font-scale, 1)); line-height: 1.5; }
.app-select-options button > span:first-child { min-width: 0; overflow-wrap: anywhere; }
.app-select-options button[aria-selected="true"] { background: var(--accent-soft); color: var(--accent); }
.app-select-options button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.selection-mark { width: 16px; height: 16px; border: 1.5px solid var(--line); border-radius: 50%; flex: 0 0 auto; box-sizing: border-box; }
[aria-selected="true"] .selection-mark { border: 5px solid var(--accent); }
.app-select-enter-active, .app-select-leave-active { transition: opacity 180ms ease; }
.app-select-enter-active .app-select-panel, .app-select-leave-active .app-select-panel { transition: transform 180ms ease, opacity 180ms ease; }
.app-select-enter-from, .app-select-leave-to { opacity: 0; }
.app-select-enter-from .app-select-panel, .app-select-leave-to .app-select-panel { transform: translateY(10px) scale(.98); opacity: 0; }
html[data-motion="reduced"] :is(.app-select-trigger .original-icon, .app-select-enter-active, .app-select-leave-active, .app-select-enter-active .app-select-panel, .app-select-leave-active .app-select-panel) { transition: none; }
</style>
