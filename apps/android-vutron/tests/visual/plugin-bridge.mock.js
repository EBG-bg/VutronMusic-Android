import builtinIndex from '../../../../vendor/android-runtime/src/main/assets/sources-runtime/plugins/builtin-index.json'

const clone = value => JSON.parse(JSON.stringify(value))
const plugins = builtinIndex.map(row => ({ ...clone(row), baseId: row.id, builtIn: true, installed: true, enabled: false, status: 'logout', accountScope: 'visual-' + row.id }))
let priorities = { lyric: ['self'], comment: ['self'] }
export const pluginBackend = { plugins, calls: [] }
const snapshot = () => ({ plugins: clone(plugins), catalog: [] })
export const musicPluginBridge = {
  async listMusicPlugins() { return snapshot() },
  async manageMusicPlugin(value) {
    pluginBackend.calls.push(clone(value))
    if (value.action === 'sourcePriorities') return clone(priorities)
    if (value.action === 'setSourcePriorities') { priorities = { lyric: [...value.lyric], comment: [...value.comment] }; return clone(priorities) }
    const plugin = plugins.find(row => row.id === value.id)
    if (!plugin) throw new Error('Unknown visual source')
    if (value.action === 'enable') plugin.enabled = true
    else if (value.action === 'disable' || value.action === 'reset') plugin.enabled = false
    else if (value.action === 'configure') plugin.baseUrl = value.baseUrl
    else throw new Error('Unexpected visual source operation: ' + value.action)
    return snapshot()
  },
  async callMusicPlugin() { throw new Error('A closed provided source must not execute during visual checks') },
  async importMusicPlugin() { throw new Error('No file or account imports during visual checks') }
}
