import { computed, ref, watch, type Ref } from 'vue'

export interface TrackBatchAction { id: string; label: string; danger?: boolean }
export function useTrackSelection<T>(items: Ref<readonly T[]>, key: (item: T) => string, scope: Ref<string>) {
  const active = ref(false), keys = ref(new Set<string>()), busy = ref(false)
  let generation = 0
  const selected = computed(() => items.value.filter(item => keys.value.has(key(item))))
  const allSelected = computed(() => items.value.length > 0 && selected.value.length === items.value.length)
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
  return { active, keys, busy, selected, allSelected, toggle, selectAll, close, run }
}
