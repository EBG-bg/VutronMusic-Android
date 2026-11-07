'use strict';
// Android host adapter for the original VutronMusic pluginRunner API.
const { parentPort, workerData } = require('worker_threads');
const vm = require('vm');
const crypto = require('crypto');
const pending = new Map();
let sequence = 0;
let plugin;
const timers = new Set();

function rpc(operation, values = {}) {
  const requestId = ++sequence;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Plugin platform request timed out')); }, 20000);
    pending.set(requestId, { resolve, reject, timer });
    parentPort.postMessage({ type: 'API_REQUEST', requestId, operation, ...values });
  });
  // Top-level plugins commonly start asynchronous store/db initialization.
  // Attach a handler now; LOAD_DONE waits until those jobs and their callbacks settle.
  promise.catch(() => {});
  return promise;
}

const api = Object.freeze({
  http: Object.freeze(Object.fromEntries(['get', 'post', 'delete'].map(method => [method,
    (url, data, headers, raw) => rpc('http', { method: method.toUpperCase(), url, ...(method === 'get' ? { params: data } : { data }), headers, raw: !!raw })]))),
  store: Object.freeze({ get: key => rpc('storeGet', { key }), set: (key, value) => rpc('storeSet', { key, value }) }),
  db: Object.freeze({ get: (table, filter) => rpc('dbGet', { table, filter }), set: (table, value) => rpc('dbSet', { table, value }) }),
  log: message => parentPort.postMessage({ type: 'LOG', message: String(message).slice(0, 4096) }),
  utils: Object.freeze({
    parseLyric: value => rpc('parseLyric', { value }),
    md5: value => crypto.createHash('md5').update(String(value)).digest('hex'),
    generateSalt: () => crypto.randomBytes(6).toString('hex'),
    generateToken: (password, salt) => crypto.createHash('md5').update(String(password) + String(salt)).digest('hex'),
    getEmbeddedLyric: filePath => rpc('localLyric', { filePath, embedded: true }),
    getPathLyric: filePath => rpc('localLyric', { filePath, embedded: false }),
    checkFileExist: paths => rpc('fileExists', { paths })
  })
});

function safeTimeout(callback, milliseconds, ...args) {
  const handle = setTimeout(() => { timers.delete(handle); try { callback(...args); } catch (error) { parentPort.postMessage({ type: 'LOG', message: String(error.name || 'PluginTimerError') }); } }, Math.max(0, Math.min(2147483647, Number(milliseconds) || 0)));
  timers.add(handle);
  return handle;
}

async function ready() {
  const exported = Object.create(null);
  const context = vm.createContext({
    api, exports: exported, URL, URLSearchParams, TextEncoder, TextDecoder,
    atob: value => Buffer.from(String(value), 'base64').toString('binary'),
    btoa: value => Buffer.from(String(value), 'binary').toString('base64'),
    setTimeout: safeTimeout, clearTimeout: handle => { timers.delete(handle); clearTimeout(handle); },
    console: Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map(level => [level,
      (...values) => parentPort.postMessage({ type: 'LOG', message: values.map(value => typeof value === 'string' ? value : '[object]').join(' ').slice(0, 4096) })]))
  }, { name: 'VutronMusic plugin ' + workerData.id, codeGeneration: { strings: false, wasm: false } });
  new vm.Script('"use strict";\n' + workerData.source, { filename: workerData.id + '.js' }).runInContext(context, { timeout: 1500 });
  plugin = exported;
  // Let chained db/store callbacks issue their follow-up requests before ready.
  for (let round = 0; round < 1400; round++) {
    await new Promise(resolve => setImmediate(resolve));
    if (!pending.size) {
      await new Promise(resolve => setImmediate(resolve));
      if (!pending.size) break;
    } else await new Promise(resolve => setTimeout(resolve, 10));
  }
  if (pending.size) throw new Error('Plugin initialization did not settle');
  parentPort.postMessage({ type: 'READY', meta: JSON.parse(JSON.stringify(exported.meta || {})), methods: Object.keys(exported).filter(key => typeof exported[key] === 'function') });
}

parentPort.on('message', async message => {
  if (message.type === 'API_RESULT') {
    const item = pending.get(message.requestId);
    if (!item) return;
    pending.delete(message.requestId); clearTimeout(item.timer);
    if (message.error) {
      const error = new Error(message.error.message || 'Plugin platform request failed');
      if (message.error.response !== undefined) error.response = message.error.response;
      if (message.error.code) error.code = message.error.code;
      item.reject(error);
    } else item.resolve(message.value);
  } else if (message.type === 'CALL') {
    try {
      if (!plugin || typeof plugin[message.method] !== 'function') throw new Error('Plugin method is unavailable');
      const result = await plugin[message.method](message.params || {});
      parentPort.postMessage({ type: 'RESULT', callId: message.callId, result });
    } catch (error) { parentPort.postMessage({ type: 'RESULT', callId: message.callId, error: { message: String(error.message || 'Plugin call failed'), code: String(error.code || '') } }); }
  }
});
process.on('unhandledRejection', error => parentPort.postMessage({ type: 'LOG', message: String(error && error.name || 'PluginRejection') }));
ready().catch(error => parentPort.postMessage({ type: 'LOAD_ERROR', message: String(error.message || 'Plugin load failed') }));
