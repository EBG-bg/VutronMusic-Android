package io.github.vutronmusic.personal;

import org.json.JSONObject;

/** A/B points are relative to the selected recording, including a virtual CUE track. */
final class PlaybackAbLoop {
    static final long MIN_SPAN_MS=500;
    final String trackKey;
    final long trackId,durationMs,startMs,endMs;
    final boolean enabled;
    private PlaybackAbLoop(String key,long id,long duration,long start,long end,boolean enabled) {
        this.trackKey=key;this.trackId=id;this.durationMs=duration;this.startMs=start;this.endMs=end;this.enabled=enabled;
    }
    static PlaybackAbLoop empty() { return new PlaybackAbLoop("",0,0,-1,-1,false); }
    PlaybackAbLoop forTrack(String key,long id,long duration) {
        if (key==null||key.isEmpty()||duration<=0) return empty();
        if (!key.equals(trackKey)||duration!=durationMs) return new PlaybackAbLoop(key,id,duration,-1,-1,false);
        return this;
    }
    PlaybackAbLoop update(String expected,boolean clear,Long start,Long end,Boolean enabled,boolean songTimer) {
        if (trackKey.isEmpty()||durationMs<=0) throw new IllegalArgumentException("歌曲尚未准备好，暂时无法设置 A/B 循环");
        if (expected==null||!trackKey.equals(expected)) throw new IllegalArgumentException("歌曲已切换，请重新设置 A/B 循环");
        if (clear) return new PlaybackAbLoop(trackKey,trackId,durationMs,-1,-1,false);
        long a=start==null?startMs:start,b=end==null?endMs:end;
        boolean on=enabled==null?this.enabled:enabled;
        if (a< -1||b< -1||a>durationMs||b>durationMs) throw new IllegalArgumentException("A/B 标记超出歌曲范围");
        if (on&&(a<0||b<0||b-a<MIN_SPAN_MS)) throw new IllegalArgumentException("请设置 A、B 两个位置，间隔至少0.5秒");
        if (on&&songTimer) throw new IllegalArgumentException("请先取消按歌曲结束的睡眠定时，再开启 A/B 循环");
        return new PlaybackAbLoop(trackKey,trackId,durationMs,a,b,on);
    }
    boolean atEnd(long position) { return enabled&&position>=endMs; }
    long boundedSeek(long position) { return enabled?Math.max(startMs,Math.min(endMs-1,position)):position; }
    JSONObject json() {
        try{return new JSONObject().put("trackKey",trackKey).put("trackId",trackId).put("durationMs",durationMs)
                .put("startMs",startMs).put("endMs",endMs).put("enabled",enabled).put("minSpanMs",MIN_SPAN_MS);}
        catch(Exception impossible){throw new IllegalStateException(impossible);}
    }
}
