const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const source=fs.readFileSync(path.join(__dirname,'../android/app/src/main/java/io/github/vutronmusic/personal/AndroidPlaybackService.java'),'utf8')
function method(signature){const start=source.indexOf(signature);assert.ok(start>=0);return source.slice(start,source.indexOf('\n    }',start)+6)}
test('idle housekeeping cannot run from service creation before the first playback command',()=>{
 const create=method('@Override public void onCreate()'),command=method('@Override public int onStartCommand(')
 assert.equal(create.includes('post(progressTicker)'),false)
 assert.ok(command.indexOf('startForeground(')<command.indexOf('post(progressTicker)'))
 assert.ok(command.includes('!progressTickerStarted'))
 assert.ok(command.includes('progressTickerStarted = true'))
 assert.equal(source.split('progressHandler.post(progressTicker)').length-1,1)
 assert.ok(method('@Override public void onDestroy()').includes('removeCallbacks(progressTicker)'))
})
test('cold notification Stop promotes before cleanup instead of violating the foreground-service contract',()=>{
 const command=method('@Override public int onStartCommand('),promote=command.indexOf('startForeground(')
 assert.ok(promote>=0)
 assert.equal(command.slice(0,promote).includes('if ('),false,'Promotion is unconditional for all start intents')
 assert.ok(command.indexOf('stopSelf(startId)')>promote)
})
