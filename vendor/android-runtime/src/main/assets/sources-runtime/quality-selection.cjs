'use strict';

// Upstream match.js writes 999000 only when it recognizes the FLAC magic
// marker. This is a format sentinel, not a measured bitrate.
function describeQuality(result) {
  const br = Number(result && result.br);
  const isFlac = br === 999000;
  return {
    ...result,
    type: isFlac ? 'flac' : 'unknown',
    audioType: isFlac ? 'flac' : 'unknown',
    lossless: isFlac ? true : null,
    bitrateKind: isFlac ? 'matcher-flac-marker' : Number.isFinite(br) && br > 0 ? 'known' : 'unknown',
  };
}

function qualityRank(result) {
  if (result.lossless === true && result.audioType === 'flac') return Number.MAX_SAFE_INTEGER;
  const br = Number(result.br);
  return result.bitrateKind === 'known' && Number.isFinite(br) && br > 0 ? br : -1;
}

// Read duration metadata from the matcher's existing 8 KiB prefix. A leading
// MPEG bitrate alone is not evidence for a VBR stream's duration.
function probedAudioDuration(bytes, resourceSize) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== 8192) return 0;
  let start = 0;
  if (bytes.toString('latin1', 0, 3) === 'ID3') {
    const size = bytes.subarray(6, 10);
    if (size.some(byte => byte & 0x80)) return 0;
    start = 10 + size.reduce((total, byte) => total * 128 + byte, 0);
    if (bytes[3] === 4 && bytes[5] & 0x10) start += 10;
  }
  if (start + 42 > bytes.length) return 0;
  if (bytes.toString('latin1', start, start + 4) === 'fLaC') {
    if ((bytes[start + 4] & 0x7f) !== 0 || bytes.readUIntBE(start + 5, 3) !== 34) return 0;
    const rate = bytes.readUIntBE(start + 18, 3) >>> 4;
    const samples = (bytes[start + 21] & 0x0f) * 0x100000000 + bytes.readUInt32BE(start + 22);
    return rate ? samples * 1000 / rate : 0;
  }
  const version = (bytes[start + 1] >> 3) & 3;
  const layer = (bytes[start + 1] >> 1) & 3;
  const rateIndex = (bytes[start + 2] >> 2) & 3;
  const bitrateIndex = bytes[start + 2] >> 4;
  if (bytes[start] !== 0xff || (bytes[start + 1] & 0xe0) !== 0xe0 || version === 1
      || layer !== 1 || rateIndex === 3 || bitrateIndex === 0 || bitrateIndex === 15) return 0;
  const mpeg1 = version === 3;
  const sampleRate = [44100, 48000, 32000][rateIndex] / (mpeg1 ? 1 : version === 2 ? 2 : 4);
  const mono = (bytes[start + 3] >> 6) === 3;
  const xing = start + 4 + (mpeg1 ? mono ? 17 : 32 : mono ? 9 : 17);
  const vbri = start + 36;
  let frames = 0, encodedSize = 0;
  for (const offset of bytes[start + 1] & 1 ? [xing] : [xing, xing + 2]) {
    const tag = bytes.toString('latin1', offset, offset + 4);
    if (offset + 16 > bytes.length || (tag !== 'Info' && tag !== 'Xing')) continue;
    const flags = bytes.readUInt32BE(offset + 4);
    const count = Boolean(flags & 1);
    if (count) frames = bytes.readUInt32BE(offset + 8);
    if (flags & 2) encodedSize = bytes.readUInt32BE(offset + (count ? 12 : 8));
    break;
  }
  if (!frames && vbri + 18 <= bytes.length && bytes.toString('latin1', vbri, vbri + 4) === 'VBRI' && bytes.readUInt16BE(vbri + 4) === 1) {
    encodedSize = bytes.readUInt32BE(vbri + 10);
    frames = bytes.readUInt32BE(vbri + 14);
  }
  // A concatenated stream may carry an Info tag that covers only its first
  // part. Keep that duration unknown instead of treating it as a preview.
  if (encodedSize && resourceSize - start - encodedSize > Math.max(8192, encodedSize * 0.1)) return 0;
  return frames * (mpeg1 ? 1152 : 576) * 1000 / sampleRate;
}

function knownPreview(duration, referenceDuration) {
  const expected = Number(referenceDuration);
  return Number.isFinite(expected) && Number.isFinite(duration) && duration > 0
    && expected - duration > Math.max(5000, expected * 0.07);
}

async function compareValidatedSources(options) {
  const {
    sources: configuredSources, excludedSource, referenceDurationMs, concurrency, sourceTimeoutMs, totalTimeoutMs,
    isCancelled, createScope, cancelScope, find,
    onSuccess, onFailure, onTimeout,
  } = options;
  const sources = excludedSource ? configuredSources.filter(source => source !== excludedSource) : configuredSources;
  const startedAt = Date.now();
  const deadline = startedAt + totalTimeoutMs;
  const results = [];
  const activeScopes = new Set();
  let next = 0;
  let finished = false;

  const worker = async () => {
    while (!finished && !isCancelled() && Date.now() < deadline) {
      const source = sources[next++];
      if (!source) return;
      const sourceDeadline = Math.min(Date.now() + sourceTimeoutMs, deadline);
      const scope = createScope(source, sourceDeadline);
      activeScopes.add(scope);
      let timer;
      try {
        const result = await Promise.race([
          find(source, scope),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              const error = new Error('Source deadline');
              error.code = 'SOURCE_TIMEOUT';
              cancelScope(scope);
              reject(error);
            }, Math.max(1, sourceDeadline - Date.now()));
          }),
        ]);
        if (finished || isCancelled()) return;
        if (knownPreview(result.probedDurationMs, referenceDurationMs)) {
          const error = new Error('Matched audio is shorter than the recording');
          error.code = 'INCOMPLETE_MATCH_AUDIO';
          throw error;
        }
        results.push({ source, result });
        onSuccess(source, result);
      } catch (error) {
        if (!finished && !isCancelled()) onFailure(source, error);
      } finally {
        clearTimeout(timer);
        cancelScope(scope);
        activeScopes.delete(scope);
      }
    }
  };

  let totalTimer;
  await Promise.race([
    Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker)),
    new Promise((resolve) => {
      totalTimer = setTimeout(() => {
        finished = true;
        onTimeout();
        for (const scope of activeScopes) cancelScope(scope);
        resolve();
      }, Math.max(1, deadline - Date.now()));
    }),
  ]);
  clearTimeout(totalTimer);
  finished = true;

  if (isCancelled()) return null;
  results.sort((a, b) => {
    const identityDifference = (b.result.identityRank || 0) - (a.result.identityRank || 0);
    if (identityDifference) return identityDifference;
    const difference = qualityRank(b.result) - qualityRank(a.result);
    return difference || sources.indexOf(a.source) - sources.indexOf(b.source);
  });
  if (!results.length) return null;
  return { ...results[0], candidateCount: results.length, elapsedMs: Date.now() - startedAt };
}

module.exports = { compareValidatedSources, describeQuality, probedAudioDuration, qualityRank };
