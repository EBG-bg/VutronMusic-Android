'use strict';
const http = require('http');
const https = require('https');
const crypto = require('crypto');

/** Only user-configured plugin origins may use private/LAN media targets. */
function createPluginMediaGateway({ now = Date.now, allowed = () => true, request = (url, options, callback) => (url.protocol === 'https:' ? https : http).request(url, options, callback) } = {}) {
  const registered = new Map();
  const active = new Map();
  function register(pluginId, baseUrl, value) {
    const base = new URL(baseUrl), url = new URL(value.url);
    if (!['http:', 'https:'].includes(url.protocol) || !['http:', 'https:'].includes(base.protocol)
        || url.origin !== base.origin || url.username || url.password || url.hash || base.username || base.password) throw new Error('Media URL must belong to the configured plugin server');
    const headers = {};
    for (const [name, headerValue] of Object.entries(value.headers || {})) {
      if (!['authorization', 'cookie', 'x-emby-token', 'x-mediabrowser-token', 'x-emby-authorization', 'referer', 'origin', 'user-agent', 'accept'].includes(name.toLowerCase())) continue;
      if (typeof headerValue !== 'string' || /[\r\n]/.test(headerValue) || headerValue.length > 16384) throw new Error('Invalid media authentication header');
      headers[name.toLowerCase()] = headerValue;
    }
    for (const [key, item] of registered) if (item.expires < now()) registered.delete(key);
    while (registered.size >= 96) registered.delete(registered.keys().next().value);
    const id = crypto.randomBytes(24).toString('hex');
    registered.set(id, { pluginId, url, headers, expires: now() + 6*60*60*1000 });
    return '/plugin-media/' + id;
  }
  function revoke(pluginId) {
    for (const [id, item] of registered) if (!pluginId || item.pluginId === pluginId) registered.delete(id);
    for (const [request, id] of active) if (!pluginId || id === pluginId) request.destroy();
  }
  function handle(incoming, outgoing, target) {
    if (!target.pathname.startsWith('/plugin-media/')) return false;
    const id = target.pathname.slice('/plugin-media/'.length), item = registered.get(id);
    if (!/^[a-f0-9]{48}$/.test(id) || !item || item.expires < now() || !allowed(item.pluginId) || !['GET', 'HEAD'].includes(incoming.method)) { outgoing.writeHead(404); outgoing.end(); return true; }
    const headers = { ...item.headers };
    if (incoming.headers.range) {
      if (!/^bytes=\d*-\d*(?:,\d*-\d*)*$/.test(incoming.headers.range)) { outgoing.writeHead(416); outgoing.end(); return true; }
      headers.range = incoming.headers.range;
    }
    const upstream = request(item.url, { method: incoming.method, headers }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400) { response.resume(); outgoing.writeHead(502); outgoing.end(); return; }
      const forwarded = { 'Cache-Control': 'no-store' };
      for (const name of ['content-type','content-length','content-range','accept-ranges','etag','last-modified']) if (response.headers[name]) forwarded[name] = response.headers[name];
      outgoing.writeHead(response.statusCode || 502, forwarded);
      response.on('error', () => outgoing.destroy());
      response.pipe(outgoing);
    });
    active.set(upstream, item.pluginId);
    const deadline = setTimeout(() => upstream.destroy(), 15*60*1000);
    upstream.setTimeout?.(30000, () => upstream.destroy());
    upstream.once('error', () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); });
    upstream.once('close', () => { clearTimeout(deadline); active.delete(upstream); });
    outgoing.once('close', () => upstream.destroy());
    upstream.end();
    return true;
  }
  return { register, revoke, handle };
}
module.exports = { createPluginMediaGateway };
