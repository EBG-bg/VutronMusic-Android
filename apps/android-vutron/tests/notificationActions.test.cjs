const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
test('temporary lyric hiding targets a private short-lived Activity directly from its PendingIntent',()=>{
 const root=path.join(__dirname,'../android/app/src/main'),java=path.join(root,'java/io/github/vutronmusic/personal')
 const service=fs.readFileSync(path.join(java,'AndroidLyricOverlayService.java'),'utf8')
 const activity=fs.readFileSync(path.join(java,'LyricNotificationActionActivity.java'),'utf8')
 const manifest=fs.readFileSync(path.join(root,'AndroidManifest.xml'),'utf8')
 const branch=service.slice(service.indexOf('if (ACTION_TEMPORARY_HIDE.equals(action))'),service.indexOf('private void updateNotification'))
 assert.match(branch,/PendingIntent\.getActivity/);assert.match(branch,/LyricNotificationActionActivity\.class/)
 assert.match(activity,/temporaryHide\(this, LyricVisibility\.TEMPORARY_HIDE_MS\)/);assert.match(activity,/finish\(\)/)
 assert.doesNotMatch(activity,/MainActivity|startActivity|CLOSE_SYSTEM_DIALOGS/)
 const entry=manifest.match(/<activity android:name="\.LyricNotificationActionActivity"[\s\S]*?\/>/)[0]
 for(const flag of ['android:exported="false"','android:noHistory="true"','android:excludeFromRecents="true"'])assert.ok(entry.includes(flag))
})
