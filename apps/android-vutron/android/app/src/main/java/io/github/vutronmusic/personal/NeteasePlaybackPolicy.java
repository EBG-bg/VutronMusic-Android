package io.github.vutronmusic.personal;

import org.json.JSONObject;
import org.json.JSONException;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.util.function.BooleanSupplier;

/** The one NetEase audio selection policy, independent of library/account UI. */
final class NeteasePlaybackPolicy {
    private NeteasePlaybackPolicy() { }

    interface Source { JSONObject load() throws IOException; }
    interface Gate { void check() throws IOException; }

    static void check(Gate gate) throws IOException {
        if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException("音源查找已取消");
        gate.check();
    }

    static boolean permitted(Gate gate) {
        try { check(gate); return true; }
        catch (IOException unavailable) { return false; }
    }

    static void requireCompleteAudio(JSONObject location) throws IOException {
        if (location == null) throw new IOException("音源未返回歌曲地址");
        Object trial = location.opt("freeTrialInfo");
        if (trial != null && trial != JSONObject.NULL) throw new IOException("网易云仅返回试听地址");
        String url = location.optString("url", "");
        if (url.trim().isEmpty() || "null".equals(url)) throw new IOException("音源未返回完整播放地址");
    }

    /** Re-check mode/account/cancellation before and after each provider. */
    static JSONObject resolveSources(Gate gate, Source official, BooleanSupplier autoMatch, Source fallback) throws IOException {
        check(gate);
        IOException officialFailure;
        try {
            JSONObject result = official.load();
            check(gate);
            return result;
        } catch (IOException failure) { officialFailure = failure; }
        check(gate);
        if (!autoMatch.getAsBoolean()) throw officialFailure;
        try {
            check(gate);
            JSONObject result = fallback.load();
            check(gate);
            return result;
        } catch (IOException matchingFailure) {
            // Policy changes are not provider failures and must not be retried
            // or obscured by a stale request's combined source diagnostics.
            check(gate);
            IOException failure = new IOException("网易云与其它音源均无法提供完整歌曲。网易云："
                    + message(officialFailure) + "；其它音源：" + message(matchingFailure), matchingFailure);
            failure.addSuppressed(officialFailure);
            throw failure;
        }
    }

    /** Public Track.id is authoritative; native plugin/cache IDs are never NetEase IDs. */
    static long publicTrackId(JSONObject song) throws IOException {
        JSONObject original = song == null ? null : song.optJSONObject("pluginTrack");
        Object raw = original == null ? null : original.opt("id");
        String publicId = raw == null || raw == JSONObject.NULL ? "" : String.valueOf(raw);
        String remembered = song == null ? "" : song.optString("pluginTrackId", "");
        if (publicId.isEmpty()) publicId = remembered;
        if (!publicId.matches("[1-9][0-9]{0,18}") || !remembered.isEmpty() && !remembered.equals(publicId))
            throw new IOException("网易云插件歌曲的公开 ID 无效，请重新打开来源歌单");
        try {
            long id = Long.parseLong(publicId);
            if (id <= 0) throw new NumberFormatException();
            return id;
        } catch (NumberFormatException invalid) {
            throw new IOException("网易云插件歌曲的公开 ID 无效，请重新打开来源歌单", invalid);
        }
    }

    /** Temporary matching query only: never store its native service ID over the plugin ID. */
    static JSONObject localMatchTarget(JSONObject song) throws IOException {
        try { return new JSONObject(song.toString()).put("id", publicTrackId(song)); }
        catch (JSONException invalid) { throw new IOException("网易云本地匹配资料无效", invalid); }
    }

    static JSONObject withLocalAudio(JSONObject original, JSONObject matched) throws IOException {
        if (matched == null || matched.optString("localUri", "").isEmpty() && matched.optString("localPath", "").isEmpty()) return null;
        try {
            JSONObject result = new JSONObject(original.toString());
            for (String key : new String[]{"localUri", "localPath", "localFileName", "cueUri", "cueTrackNo", "cueOffsetMs",
                    "cueDurationMs", "cueTitle", "cuePerformer", "cueAlbum", "cueWarning"}) {
                if (matched.has(key)) result.put(key, matched.get(key));
                else result.remove(key);
            }
            long duration = matched.optInt("cueTrackNo") > 0 ? matched.optLong("cueDurationMs")
                    : original.optLong("duration") > 0 ? original.optLong("duration") : matched.optLong("duration", matched.optLong("dt"));
            if (duration > 0) result.put("duration", duration).put("dt", duration);
            return result;
        } catch (JSONException invalid) { throw new IOException("网易云本地匹配资料无效", invalid); }
    }

    private static String message(IOException error) {
        String value = error.getMessage();
        return value == null || value.trim().isEmpty() ? error.getClass().getSimpleName() : value;
    }
}
