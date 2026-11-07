const path = require('node:path')

async function main() {
  const { createServer } = await import('vite')
  const root = path.resolve(__dirname, '../..')
  const server = await createServer({
    root,
    define: { __VUTRON_BUILD__: JSON.stringify({ edition: 'mobile', displayName: 'Vutron Music - Mobile', version: '1.2.0', versionCode: 41, comparisonVersion: '1.2.0', artifactName: 'synthetic-visual-fixture.apk' }) },
    plugins: [{
      name: 'isolated-visual-bridge', enforce: 'pre',
      transform(code, id) {
        const file = id.replaceAll('\\', '/')
        if (file.endsWith('/src/platform/vutronPlugin.ts')) return "export { vutronPlugin } from '/tests/visual/native.mock.js'"
        if (file.endsWith('/src/plugins/bridge.ts')) return "export { musicPluginBridge } from '/tests/visual/plugin-bridge.mock.js'"
      }
    }],
    server: { host: '127.0.0.1', port: 4179, strictPort: true },
    logLevel: 'error'
  })
  await server.listen()
  const close = async () => { await server.close(); process.exit(0) }
  process.on('SIGTERM', close)
  process.on('SIGINT', close)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
