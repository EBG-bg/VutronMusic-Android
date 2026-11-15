const calls=[];
const image=size=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#29aaa5"/><circle cx="50%" cy="50%" r="25%" fill="#ffc98c"/></svg>`);
export const artworkTierBackend={calls,image};
export const vutronPlugin={async getArtwork(value){calls.push({kind:'native',...value});await new Promise(resolve=>setTimeout(resolve,15));return {uri:!value.url&&value.localUri?'file:///app/artwork-cache-v1/'+'c'.repeat(64)+'.img':image(value.size)}}};
export const musicPluginBridge={async resolveMusicPluginArtwork(value){calls.push({kind:'plugin',...value});return {uri:image(value.size)}}};
