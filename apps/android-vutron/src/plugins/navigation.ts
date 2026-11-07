import { shallowRef } from 'vue'
import type { PluginEntityKind, PluginItem } from './protocol'

export interface PluginNavigation {
  pluginId: string
  kind: PluginEntityKind
  item: PluginItem
  key: number
}

let sequence = 0
export const pendingPluginNavigation = shallowRef<PluginNavigation>()

// An opaque entity is passed exactly once between source pages, never persisted.
export function requestPluginNavigation(value: Omit<PluginNavigation, 'key'>): void {
  pendingPluginNavigation.value = { ...value, key: ++sequence }
}

export function consumePluginNavigation(pluginId: string, consumedKey = 0): PluginNavigation | undefined {
  const value = pendingPluginNavigation.value
  if (!value || value.pluginId !== pluginId) return
  pendingPluginNavigation.value = undefined
  return value.key > consumedKey ? value : undefined
}
