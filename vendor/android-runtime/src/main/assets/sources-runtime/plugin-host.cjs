'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { Worker } = require('worker_threads');
const { AsyncLocalStorage } = require('async_hooks');
const pluginTransport = new AsyncLocalStorage();
for (const transport of [http, https]) {
  const original = transport.request;
  transport.request = function (...args) {
    const live = pluginTransport.getStore();
    if (live && !live.permitted()) throw problem('Plugin networking was cancelled', 'PLUGIN_OFFLINE');
    const request = original.apply(this, args);
    if (live) { live.requests.add(request); request.once('close', () => live.requests.delete(request)); }
    return request;
  };
}
const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_RESULT_BYTES = 8 * 1024 * 1024;
const MAX_STATE_BYTES = 32 * 1024 * 1024;
const MAX_PLUGINS = 64;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}(?::[a-zA-Z0-9_-]{1,48})?$/;

function problem(message, code = 'PLUGIN_ERROR') { return Object.assign(new Error(message), { code }); }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function brandResult(value, id) {
  if (Array.isArray(value)) return value.map(item => brandResult(item, id));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'sourceContext') result[key] = item;
    else if (key === 'pluginId' && item === '') result[key] = id;
    else Object.defineProperty(result, key, { value: brandResult(item, id), enumerable: true, writable: true, configurable: true });
  }
  return result;
}
function validId(value) { if (typeof value !== 'string' || !ID.test(value)) throw problem('Invalid plugin identity', 'PLUGIN_ID'); return value; }
function accountScope(id, local, baseUrl, account = {}, generation = 0) {
  const digest = text => crypto.createHash('sha256').update(text).digest('hex');
  if (local) return digest('plugin-account-v1\n' + id + '\nlocal');
  let server = baseUrl || '';
  try { const address = new URL(server); server = address.protocol.slice(0,-1).toLowerCase() + '://' + address.hostname.toLowerCase() + ':' + (address.port || (address.protocol==='https:'?443:80)) + address.pathname.replace(/\/+$/, ''); } catch { }
  let identity = '';
  for (const key of ['userId','user_id','userid','UserId','userName','username','account','email']) {
    const value = account[key]; if (typeof value !== 'string' && typeof value !== 'number') continue;
    const text = String(value).trim(); if (text && text !== '0') { identity = key.toLowerCase()+':'+text; break; }
  }
  if (!identity) identity = 'private-account-generation:' + generation;
  return digest('plugin-account-v1\n'+id+'\n'+server+'\n'+identity);
}
function safeUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw problem('Invalid plugin server URL', 'PLUGIN_URL');
  return url;
}
function redact(value) {
  return String(value).replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/["']?(?:cookie|password|passwd|pwd|token|authorization|secret)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '[private]')
    .replace(/[a-zA-Z0-9+/_=-]{48,}/g, '[private]').slice(0, 1000);
}

function createPluginHost({ root, builtins = path.join(__dirname, 'plugins'), workerFile = path.join(__dirname, 'plugin-worker.cjs'), validateResult, validateMeta, parseLyric, now = Date.now, callTimeoutMs = 25000, loadTimeoutMs = 15000, neteaseApi, fallbackSongUrl } = {}) {
  if (!root) throw new Error('Plugin storage directory is required');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const temporary = path.join(root, 'tmp'); fs.mkdirSync(temporary, { recursive:true, mode:0o700 });
  process.env.TMPDIR = temporary;
  process.env.DOTENV_CONFIG_QUIET = 'true';
  const registryFile = path.join(root, 'registry.json');
  let registry = read(registryFile, { format: 3, plugins: {} });
  const workers = new Map();
  const logs = new Map();
  let networkAllowed = true;
  let serial = 0;

  function read(file, fallback) {
    try {
      if (fs.statSync(file).size > MAX_STATE_BYTES) throw problem('Plugin storage exceeds its size limit', 'PLUGIN_STORAGE_LIMIT');
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) { if (error.code === 'ENOENT') return clone(fallback); throw error; }
  }
  function write(file, value) {
    const data = JSON.stringify(value);
    if (Buffer.byteLength(data) > MAX_STATE_BYTES) throw problem('Plugin storage exceeds its size limit', 'PLUGIN_STORAGE_LIMIT');
    const temporary = file + '.tmp'; fs.writeFileSync(temporary, data, { mode: 0o600 }); fs.renameSync(temporary, file);
  }
  function manifest() {
    const raw = read(path.join(builtins, 'builtin-index.json'), []);
    return Array.isArray(raw) ? raw : raw.plugins || [];
  }
  function initialize() {
    if (!registry || ![1,2,3].includes(registry.format) || !registry.plugins || typeof registry.plugins !== 'object' || Array.isArray(registry.plugins)) throw problem('Invalid plugin registry', 'PLUGIN_STORAGE');
    let changed = registry.format !== 3 || !fs.existsSync(registryFile);
    for (const item of manifest()) {
      const id = validId(item.id);
      const previous = registry.plugins[id];
      // A removed/never-registered source must not inherit an orphan account
      // when it becomes a permanently provided (initially closed) source.
      if (!previous) quarantineOrphan(id);
      const updated = installedBuiltin(item, previous);
      if (JSON.stringify(updated) !== JSON.stringify(registry.plugins[id])) { registry.plugins[id] = updated; changed = true; }
    }
    registry.format = 3;
    if (changed) write(registryFile, registry);
  }
  function quarantineOrphan(id) {
    const file = stateFile(id);
    if (!fs.existsSync(file)) return;
    const directory = path.join(root, 'inactive-orphans'); fs.mkdirSync(directory, { recursive:true, mode:0o700 });
    fs.renameSync(file, path.join(directory, id + '.' + crypto.randomBytes(12).toString('hex') + '.state.json'));
  }
  function installedBuiltin(item, previous) {
    const stored = previous || {};
    return { ...item, id:item.id, baseId:item.id, builtIn:true, enabled:previous ? previous.enabled !== false : false,
      status:stored.status || 'logout', name:stored.name || item.name, createdAt:stored.createdAt || now() };
  }
  initialize();

  function entry(id) { validId(id); const value = Object.prototype.hasOwnProperty.call(registry.plugins, id) ? registry.plugins[id] : null; if (!value) throw problem('Plugin is not installed', 'PLUGIN_NOT_FOUND'); return value; }
  function stateFile(id) { return path.join(root, validId(id) + '.state.json'); }
  function state(id) { return read(stateFile(id), { store: {}, db: { PluginData: {}, Track: [], Album: [], Artist: [], Playlist: [], PlaylistEntry: [] } }); }
  function saveState(id, data) { write(stateFile(id), data); }
  function codeFor(value) {
    const base = value.baseId && value.baseId !== value.id ? entry(value.baseId) : value;
    const file = base.builtIn ? path.join(builtins, validId(base.id) + '.js') : path.join(root, validId(base.id) + '.js');
    const data = fs.readFileSync(file); if (data.length > MAX_SOURCE_BYTES) throw problem('Plugin source exceeds 1 MiB', 'PLUGIN_SOURCE_LIMIT'); return data.toString('utf8');
  }
  function publicEntry(value) {
    const stored = state(value.id);
    return { id: value.id, baseId: value.baseId || value.id, name: value.name, type: value.type, icon: value.icon || '',
      enabled: value.enabled !== false, builtIn: !!value.builtIn, installed:true, capabilities: value.capabilities || {}, methods: value.methods || [],
      unsupportedMethods: value.unsupportedMethods || [],
      status: value.status || 'logout', baseUrl: typeof stored.store?.baseUrl === 'string' ? stored.store.baseUrl : '',
      accountScope: accountScope(value.id, value.type === 'local', stored.store?.baseUrl || '', stored.db?.PluginData || {}, stored.accountGeneration || 0) };
  }
  function list() { return { format:3, plugins: Object.values(registry.plugins).map(publicEntry), catalog: manifest().map(item => ({ ...item, baseId:item.id, builtIn:true, installed:true })) }; }
  function log(id, message, event = 'log') {
    const rows = logs.get(id) || [];
    rows.push({ time: now(), event, message: redact(message) });
    logs.set(id, rows.slice(-200));
  }
  function stop(id, reason = 'Plugin stopped') {
    const live = workers.get(id); if (!live) return;
    workers.delete(id); clearTimeout(live.idle);
    for (const controller of live.requests) controller.destroy(problem(reason, 'PLUGIN_CANCELLED'));
    for (const pending of live.pending.values()) { clearTimeout(pending.timer); pending.reject(problem(reason, 'PLUGIN_CANCELLED')); }
    live.pending.clear(); live.worker.terminate().catch(() => {});
  }
  function policy(allowed) {
    networkAllowed = allowed === true;
    if (!networkAllowed) for (const live of workers.values()) for (const request of live.requests) request.destroy(problem('Local-only mode forbids plugin networking', 'PLUGIN_OFFLINE'));
    return { allowed: networkAllowed };
  }
  function idle(live) {
    clearTimeout(live.idle);
    live.idle = setTimeout(() => { if (live.active === 0 && !live.pending.size) stop(live.id); }, 45000);
    live.idle.unref?.();
  }

  async function start(id, source, importing = false, allowNetwork = false) {
    let live = workers.get(id);
    if (live) { await live.ready; return live; }
    const existing = importing ? { id, enabled: true, type: 'library' } : entry(id);
    if (existing.enabled === false) throw problem('Plugin is disabled', 'PLUGIN_DISABLED');
    if (workers.size >= 8) {
      const inactive = [...workers.values()].find(item => !item.active && !item.pending.size);
      if (inactive) stop(inactive.id); else throw problem('Too many active plugins', 'PLUGIN_BUSY');
    }
    let readyResolve, readyReject;
    live = { id, importing, active: 1, allowed: allowNetwork, requests: new Set(), pending: new Map(), tail: Promise.resolve(), meta: {}, idle: null };
    live.ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    // A worker is an isolation/lifecycle boundary, not an OS security sandbox.
    live.worker = new Worker(workerFile, { workerData: { id, source: source || codeFor(existing) }, resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
    workers.set(id, live);
    const timeout = setTimeout(() => { readyReject(problem('Plugin initialization timed out', 'PLUGIN_TIMEOUT')); stop(id, 'Plugin initialization timed out'); }, loadTimeoutMs);
    live.worker.on('message', message => {
      if (message.type === 'READY') {
        try {
          const meta = validateMeta ? validateMeta(message.meta) : message.meta;
          if (!meta || typeof meta.name !== 'string' || !['local', 'library', 'stream'].includes(meta.type)) throw problem('Invalid plugin metadata', 'PLUGIN_METADATA');
          live.meta = { ...meta, methods: message.methods.filter(method => /^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(method)) };
          clearTimeout(timeout); live.active = 0; readyResolve(live); idle(live);
        } catch (error) { clearTimeout(timeout); readyReject(error); stop(id, 'Invalid plugin metadata'); }
      } else if (message.type === 'LOAD_ERROR') {
        clearTimeout(timeout); readyReject(problem(redact(message.message), 'PLUGIN_LOAD')); stop(id, 'Plugin could not be loaded');
      } else if (message.type === 'RESULT') {
        const item = live.pending.get(message.callId); if (!item) return;
        live.pending.delete(message.callId); clearTimeout(item.timer);
        if (message.error) item.reject(problem(redact(message.error.message), message.error.code || 'PLUGIN_CALL'));
        else item.resolve(message.result);
      } else if (message.type === 'LOG') log(id, message.message);
      else if (message.type === 'API_REQUEST') {
        Promise.resolve().then(() => apiRequest(live, message)).then(value => live.worker.postMessage({ type: 'API_RESULT', requestId: message.requestId, value }),
          error => live.worker.postMessage({ type: 'API_RESULT', requestId: message.requestId, error: { message: redact(error.message), code: error.code, response: error.response } })).catch(() => {});
      }
    });
    live.worker.once('error', error => { clearTimeout(timeout); log(id, error.name || 'WorkerError', 'worker-error'); readyReject(problem('Plugin worker failed', 'PLUGIN_WORKER')); stop(id, 'Plugin worker failed'); });
    live.worker.once('exit', code => { clearTimeout(timeout); if (workers.get(id) === live) { readyReject(problem('Plugin worker exited', 'PLUGIN_WORKER')); stop(id, 'Plugin worker exited'); } });
    try { await live.ready; return live; } catch (error) { throw error; }
  }

  function dottedGet(value, key) {
    if (!key) return value;
    let current = value;
    for (const part of String(key).split('.')) { if (FORBIDDEN_KEYS.has(part)) throw problem('Invalid storage key', 'PLUGIN_STORAGE_KEY'); current = current?.[part]; }
    return current;
  }
  function dottedSet(value, key, item) {
    const parts = String(key).split('.');
    if (!key || parts.some(part => !part || FORBIDDEN_KEYS.has(part))) throw problem('Invalid storage key', 'PLUGIN_STORAGE_KEY');
    let target = value;
    for (const part of parts.slice(0, -1)) { if (!target[part] || typeof target[part] !== 'object' || Array.isArray(target[part])) target[part] = {}; target = target[part]; }
    target[parts.at(-1)] = clone(item);
  }
  async function apiRequest(live, message) {
    if (workers.get(live.id) !== live) throw problem('Plugin was stopped before the platform operation', 'PLUGIN_CANCELLED');
    const data = state(live.id);
    data.store ||= {}; data.db ||= {};
    switch (message.operation) {
      case 'storeGet': return clone(dottedGet(data.store, message.key));
      case 'storeSet':
        if (message.key === 'baseUrl' && message.value) safeUrl(message.value);
        dottedSet(data.store, message.key, message.value); saveState(live.id, data); return true;
      case 'dbGet': return dbGet(data.db, message.table, message.filter);
      case 'dbSet': dbSet(data.db, message.table, message.value); saveState(live.id, data); return true;
      case 'parseLyric': return parseLyric ? parseLyric(message.value) : require('./plugin-lyrics.cjs').parseLyric(message.value);
      case 'fileExists': return (Array.isArray(message.paths) ? message.paths : []).slice(0, 10000).map(file => ({ path: String(file), exist: !!data.resources?.[file]?.exists, authorized: !!data.resources?.[file] }));
      case 'localLyric': return data.resources?.[message.filePath]?.[message.embedded === true ? 'embeddedLyrics' : 'pathLyrics'] || [];
      case 'http': return requestHttp(live, data, message);
      default: throw problem('Unknown plugin platform operation', 'PLUGIN_API');
    }
  }
  function dbGet(db, table, filter = {}) {
    if (table === 'PluginData') return clone(db.PluginData || {});
    if (!['Track', 'Album', 'Artist', 'Playlist', 'PlaylistEntry'].includes(table)) throw problem('Unsupported plugin table', 'PLUGIN_DB');
    let rows = Array.isArray(db[table]) ? db[table] : [];
    if (Array.isArray(filter?.ids)) { const ranks = new Map(filter.ids.map((id, index) => [String(id), index])); rows = rows.filter(row => ranks.has(String(row.id))).sort((a, b) => ranks.get(String(a.id)) - ranks.get(String(b.id))); }
    if (filter?.id !== undefined) rows = rows.filter(row => String(row.id) === String(filter.id));
    if (table === 'PlaylistEntry') {
      if (filter?.$count && Array.isArray(filter.playlistIds)) return Object.fromEntries(filter.playlistIds.map(id => [id, rows.filter(row => String(row.playlistId) === String(id)).length]));
      rows = rows.filter(row => String(row.playlistId) === String(filter.playlistId)).sort((a, b) => (a.position || 0) - (b.position || 0));
      if (filter?.$first) return clone(rows.at(-1) || null);
    }
    return clone(table === 'Track' ? { code: 200, songs: rows, privileges: {} } : rows);
  }
  function dbSet(db, table, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw problem('Invalid plugin table value', 'PLUGIN_DB');
    if (table === 'PluginData') { db.PluginData = clone(value); return; }
    if (!['Track', 'Album', 'Artist', 'Playlist', 'PlaylistEntry'].includes(table)) throw problem('Unsupported plugin table', 'PLUGIN_DB');
    const rows = db[table] ||= [];
    if (table === 'PlaylistEntry' && value._reorder) {
      const ranks = new Map((value.orderedEntryIds || []).map((id, index) => [String(id), index]));
      for (const row of rows) if (String(row.playlistId) === String(value.playlistId) && ranks.has(String(row.id))) row.position = ranks.get(String(row.id));
      return;
    }
    if (value._delete) { db[table] = rows.filter(row => String(row.id) !== String(value.id)); if (table === 'Playlist') db.PlaylistEntry = (db.PlaylistEntry || []).filter(row => String(row.playlistId) !== String(value.id)); return; }
    if (table === 'PlaylistEntry' && !value.id && value.playlistId) {
      rows.push({ id: crypto.randomBytes(12).toString('hex'), playlistId: String(value.playlistId), pluginId: String(value.pluginId || ''), sourceContext: typeof value.sourceContext === 'string' ? value.sourceContext : JSON.stringify(value.sourceContext || {}), position: rows.length, createTime: now() }); return;
    }
    if (value.id === undefined) throw problem('Missing plugin record identity', 'PLUGIN_DB');
    let row = rows.find(item => String(item.id) === String(value.id));
    if (!row) { row = { id: String(value.id), createTime: now() }; rows.push(row); }
    for (const [key, item] of Object.entries(value)) if (!key.startsWith('$') && !key.startsWith('_') && !FORBIDDEN_KEYS.has(key)) row[key] = clone(item);
    if (value.$inc) for (const [key, item] of Object.entries(value.$inc)) if (!FORBIDDEN_KEYS.has(key) && Number.isFinite(item)) row[key] = (Number(row[key]) || 0) + item;
    row.updateTime = now();
  }

  function requestHttp(live, stored, message) {
    if (!networkAllowed || !live.allowed || live.active === 0 || live.importing) throw problem('Local-only mode forbids plugin networking', 'PLUGIN_OFFLINE');
    let target, allowed;
    try { target = safeUrl(message.url); allowed = safeUrl(stored.store?.baseUrl); } catch { throw problem('Configure the plugin server URL first', 'PLUGIN_SERVER'); }
    if (target.origin !== allowed.origin) throw problem('Plugin request is outside the configured server', 'PLUGIN_DOMAIN');
    for (const [key, value] of Object.entries(message.params || {})) if (value !== null && value !== undefined) target.searchParams.set(key, String(value));
    const baseId = live.importing ? '' : entry(live.id).baseId;
    if (baseId === 'netease' && ['localhost', '127.0.0.1'].includes(target.hostname)
        && target.port === '41830' && target.pathname.startsWith('/netease/')) {
      return neteaseRequest(live, target, message);
    }
    const headers = { 'User-Agent': 'VutronMusic-Mobile/1.0', ...(message.method !== 'GET' ? { 'Content-Type': 'application/json' } : {}) };
    for (const [key, value] of Object.entries(message.headers || {})) {
      if (!/^[A-Za-z0-9-]{1,64}$/.test(key) || /^(?:host|connection|content-length)$/i.test(key) || typeof value !== 'string' || /[\r\n]/.test(value) || value.length > 16384) throw problem('Invalid plugin HTTP header', 'PLUGIN_HTTP');
      headers[key] = value;
    }
    const body = message.method === 'GET' ? undefined : Buffer.from(JSON.stringify(message.data || {}));
    if (body && body.length > MAX_RESULT_BYTES) throw problem('Plugin HTTP body exceeds its size limit', 'PLUGIN_HTTP_LIMIT');
    return new Promise((resolve, reject) => {
      const request = (target.protocol === 'https:' ? https : http).request(target, { method: message.method, headers }, response => {
        const chunks = []; let size = 0;
        response.on('data', chunk => { size += chunk.length; if (size > MAX_RESULT_BYTES) request.destroy(problem('Plugin HTTP result exceeds its size limit', 'PLUGIN_HTTP_LIMIT')); else chunks.push(chunk); });
        response.on('error', reject);
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8'); let result = text;
          if ((response.headers['content-type'] || '').includes('json') || /^\s*[\[{]/.test(text)) try { result = JSON.parse(text); } catch { }
          if (response.statusCode >= 300 && response.statusCode < 400) reject(problem('Plugin HTTP redirects are blocked', 'PLUGIN_REDIRECT'));
          else if (response.statusCode >= 400) reject(Object.assign(problem('Plugin server returned HTTP ' + response.statusCode, 'PLUGIN_HTTP'), { response: result }));
          else resolve(message.raw ? { data: result, status: response.statusCode, headers: response.headers } : result);
        });
      });
      live.requests.add(request);
      const timeout = setTimeout(() => request.destroy(problem('Plugin network request timed out', 'PLUGIN_HTTP_TIMEOUT')), 12000);
      request.once('close', () => { live.requests.delete(request); clearTimeout(timeout); });
      request.once('error', reject);
      if (body) request.end(body); else request.end();
    });
  }

  async function neteaseRequest(live, target, message) {
    const method = target.pathname.slice('/netease/'.length).replace(/\//g, '_');
    if (!/^[a-z][a-z0-9_]{1,95}$/.test(method)) throw problem('Invalid NetEase API method', 'PLUGIN_METHOD');
    const params = Object.fromEntries(target.searchParams);
    if (message.method !== 'GET' && message.data && typeof message.data === 'object') Object.assign(params, message.data);
    const cookie = Object.entries(message.headers || {}).find(([key]) => key.toLowerCase() === 'cookie')?.[1];
    if (cookie) params.cookie = cookie;
    if (method === 'unblock_song_url') {
      if (!fallbackSongUrl || live.allowMatchSources === false) return { code: 404 };
      return pluginTransport.run({ requests: live.requests, permitted: () => networkAllowed && live.allowed && live.active > 0 }, () => fallbackSongUrl(String(params.id)));
    }
    const enhanced = neteaseApi || require('@neteasecloudmusicapienhanced/api');
    if (typeof enhanced[method] !== 'function') return message.raw ? { data: { code: 404 }, status: 404, headers: {} } : { code: 404 };
    // The enhanced API owns encryption/transport; only this plugin's cookie is
    // supplied. Never read the native NetEase session from application storage.
    const result = await pluginTransport.run({ requests: live.requests, permitted: () => networkAllowed && live.allowed && live.active > 0 }, () => enhanced[method](params));
    return message.raw ? { data: result.body, status: result.status || 200, headers: { 'set-cookie': result.cookie || [] } } : result.body;
  }

  async function call(id, method, params = {}, allowNetwork = false, allowMatchSources = true, expectedAccountScope = '') {
    const selected = entry(id);
    if (selected.enabled === false) throw problem('Plugin is disabled', 'PLUGIN_DISABLED');
    if (typeof method !== 'string' || !/^[a-zA-Z][A-Za-z0-9]{0,63}$/.test(method)) throw problem('Invalid plugin method', 'PLUGIN_METHOD');
    const live = await start(id, null, false, allowNetwork);
    if (!live.meta.methods.includes(method)) {
      const fallback = require('./plugin-contract.cjs').defaultMap?.[method];
      return clone(fallback || { code: 404 });
    }
    const operation = live.tail.catch(() => {}).then(async () => {
      if (workers.get(id) !== live) throw problem('Plugin was disabled or removed', 'PLUGIN_CANCELLED');
      if (expectedAccountScope) {
        const stored = state(id);
        const current = accountScope(id, selected.type === 'local', stored.store?.baseUrl || '', stored.db?.PluginData || {}, stored.accountGeneration || 0);
        if (current !== expectedAccountScope) throw problem('Plugin account changed before the queued operation', 'PLUGIN_ACCOUNT_CHANGED');
      }
      live.active++; live.allowed = allowNetwork; live.allowMatchSources = allowMatchSources; clearTimeout(live.idle);
      try {
        const result = await new Promise((resolve, reject) => {
          const callId = ++serial;
          const timer = setTimeout(() => { reject(problem('Plugin call timed out', 'PLUGIN_TIMEOUT')); stop(id, 'Plugin call timed out'); }, callTimeoutMs);
          live.pending.set(callId, { resolve, reject, timer });
          live.worker.postMessage({ type: 'CALL', callId, method, params: clone(params) });
        });
        if (Buffer.byteLength(JSON.stringify(result) || '') > MAX_RESULT_BYTES) throw problem('Plugin result exceeds its size limit', 'PLUGIN_RESULT_LIMIT');
        const validated = validateResult ? validateResult(method, result) : require('./plugin-contract.cjs').validateResult(method, result);
        if (method === 'systemPing' && validated?.status) { selected.status = validated.status; write(registryFile, registry); }
        if (method === 'doLogout' && validated?.code === 200) { selected.status = 'logout'; write(registryFile, registry); }
        if ((validated?.code === 200 && ['doLogin','doLogout','updateBaseUrl'].includes(method)) || method === 'loginQrCodeCheck' && validated?.code === 803) {
          const persisted = state(id); persisted.accountGeneration = (persisted.accountGeneration || 0) + 1; saveState(id, persisted);
        }
        return brandResult(validated, id);
      } catch (error) { log(id, error.code || error.name, 'call-error'); throw error; }
      finally { live.active--; if (workers.get(id) === live) idle(live); }
    });
    live.tail = operation.catch(() => {});
    return operation;
  }

  async function manage(request) {
    const action = request.action;
    if (action === 'list') return list();
    if (action === 'policy') return policy(request.allowNetwork);
    if (action === 'syncLocalLibrary') {
      const id = request.id || 'local', selected = entry(id);
      if (selected.enabled === false) throw problem('Plugin is disabled', 'PLUGIN_DISABLED');
      if (selected.type !== 'local') throw problem('Only a local plugin can receive the local index', 'PLUGIN_NOT_LOCAL');
      const data = state(id); data.db ||= {};
      const fingerprint = typeof request.fingerprint === 'string' ? request.fingerprint.slice(0, 128) : '';
      if (fingerprint && fingerprint === data.localLibraryFingerprint) return { changed: false };
      for (const table of ['Track', 'Album', 'Artist']) if (Array.isArray(request.tables?.[table])) {
        const previous = new Map((data.db[table] || []).map(row => [String(row.id), row]));
        data.db[table] = request.tables[table].map(row => ({ ...row, ...(previous.get(String(row.id)) ? Object.fromEntries(['liked', 'followed', 'subscribed', 'playCount', 'lastPlayed', 'lastPlayedAt', 'updateTime'].filter(key => previous.get(String(row.id))[key] !== undefined).map(key => [key, previous.get(String(row.id))[key]])) : {}) }));
      }
      if (request.resources && typeof request.resources === 'object') data.resources = clone(request.resources);
      if (fingerprint) data.localLibraryFingerprint = fingerprint;
      saveState(id, data); return { changed: true };
    }
    if (action === 'resources') { const selected=entry(request.id);if(selected.enabled===false)throw problem('Plugin is disabled','PLUGIN_DISABLED');const data = state(request.id); data.resources = { ...(data.resources || {}), ...clone(request.resources || {}) }; saveState(request.id, data); return { changed: true }; }
    if (action === 'import' || action === 'inspect') {
      const source = request.source;
      if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > MAX_SOURCE_BYTES) throw problem('Select a JavaScript plugin no larger than 1 MiB', 'PLUGIN_SOURCE_LIMIT');
      if (Object.keys(registry.plugins).length >= MAX_PLUGINS) throw problem('At most 64 plugins can be installed', 'PLUGIN_LIMIT');
      const id = 'user_' + crypto.randomBytes(12).toString('hex');
      let live;
      try { live = await start(id, source, true, false); }
      catch (error) {
        stop(id);
        try { fs.unlinkSync(stateFile(id)); } catch (cleanup) { if (cleanup.code !== 'ENOENT') throw Object.assign(problem('Temporary plugin state could not be removed', 'PLUGIN_STORAGE'), { cause:error }); }
        logs.delete(id); throw error;
      }
      const meta = live.meta;
      stop(id);
      if (action === 'inspect') { try { fs.unlinkSync(stateFile(id)); } catch (error) { if (error.code !== 'ENOENT') throw error; } logs.delete(id); return { plugin: { ...meta, id, builtIn: false, enabled: true } }; }
      fs.writeFileSync(path.join(root, id + '.js'), source, { mode: 0o600 });
      registry.plugins[id] = { ...meta, id, baseId: id, builtIn: false, enabled: true, status: 'logout', createdAt: now() };
      write(registryFile, registry); return { ...list(), plugin: publicEntry(registry.plugins[id]) };
    }
    const id = validId(request.id);
    if (action === 'install') {
      const item = manifest().find(value => value.id === id);
      if (!item) throw problem('The plugin is not in the bundled catalog', 'PLUGIN_CATALOG');
      if (registry.plugins[id]) return { ...list(), plugin:publicEntry(registry.plugins[id]), installed:false };
      if (Object.keys(registry.plugins).length >= MAX_PLUGINS) throw problem('At most 64 plugins can be installed', 'PLUGIN_LIMIT');
      quarantineOrphan(id);
      const next = { ...registry, plugins:{ ...registry.plugins, [id]:installedBuiltin(item) } };
      write(registryFile, next); registry = next;
      return { ...list(), plugin:publicEntry(registry.plugins[id]), installed:true };
    }
    const selected = entry(id);
    if (action === 'logs') return { logs: clone(logs.get(id) || []) };
    if (action === 'instance') {
      entry(selected.baseId || selected.id);
      if (Object.keys(registry.plugins).length >= MAX_PLUGINS) throw problem('At most 64 plugins can be installed', 'PLUGIN_LIMIT');
      const instanceId = validId((selected.baseId || selected.id).split(':')[0] + ':' + crypto.randomBytes(6).toString('hex'));
      registry.plugins[instanceId] = { ...selected, id: instanceId, baseId: selected.baseId || selected.id, builtIn: false,
        name: String(request.name || selected.name).trim().slice(0, 120), enabled: true, status: 'logout', createdAt: now() };
      write(registryFile, registry); return { ...list(), plugin: publicEntry(registry.plugins[instanceId]) };
    }
    if (action === 'remove' || action === 'reset') {
      const provided = manifest().some(item => item.id === id) && selected.builtIn === true && (selected.baseId || id) === id;
      if (action === 'remove' && provided) throw problem('Built-in sources remain provided; close the source or explicitly clear its plugin data', 'PLUGIN_BUILTIN_PROVIDED');
      if (action === 'reset' && !provided) throw problem('Only a provided built-in source supports clearing its plugin data', 'PLUGIN_NOT_BUILTIN');
      if (action === 'remove' && Object.values(registry.plugins).some(value => value.id !== id && value.baseId === id)) throw problem('Remove this plugin’s instances first', 'PLUGIN_INSTANCES');
      stop(id, action === 'reset' ? 'Plugin data reset' : 'Plugin removed');
      const originals = [];
      for (const file of [stateFile(id), path.join(root,id+'.js')]) {
        try { if(fs.statSync(file).size>MAX_STATE_BYTES)throw problem('Plugin storage exceeds its size limit','PLUGIN_STORAGE_LIMIT'); originals.push({file,bytes:fs.readFileSync(file)}); }
        catch(error){if(error.code!=='ENOENT')throw error;}
      }
      const next = { ...registry, plugins:{ ...registry.plugins } };
      if (action === 'reset') next.plugins[id] = { ...selected, enabled:false, status:'logout' };
      else delete next.plugins[id];
      try {
        for(const value of originals)fs.unlinkSync(value.file);
        write(registryFile,next); registry=next;
      } catch(error) {
        for(const value of originals)if(!fs.existsSync(value.file)) {
          try { const temporary=value.file+'.restore';fs.writeFileSync(temporary,value.bytes,{mode:0o600});fs.renameSync(temporary,value.file); }
          catch(restore){throw Object.assign(problem('Plugin removal failed and private data could not be restored','PLUGIN_STORAGE'),{cause:error,restoreCode:restore.code});}
        }
        throw error;
      }
      logs.delete(id); return { ...list(), ...(action === 'reset' ? { reset:true } : { removed:true }) };
    }
    if (action === 'enable' || action === 'disable') {
      const next = { ...registry, plugins:{ ...registry.plugins, [id]:{ ...selected, enabled:action === 'enable' } } };
      write(registryFile,next); selected.enabled=action === 'enable';
      if (!selected.enabled) stop(id, 'Plugin disabled');
      return list();
    }
    if (action === 'configure') {
      const data = state(id); data.store ||= {};
      if (request.baseUrl !== undefined) data.store.baseUrl = request.baseUrl ? safeUrl(request.baseUrl).toString().replace(/\/$/, '') : '';
      data.accountGeneration = (data.accountGeneration || 0) + 1;
      saveState(id, data); stop(id, 'Plugin configuration changed'); return list();
    }
    throw problem('Unknown plugin management action', 'PLUGIN_ACTION');
  }
  async function handle(request) {
    if (request.action === 'call') { policy(request.allowNetwork === true); return { result: await call(request.id, request.method, request.params || {}, request.allowNetwork === true, request.allowMatchSources !== false, request.expectedAccountScope || '') }; }
    return manage(request);
  }
  function close() { for (const id of [...workers.keys()]) stop(id); }
  return { handle, list, manage, call, policy, close, canNetwork: id => networkAllowed && !!registry.plugins[id] && registry.plugins[id].enabled !== false };
}

module.exports = { createPluginHost, validId, redact, brandResult, accountScope };
