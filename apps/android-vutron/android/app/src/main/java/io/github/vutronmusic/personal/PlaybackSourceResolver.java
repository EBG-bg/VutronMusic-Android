package io.github.vutronmusic.personal;

import android.content.Context;
import android.net.Uri;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.Locale;
import java.util.function.Consumer;
import java.util.function.BooleanSupplier;

/**
 * The legacy personal edition's source selection, exposed to the Capacitor
 * adapter. The original embedded runtime owns identity checks and chooses the
 * best validated audio quality; its headers and measured metadata stay intact.
 */
public final class PlaybackSourceResolver {
    private PlaybackSourceResolver() { }

    public static JSONObject resolve(Context context, long trackId) throws IOException {
        return resolve(context, trackId, ignored -> { });
    }

    public static JSONObject resolve(Context context, long trackId, Consumer<String> status) throws IOException {
        return resolve(context,trackId,status,() -> true);
    }
    static JSONObject resolve(Context context, long trackId, Consumer<String> status, BooleanSupplier permitted) throws IOException {
        if (trackId <= 0) throw new IOException("歌曲 ID 无效");
        Context app = context.getApplicationContext();
        BooleanSupplier onlineAllowed = () -> !LocalOnlyMode.enabled(app) && permitted.getAsBoolean() && !Thread.currentThread().isInterrupted();
        NeteasePlaybackPolicy.Gate gate = () -> requireOnline(onlineAllowed);
        NeteasePlaybackPolicy.check(gate);
        return resolveSession(app, trackId, SessionStore.load(app), status, gate);
    }

    /** Cookie is chosen by the caller's account owner, never by this shared policy. */
    static JSONObject resolveSession(Context context, long trackId, String cookie, Consumer<String> status,
            NeteasePlaybackPolicy.Gate gate) throws IOException {
        if (trackId <= 0) throw new IOException("歌曲 ID 无效");
        Context app = context.getApplicationContext();
        JSONObject location = NeteasePlaybackPolicy.resolveSources(gate, () -> {
            status.accept("正在获取网易云播放地址…");
            return fullTrack(new NeteaseApi(cookie, () -> NeteasePlaybackPolicy.permitted(gate)).songUrl(trackId), "netease");
        }, () -> SourceSettings.autoMatch(app), () -> {
            JSONObject result = EmbeddedSources.songUrl(app, trackId, status);
            return fullTrack(result, result.optString("source", "其它音源"));
        });
        NeteasePlaybackPolicy.check(gate);
        JSONObject playable = EmbeddedSources.playable(app, location);
        NeteasePlaybackPolicy.check(gate);
        return playable;
    }

    interface Source extends NeteasePlaybackPolicy.Source { }

    /** The gate is re-read between providers; switching mode cannot start a fallback search. */
    static JSONObject resolveSources(BooleanSupplier onlineAllowed, Source official,
            BooleanSupplier autoMatch, Source fallback) throws IOException {
        return NeteasePlaybackPolicy.resolveSources(() -> requireOnline(onlineAllowed), official, autoMatch, fallback);
    }

    private static void requireOnline(BooleanSupplier allowed) throws IOException {
        if (!allowed.getAsBoolean()) throw new IOException("当前为本地模式，仅可使用本地文件和已完成缓存");
    }

    /** Match the full-track rule used by the legacy PlaybackService. */
    static JSONObject fullTrack(JSONObject location, String defaultSource) throws IOException {
        NeteasePlaybackPolicy.requireCompleteAudio(location);
        String url = validatePlaybackUrl(location.optString("url", ""));
        try {
            location.put("url", url);
            if (location.optString("source", "").trim().isEmpty()) location.put("source", defaultSource);
            return location;
        } catch (JSONException invalid) {
            throw new IOException("音源播放信息无效", invalid);
        }
    }

    /** Only NetEase's legacy CDN URLs have a verified equivalent TLS path. */
    static String validatePlaybackUrl(String value) throws IOException {
        if (value == null || value.trim().isEmpty() || "null".equals(value)) {
            throw new IOException("音源未返回完整播放地址");
        }
        Uri uri = Uri.parse(value);
        if (!("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme()))
                || uri.getHost() == null) throw new IOException("音源播放地址无效");
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        return "http".equalsIgnoreCase(uri.getScheme())
                && (host.endsWith(".music.126.net") || host.endsWith(".music.163.com"))
                ? uri.buildUpon().scheme("https").build().toString() : value;
    }

}
