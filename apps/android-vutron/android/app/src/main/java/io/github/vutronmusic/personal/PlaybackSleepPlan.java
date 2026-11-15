package io.github.vutronmusic.personal;

import org.json.JSONObject;

/** Native playback owns expiry/counting; the WebView only presents snapshots. */
final class PlaybackSleepPlan {
    static final long MAX_DURATION = 24L * 60 * 60 * 1000;
    final String mode, trackKey;
    final long deadline, fadeWindowMs;
    final int remainingTracks, fadeSeconds;

    private PlaybackSleepPlan(String mode, long deadline, int tracks, int fadeSeconds, long fadeWindowMs, String trackKey) {
        this.mode=mode;this.deadline=deadline;this.remainingTracks=tracks;this.fadeSeconds=fadeSeconds;
        this.fadeWindowMs=fadeWindowMs;this.trackKey=trackKey;
    }
    static PlaybackSleepPlan none() { return new PlaybackSleepPlan("duration",0,0,0,0,""); }
    static PlaybackSleepPlan create(String mode,long durationMs,int tracks,int fadeSeconds,long now,String trackKey,boolean abEnabled) {
        if (!"duration".equals(mode)&&!"track".equals(mode)&&!"count".equals(mode)) throw new IllegalArgumentException("睡眠定时模式无效");
        if (fadeSeconds!=0&&fadeSeconds!=5&&fadeSeconds!=15&&fadeSeconds!=30) throw new IllegalArgumentException("淡出时间无效");
        if (!"duration".equals(mode) && abEnabled) throw new IllegalArgumentException("请先关闭 A/B 循环，再设置按歌曲结束的睡眠定时");
        if ("duration".equals(mode)) {
            if (durationMs<1000||durationMs>MAX_DURATION) throw new IllegalArgumentException("睡眠定时应为1秒至24小时");
            return new PlaybackSleepPlan(mode,now+durationMs,0,fadeSeconds,Math.min(durationMs,fadeSeconds*1000L),"");
        }
        if (trackKey==null||trackKey.isEmpty()) throw new IllegalArgumentException("请先播放歌曲");
        if ("count".equals(mode)&&(tracks<1||tracks>100)) throw new IllegalArgumentException("歌曲数量应为1至100首");
        return new PlaybackSleepPlan(mode,0,"track".equals(mode)?1:tracks,fadeSeconds,fadeSeconds*1000L,"track".equals(mode)?trackKey:"");
    }
    static PlaybackSleepPlan read(JSONObject data,long legacyDeadline) {
        if (data==null) return legacyDeadline>0?new PlaybackSleepPlan("duration",legacyDeadline,0,0,0,""):none();
        String mode=data.optString("mode","duration");
        int fade=data.optInt("fadeSeconds");
        if (fade!=0&&fade!=5&&fade!=15&&fade!=30) fade=0;
        if ("duration".equals(mode)) {
            long deadline=data.optLong("deadlineMs");
            return deadline>0?new PlaybackSleepPlan(mode,deadline,0,fade,Math.max(0,Math.min(fade*1000L,data.optLong("fadeWindowMs",fade*1000L))),""):none();
        }
        int tracks=data.optInt("remainingTracks");String key=data.optString("trackKey","");
        if (("track".equals(mode)||"count".equals(mode))&&tracks>0&&tracks<=100&&(!"track".equals(mode)||!key.isEmpty()))
            return new PlaybackSleepPlan(mode,0,tracks,fade,fade*1000L,key);
        return none();
    }
    boolean active() { return "duration".equals(mode)?deadline>0:remainingTracks>0; }
    boolean byTrack() { return active()&&!"duration".equals(mode); }
    boolean expires(long now) { return active()&&"duration".equals(mode)&&now>=deadline; }
    long remainingMs(long now) { return "duration".equals(mode)?Math.max(0,deadline-now):0; }
    boolean finalTrack() { return byTrack()&&remainingTracks==1; }
    PlaybackSleepPlan completed() {
        return !byTrack()?this:remainingTracks<=1?none():new PlaybackSleepPlan(mode,0,remainingTracks-1,fadeSeconds,fadeWindowMs,trackKey);
    }
    PlaybackSleepPlan onTrack(String key) { return "track".equals(mode)&&active()&&!trackKey.equals(key)?none():this; }
    float gain(long now,long trackRemainingMs,long trackFadeWindowMs) {
        if (!active()||fadeSeconds<=0) return 1f;
        long remaining="duration".equals(mode)?remainingMs(now):finalTrack()?trackRemainingMs:Long.MAX_VALUE;
        long window="duration".equals(mode)?fadeWindowMs:trackFadeWindowMs;
        return window<=0?1f:(float)Math.max(0,Math.min(1,(double)remaining/window));
    }
    JSONObject json(long now) {
        try {return new JSONObject().put("active",active()).put("mode",mode).put("deadlineMs",deadline)
                .put("remainingMs",remainingMs(now)).put("remainingTracks",remainingTracks).put("fadeSeconds",fadeSeconds)
                .put("fadeWindowMs",fadeWindowMs).put("trackKey",trackKey);}
        catch(Exception impossible){throw new IllegalStateException(impossible);}
    }
}
