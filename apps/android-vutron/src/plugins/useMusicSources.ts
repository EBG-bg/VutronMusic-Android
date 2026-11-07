import { computed, getCurrentScope, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import { musicPluginBridge, type MusicPluginBridge } from './bridge'
import { declaresPluginMethod, pluginFeatures, type MusicPlugin } from './protocol'

type MusicSourcesApi = Pick<MusicPluginBridge, 'listMusicPlugins'>
type SourcesChanged = (plugins?: MusicPlugin[]) => void
const listeners = new Set<SourcesChanged>()
const primarySources = new Set(['netease', 'local', 'demo'])

/** Registry metadata only. No account reads, plugin execution or implicit enable. */
export function notifyMusicSourcesChanged(plugins?: MusicPlugin[]): void {
  for (const listener of listeners) listener(plugins)
}

function isAdditionalMusicSource(plugin: MusicPlugin): boolean {
  const baseId = plugin.baseId || plugin.id
  if (!plugin.enabled || plugin.installed === false) return false
  // Keep the normal NetEase/local entries and advanced compatibility entries distinct.
  // An explicitly created instance or externally imported source remains selectable.
  if (plugin.builtIn && plugin.id === baseId && primarySources.has(baseId)) return false
  return declaresPluginMethod(plugin, 'search')
    || pluginFeatures.some(feature => declaresPluginMethod(plugin, feature.method))
}

function visibleSources(plugins: MusicPlugin[]): MusicPlugin[] {
  const available = plugins.filter(isAdditionalMusicSource)
  const names = new Map<string, number>()
  for (const plugin of available) {
    const name = plugin.name.trim() || plugin.id
    names.set(name, (names.get(name) || 0) + 1)
  }
  return available.map(plugin => {
    const name = plugin.name.trim() || plugin.id
    const compatibilityInstance = plugin.baseId && plugin.id !== plugin.baseId && primarySources.has(plugin.baseId)
    return { ...plugin, name: (names.get(name) || 0) > 1 || compatibilityInstance ? `${name} · ${plugin.id}` : name }
  })
}

/** Empty selection denotes the main native library. Selection is session-only. */
export function useMusicSources(api: MusicSourcesApi = musicPluginBridge, selection?: Ref<string>) {
  const plugins = shallowRef<MusicPlugin[]>([]), sources = computed(() => visibleSources(plugins.value))
  const selectedId = selection || ref(''), selected = computed(() => sources.value.find(source => source.id === selectedId.value))
  const selectionKey = computed(() => selected.value ? JSON.stringify([selected.value.id, selected.value.accountScope || '']) : '')
  const loading = ref(false), loaded = ref(false), error = ref('')
  let generation = 0, disposed = false

  function hasSource(id: string): boolean { return id === '' || sources.value.some(source => source.id === id) }
  function validateSelection() {
    if (loaded.value && !hasSource(selectedId.value)) selectedId.value = ''
  }
  function accept(incoming: MusicPlugin[]) {
    // Snapshot registry rows, so a manager's later edits cannot silently bypass refresh.
    const next = incoming.map(plugin => ({ ...plugin, methods: [...plugin.methods],
      unsupportedMethods: plugin.unsupportedMethods ? [...plugin.unsupportedMethods] : undefined }))
    plugins.value = next
    loaded.value = true
    validateSelection()
  }
  function select(id: string): boolean {
    if (disposed) return false
    const available = hasSource(id)
    selectedId.value = available ? id : ''
    return available
  }
  async function refresh(): Promise<boolean> {
    if (disposed) return false
    const token = ++generation
    loading.value = true; error.value = ''
    try {
      const result = await api.listMusicPlugins()
      if (disposed || token !== generation) return false
      accept(result.plugins)
      return true
    } catch (cause) {
      if (!disposed && token === generation) error.value = cause instanceof Error ? cause.message : String(cause || 'PLUGIN_SOURCES_READ_FAILED')
      return false
    } finally {
      if (!disposed && token === generation) loading.value = false
    }
  }
  const changed: SourcesChanged = incoming => {
    if (disposed) return
    if (!incoming) { void refresh(); return }
    ++generation; loading.value = false; error.value = ''
    accept(incoming)
  }
  listeners.add(changed)
  const stopSelection = watch(selectedId, validateSelection, { flush: 'sync' })
  function dispose() {
    if (disposed) return
    disposed = true; ++generation; loading.value = false
    listeners.delete(changed); stopSelection()
  }
  if (getCurrentScope()) onScopeDispose(dispose)
  return { plugins, sources, selectedId, selected, selectionKey, loading, loaded, error, hasSource, refresh, select, dispose }
}
