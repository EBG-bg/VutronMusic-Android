const path = require('node:path')
async function main() {
  const { createServer } = await import('vite')
  const server = await createServer({
    root: path.resolve(__dirname, '..'),
    optimizeDeps: { entries: ['tests/fixtures/features.html', 'tests/fixtures/windowed-tracks.html'] },
    plugins: [{ name: 'isolated-native-fixtures', enforce: 'pre', transform(_code, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/platform/vutronPlugin.ts')) return "export { vutronPlugin } from '/tests/fixtures/features-native.mock.js'"
    } }],
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'error'
  })
  await server.listen()
  console.log('ISOLATED_FIXTURE_URL=' + server.resolvedUrls.local[0])
  const close = async () => { await server.close(); process.exit(0) }
  process.on('SIGTERM', close); process.on('SIGINT', close)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
