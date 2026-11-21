import type { RangeSelection } from './rangeSelect'
import { computed, ref, shallowRef, triggerRef, watch, type Ref } from 'vue'

export interface TrackBatchAction { id: string; label: string; danger?: boolean }
export function useTrackSelection<T>(items: Ref<readonly T[]>, key: (item: T) => string, scope: Ref<string>, loadMore?: () => Promise<boolean>) {
  const active = ref(false), keys = shallowRef(new Set<string>()), busy = ref(false), revision = ref(0)
  let generation = 0
  const selected = computed(() => items.value.filter(item => keys.value.has(key(item))))
  const selectedCount = computed(() => keys.value.size)
  const orderedKeys = computed(() => items.value.map(key))
  const allSelected = computed(() => items.value.length > 0 && selectedCount.value === items.value.length)
  function toggle(item: T) {
    if (busy.value) return
    const next = new Set(keys.value), id = key(item)
    if (next.has(id)) next.delete(id); else next.add(id)
    keys.value = next
  }
  function selectAll() { if (!busy.value) keys.value = allSelected.value ? new Set() : new Set(items.value.map(key)) }
  function close() { if (!busy.value) { active.value = false; keys.value = new Set() } }
  async function run(action: string, handler?: (action: string, rows: T[]) => Promise<boolean>) {
    if (busy.value || !selected.value.length || !handler) return
    const token = generation
    busy.value = true
    try { if (await handler(action, selected.value.slice()) && token === generation) keys.value = new Set() }
    finally { if(token === generation) busy.value = false }
  }
  watch(scope, () => { generation++; active.value = false; keys.value = new Set(); busy.value = false }, { flush: 'sync' })
  watch(items, value => {
    const available = new Set(value.map(key))
    if ([...keys.value].some(id => !available.has(id))) keys.value = new Set([...keys.value].filter(id => available.has(id)))
  })
  // Keep the range controller stable while pages append. A scope change still replaces it and cancels the gesture.
  const range = computed<RangeSelection>(() => {
    const owner = scope.value
    let previouslyActive = false
    return {
      order: () => orderedKeys.value, selected: () => keys.value,
      loadMore,
      valid: () => owner === scope.value,
      start() { previouslyActive = active.value; active.value = true },
      apply(value) {
        if (busy.value || owner !== scope.value) return
        if (value === keys.value) triggerRef(keys)
        else keys.value = value
        revision.value++
      },
      cancel() { if (!previouslyActive && owner === scope.value) active.value = false },
    }
  })
  return { range, active, keys, busy, revision, selected, selectedCount, allSelected, toggle, selectAll, close, run }
}
