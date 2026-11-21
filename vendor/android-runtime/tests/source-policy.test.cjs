'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const runtime=path.resolve(__dirname,'../src/main/assets/sources-runtime');
const policy=require(path.join(runtime,'source-policy.json'));
const {compareValidatedSources, probedAudioDuration}=require(path.join(runtime,'quality-selection.cjs'));

test('a failed matching provider is skipped for this song recovery without weakening the remaining ranking',async()=>{
  const calls=[];
  const options={ sources:policy.fallbackSources, concurrency:2, sourceTimeoutMs:250, totalTimeoutMs:1000,
    isCancelled:()=>false, createScope:()=>({}), cancelScope:()=>{}, onSuccess:()=>{}, onFailure:()=>{}, onTimeout:()=>{},
    find:async source=>{
      calls.push(source);
      if(!['bodian','kuwo','kugou'].includes(source)) throw new Error('No verified candidate');
      return {source,identityRank:source==='kugou'?1:2,br:source==='kuwo'?128000:320000,bitrateKind:'known'};
    }
  };
  assert.equal((await compareValidatedSources(options)).source,'bodian');
  calls.length=0;
  const recovered=await compareValidatedSources({...options,excludedSource:'bodian'});
  assert.equal(recovered.source,'kuwo');
  assert.equal(recovered.candidateCount,2);
  assert.equal(calls.includes('bodian'),false);
  assert.equal(await compareValidatedSources({...options,sources:['bodian'],excludedSource:'bodian'}),null);
  assert.equal((await compareValidatedSources(options)).source,'bodian');
});

// The two MPEG frames/counts match the measured 94.772s and 11.546s
// layouts. No media bytes or URLs from the real song are stored in fixtures.
function mp3Prefix(start, frames, resourceSize, tag = 'Info') {
  const bytes = Buffer.alloc(8192);
  if (start >= 10) {
    bytes.write('ID3'); bytes[3] = 3;
    bytes[8] = (start - 10) >> 7; bytes[9] = (start - 10) & 127;
  }
  Buffer.from('fffb9064', 'hex').copy(bytes, start);
  if (tag) {
    bytes.write(tag, start + 36);
    bytes.writeUInt32BE(3, start + 40);
    bytes.writeUInt32BE(frames, start + 44);
    bytes.writeUInt32BE(resourceSize - start, start + 48);
  }
  return bytes;
}
function flacPrefix(durationMs) {
  const bytes = Buffer.alloc(8192);
  bytes.write('fLaC'); bytes[7] = 34;
  bytes.writeUIntBE(44100 << 4, 18, 3);
  bytes.writeUInt32BE(Math.round(44100 * durationMs / 1000), 22);
  return bytes;
}

test('a confirmed preview cannot outrank another complete, identity-validated candidate', async () => {
  const inputs = {
    bodian: [3, 128000, 1517119, mp3Prefix(219, 3628, 1517119)],
    kuwo: [3, 128000, 185336, mp3Prefix(54, 442, 185336)],
    pyncmd: [1, 999000, 5969907, flacPrefix(94733)],
  };
  const failures = [];
  const options = {
    sources: Object.keys(inputs), concurrency: 3, sourceTimeoutMs: 250, totalTimeoutMs: 1000, referenceDurationMs: 94733,
    isCancelled: () => false, createScope: () => ({}), cancelScope: () => {}, onSuccess: () => {},
    onFailure: (source, error) => failures.push([source, error.code]), onTimeout: () => {},
    find(source) {
      const [identityRank, br, resourceSize, sample] = inputs[source];
      return Promise.resolve({ identityRank, br, bitrateKind: 'known', probedDurationMs: probedAudioDuration(sample, resourceSize) });
    },
  };
  const selected = await compareValidatedSources(options);
  assert.equal(selected.source, 'bodian'); // Keep the existing identity ranking over a different provider's FLAC.
  assert.equal(selected.candidateCount, 2);
  assert.equal(Math.round(selected.result.probedDurationMs), 94772);
  assert.deepEqual(failures, [['kuwo', 'INCOMPLETE_MATCH_AUDIO']]);
  failures.length = 0;
  const recovered = await compareValidatedSources({ ...options, excludedSource: 'bodian' });
  assert.equal(recovered.source, 'pyncmd');
  assert.equal(recovered.candidateCount, 1);
  assert.equal(Math.round(recovered.result.probedDurationMs), 94733);
  assert.deepEqual(failures, [['kuwo', 'INCOMPLETE_MATCH_AUDIO']]);
});

test('missing or inconsistent prefix metadata does not guess duration from bitrate', () => {
  const tagged = mp3Prefix(54, 442, 185336, 'Xing');
  assert.equal(Math.round(probedAudioDuration(tagged, 185336)), 11546);
  assert.equal(probedAudioDuration(tagged, 1517119), 0, 'A tag covering only the first part of a longer stream is not decisive');
  assert.equal(probedAudioDuration(mp3Prefix(54, 442, 185336, null), 185336), 0);
  assert.equal(probedAudioDuration(Buffer.alloc(8192), 185336), 0);
  assert.equal(probedAudioDuration(tagged.subarray(0, 128), 185336), 0);
  const partial = mp3Prefix(8140, 442, 185336, null);
  partial.writeUInt8(0xfa, 8141);
  partial.write('Xing', 8178);
  assert.equal(probedAudioDuration(partial, 185336), 0, 'Tagged frame can straddle the sample boundary');
});

test('the shared audio fallback catalogue keeps the established real provider set',()=>{
  assert.equal(policy.format,1);
  assert.deepEqual(policy.fallbackSources,['bodian','kuwo','kugou','qq','bilibili','pyncmd','migu']);
  assert.equal(new Set(policy.fallbackSources).size,policy.fallbackSources.length);
  for(const id of policy.fallbackSources) assert.ok(fs.existsSync(path.join(runtime,'node_modules/@unblockneteasemusic/server/src/provider',id+'.js')),id+' has a real bundled matcher');
});
