'use strict'
const { z } = require('zod')
const schemas = require('./plugin-schemas.cjs')
const { defaultMap: upstreamDefaults } = require('./plugin-defaults.cjs')

const asset = z.union([z.string(), z.object({ url: z.string(), headers: z.record(z.string(), z.string()).optional() })])
const PluginResultSchema = {
  ...schemas.PluginResultSchema,
  getAccount: schemas.PluginResultSchema.getAccount.passthrough(),
  getStream: asset,
  getPic: asset,
  intelligencePlaylist: z.object({ code: z.number(), data: z.array(schemas.TrackSchema), sourceContext: z.record(z.string(), z.any()).optional() })
}
const PluginMetaSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(['local', 'library', 'stream', 'online']).transform(value => value === 'online' ? 'library' : value),
  icon: z.string().max(2048).optional(),
  capabilities: z.object({
    matchTrack: z.union([z.enum(['official', 'search']), z.literal(false)]).optional(),
    getLyric: z.boolean().optional(), getComments: z.boolean().optional(),
    comment: z.object({ read: z.boolean().optional(), like: z.boolean().optional(), submit: z.boolean().optional(), floor: z.boolean().optional(), types: z.array(z.enum(['track', 'album', 'playlist', 'mv'])).optional() }).optional(),
    mv: z.object({ detail: z.boolean().optional(), like: z.boolean().optional(), subscribe: z.boolean().optional() }).optional()
  }).optional()
}).passthrough()
const defaultMap = { ...upstreamDefaults, getStream: '', getPic: '', intelligencePlaylist: { code: 404, data: [], sourceContext: {} } }

function validateMeta(meta) { return PluginMetaSchema.parse(meta) }
function validateResult(method, result) {
  const schema = PluginResultSchema[method]
  if (!schema) throw Object.assign(new Error('Unknown plugin method: ' + method), { code: 'PLUGIN_METHOD_UNKNOWN' })
  // These exact legacy exports return booleans in the bundled upstream sources.
  if (method === 'systemPing' && typeof result === 'boolean') result = { code: result ? 200 : 404, status: result ? 'login' : 'logout' }
  if (method === 'doLogin' && typeof result === 'boolean') result = { code: result ? 200 : 404 }
  if (method === 'getAccount' && result && typeof result === 'object') result = {
    ...result, baseUrl: result.baseUrl ?? '', userName: result.userName ?? '', pwd: result.pwd ?? ''
  }
  // Match the desktop's per-method fallback for unsupported/failing methods;
  // successful results still must satisfy the unmodified upstream schema.
  if (result && typeof result === 'object' && typeof result.code === 'number' && result.code !== 200 && defaultMap[method]) {
    const parsed = schema.safeParse({ ...defaultMap[method], ...result })
    if (parsed.success) return parsed.data
    return schema.parse(defaultMap[method])
  }
  return schema.parse(result)
}
module.exports = { ...schemas, PluginResultSchema, defaultMap, PluginMetaSchema, validateMeta, validateResult }
