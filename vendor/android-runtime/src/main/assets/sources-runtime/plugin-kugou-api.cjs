'use strict';
// Direct module calls keep the public-platform connection inside the existing
// runtime. There is no HTTP listener and no shared account/device cookie jar.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function deviceCookies(saved) {
  if (saved?.KUGOU_API_GUID && saved.KUGOU_API_MID && saved.KUGOU_API_DEV && saved.KUGOU_API_WEBGL) return saved;
  const guid = crypto.randomBytes(16).toString('hex');
  return {
    KUGOU_API_GUID: guid,
    KUGOU_API_MID: BigInt('0x' + crypto.createHash('md5').update(guid).digest('hex')).toString(),
    KUGOU_API_DEV: crypto.randomBytes(10).toString('hex').slice(0, 10).toUpperCase(),
    KUGOU_API_MAC: '02:00:00:00:00:00',
    KUGOU_API_WEBGL: crypto.randomBytes(8).readBigUInt64BE().toString()
  };
}

function cookieObject(header) {
  const result = {};
  for (const item of String(header || '').split(';')) {
    const split = item.indexOf('=');
    if (split > 0) result[item.slice(0, split).trim()] = item.slice(split + 1).trim();
  }
  return result;
}

function apiModule(method) {
  const directory = path.join(__dirname, 'node_modules/@neteasecloudmusicapienhanced/api/node_modules/kugoumusicapi');
  const file = path.join(directory, 'module', method + '.js');
  if (!fs.existsSync(file)) return undefined;
  const handler = require(file);
  const { createRequest } = require(path.join(directory, 'util/request.js'));
  return params => handler(params, options => createRequest(options));
}

function fullUrls(value) {
  return (Array.isArray(value) ? value : typeof value === 'string' ? [value] : [])
    .filter(url => typeof url === 'string' && /^https?:\/\//.test(url) && !/\/(?:part|trial)\//i.test(url));
}

function fullAudio(body) {
  if (body?.status !== 1 || [body.free_part, body.is_free_part, body.isFreePart].some(value => value === true || value === 1 || value === '1')) return false;
  return [body.url, body.backupUrl, body.backup_url].some(value => fullUrls(value).length);
}

/** Preserve ordinary highest-quality playback, then ask for lower authorized
 * qualities when the account/song has no high-resolution file. No trial mode. */
async function songUrl(params, invoke) {
  const request = { ...params, album_id: params.album_id || params.album?.id || 0,
    album_audio_id: params.album_audio_id || params.mxid || 0, free_part: 0 };
  let last;
  async function qualityUrl(method, values) {
    for (const quality of ['high', 'flac', '320', '128']) {
      try {
        const result = await invoke(method, { ...values, quality });
        last = result;
        if (fullAudio(result.body)) {
          const body = result.body;
          return { ...result, body: { ...body,
            url: fullUrls(body.url),
            backupUrl: [...fullUrls(body.backupUrl), ...fullUrls(body.backup_url)] } };
        }
      } catch (error) {
        // A transport failure is not evidence that changing audio quality helps.
        if (!error?.body || error.body.status !== 0 || !Number(error.body.error_code) || Number(error.body.error_code) === 20018) throw error;
        last = { status: error.status, body: error.body };
      }
    }
  }
  const ordinary = await qualityUrl('song_url', request);
  if (ordinary) return ordinary;
  // The current API documents a separate logged-in authorization flow. Ask
  // that user's session for authorization rather than treating a rejected
  // high-quality URL as proof that every quality is unavailable.
  if (request.cookie?.token && request.cookie?.userid) {
    const verified = await invoke('user_verify', { cookie: request.cookie });
    const authorization = verified.body?.status === 1 && verified.body?.data?.auth;
    if (authorization) {
      const authorized = await invoke('song_auth', { ...request, auth: authorization });
      const data = authorized.body?.status === 1 && authorized.body?.data;
      if (data?.auth && data.open_time !== undefined) {
        const result = await qualityUrl('song_url_auth', { ...request, auth: data.auth, open_time: data.open_time });
        if (result) return result;
      }
    }
  }
  return { status: last?.status || 200, body: { status: 1, url: [], backupUrl: [] } };
}

module.exports = { deviceCookies, cookieObject, apiModule, fullAudio, songUrl };
