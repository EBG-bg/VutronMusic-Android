package io.github.vutronmusic.personal;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;

/**
 * One playback path for Vue, notification resume and process restoration.
 * Selection follows the original personal edition: selected/local matched
 * file, verified offline audio, then the official/embedded source resolver.
 */
final class PlaybackRequest {
    private PlaybackRequest() { }

    static Intent prepare(Context context, JSONObject supplied, boolean autoPlay) throws Exception {
        return prepare(context,supplied,autoPlay,null);
    }
    static Intent prepare(Context context, JSONObject supplied, boolean autoPlay, JSONObject prefetched) throws Exception {
        if (supplied == null || supplied.optLong("id") <= 0) throw new IOException("歌曲信息无效");
        JSONObject song = new JSONObject(supplied.toString());
        if (song.optString("trackVolumeKey", "").isEmpty()) {
            song.put("trackVolumeKey", PlaybackVolume.trackKey(song));
        }
        long id = song.optLong("id");
        if ("plugin-snapshot".equals(song.optString("source"))) {
            String pluginId = song.optString("pluginId"), scope = song.optString("pluginAccountScope");
            AndroidPluginManager.requireEnabled(context, pluginId);
            if (!scope.equals(AndroidPluginManager.accountScope(context, pluginId))) throw new IOException("插件账号已变化，请重新打开离线歌单");
            AudioCache.Entry entry = AudioCache.find(context, id);
            if (entry == null || !PluginPlaylistCache.matchesAudio(song, entry.song))
                throw new PlaybackFailure.Reported("offline_audio_missing", "这首歌还没有完整的离线音频");
            cachedPlayback(song, entry);
            return toIntent(context, song, Uri.fromFile(entry.file).toString(), autoPlay, null);
        }
        boolean selectedCache = song.optBoolean("cached") || "cache".equals(song.optString("source"));
        String preferredSource = PluginMedia.sourceOverride(context, song);
        boolean preferLiveSource = !preferredSource.isEmpty() && !LocalOnlyMode.enabled(context) && MusicConnectivity.available(context);
        // Cache rows contain display paths, not an integrity guarantee. Verify only
        // the chosen recording, including notification/process-restored selections.
        AudioCache.Entry cached = selectedCache ? selectedCache(context, song) : null;
        if (cached != null && preferLiveSource && !preferredSource.equalsIgnoreCase(cached.source)) cached = null;
        String source = cached == null ? localSource(song) : Uri.fromFile(cached.file).toString();
        if (source.isEmpty() && !PluginMedia.isPlugin(song)) {
            JSONObject local = LocalPlaybackResolver.match(context, song);
            if (local != null) {
                song = local;
                song.put("neteaseId", id);
                source = localSource(song);
            }
        } else if (source.isEmpty()) {
            JSONObject local = PluginMedia.matchLocalNetease(context, song);
            if (local != null) {
                song = local;
                source = localSource(song);
            }
        }
        JSONObject location = null;
        boolean usedPrefetchedSource = false;
        if (source.isEmpty()) {
            if (!selectedCache) cached = AudioCache.find(context, id);
            if (cached != null && preferLiveSource && !preferredSource.equalsIgnoreCase(cached.source)) cached = null;
            if (cached != null) {
                source = Uri.fromFile(cached.file).toString();
                cachedPlayback(song, cached);
            } else {
                if (PluginMedia.isPlugin(song)) location = PluginMedia.resolve(context, song);
                else {
                    LocalOnlyMode.requireOnline(context);
                    location = prefetched == null ? PlaybackSourceResolver.resolve(context, id) : prefetched;
                    usedPrefetchedSource = prefetched != null;
                }
                source = location.getString("url");
                song.put("playbackSource", location.optString("source", "netease"))
                        .put("playbackBitrate", location.optLong("br", location.optLong("bitrate", 0)))
                        .put("playbackFormat", location.optString("type", ""))
                        .put("playbackLossless", location.optBoolean("lossless")
                                || "flac".equalsIgnoreCase(location.optString("type", "")))
                        .put("playbackCached", false);
            }
        } else if (cached != null) {
            cachedPlayback(song, cached);
        } else {
            song.put("playbackSource", "本地文件").put("playbackBitrate", 0)
                    .put("playbackFormat", "").put("playbackLossless", false).put("playbackCached", false);
        }
        if (location != null && location.optBoolean("local")) location = null;
        return toIntent(context, song, source, autoPlay, location).putExtra("usedPrefetchedSource", usedPrefetchedSource);
    }

    static Intent prepareRecovery(Context context, JSONObject selected, boolean autoPlay, String cookie, String rejectedMatch) throws Exception {
        JSONObject song = new JSONObject(selected.toString());
        NeteasePlaybackPolicy.Gate account = () -> {
            LocalOnlyMode.requireOnline(context);
            if (!cookie.equals(SessionStore.load(context))) throw new IOException("登录状态已变化，请重新播放");
        };
        long neteaseId = song.optLong("id");
        JSONObject location = PluginMedia.isPlugin(song) ? PluginMedia.retryNetease(context, song, rejectedMatch)
                : rejectedMatch.isEmpty() ? PlaybackSourceResolver.resolveCompatible(context, neteaseId, cookie, account)
                : PlaybackSourceResolver.resolveOtherMatch(context, neteaseId, rejectedMatch, account);
        song.put("playbackSource", location.optString("source", "netease"))
                .put("playbackBitrate", location.optLong("br", location.optLong("bitrate", 0)))
                .put("playbackFormat", location.optString("type", ""))
                .put("playbackLossless", location.optBoolean("lossless") || "flac".equalsIgnoreCase(location.optString("type", "")))
                .put("playbackCached", false);
        if (selected.optBoolean("playbackCached")) {
            song.remove("cached"); song.remove("offlineOnly"); song.remove("localUri"); song.remove("localPath");
            if ("cache".equals(song.optString("source"))) song.remove("source");
        }
        return toIntent(context, song, location.getString("url"), autoPlay, location).putExtra("sourceRecovery", true);
    }

    static Intent preparePluginBackup(Context context, JSONObject selected, boolean autoPlay, Intent failed) throws Exception {
        JSONObject song = new JSONObject(selected.toString());
        JSONObject location = PluginMedia.retryMedia(context, song, failed.getStringExtra("pluginMediaOwner"),
                failed.getStringArrayExtra("pluginMediaCandidates"), failed.getIntExtra("pluginMediaAttempt", 0));
        return toIntent(context, song, location.getString("url"), autoPlay, location);
    }

    private static Intent toIntent(Context context, JSONObject song, String source, boolean autoPlay, JSONObject location) {
        String cover = first(song, "picLocalUri", "coverLocalUri", "picUrl", "coverImgUrl");
        if (cover.isEmpty()) cover = ArtworkSource.coverUrl(song);
        JSONObject headers = location == null ? null : location.optJSONObject("headers");
        String owner = location == null ? "" : location.optString("pluginMediaOwner");
        int attempt = 0, total = 0;
        boolean watchStartFailure = false;
        String[] candidates = new String[0];
        // Provider-signed URLs stay only in the current request, never in track/queue or cache metadata.
        if (location != null && !owner.isEmpty()) {
            if (location.remove("pluginMediaCandidates") instanceof JSONArray rows) {
                candidates = new String[rows.length()];
                for (int i = 0; i < rows.length(); i++) candidates[i] = rows.optString(i);
            }
            attempt = location.optInt("pluginMediaAttempt");
            total = location.optInt("pluginMediaTotal");
            watchStartFailure = Boolean.TRUE.equals(location.remove("watchStartFailure"));
            location.remove("pluginMediaAttempt");
            location.remove("pluginMediaTotal");
            location.remove("pluginMediaOwner");
        }
        return new Intent(context, AndroidPlaybackService.class).setAction(AndroidPlaybackService.ACTION_PLAY)
                .putExtra("url", source).putExtra("trackId", song.optLong("id"))
                .putExtra("title", song.optString("name", BuildConfig.APP_DISPLAY_NAME))
                .putExtra("artist", artistText(song)).putExtra("coverUrl", cover)
                .putExtra("track", song.toString()).putExtra("autoPlay", autoPlay)
                .putExtra("matcherSource", location == null ? "" : location.optString("matcherSource"))
                .putExtra("pluginMediaCandidates", candidates).putExtra("pluginMediaOwner", owner)
                .putExtra("pluginMediaAttempt", attempt).putExtra("pluginMediaTotal", total)
                .putExtra("watchStartFailure", watchStartFailure)
                .putExtra("cacheLocation", location == null ? "" : location.toString())
                .putExtra("sourceHeaders", headers == null ? "{}" : headers.toString());
    }

    static AudioCache.Entry selectedCache(Context context, JSONObject song) throws java.io.InterruptedIOException {
        AudioCache.Entry entry = AudioCache.find(context, song.optLong("id"));
        if (Thread.currentThread().isInterrupted()) throw new java.io.InterruptedIOException("播放解析已取消");
        if (entry == null) {
            // Evicted/corrupt cache falls through to the existing local match and
            // online resolver, retaining plugin account and recording identities.
            song.remove("localUri");
            song.remove("localPath");
            song.remove("cached");
            song.remove("offlineOnly");
            if ("cache".equals(song.optString("source"))) song.remove("source");
        }
        return entry;
    }

    static void cachedPlayback(JSONObject song, AudioCache.Entry entry) throws org.json.JSONException {
        song.put("playbackSource", entry.source).put("playbackBitrate", entry.bitrate)
                .put("playbackFormat", entry.format).put("playbackLossless", entry.lossless)
                .put("playbackCached", true);
    }

    static JSONObject remembered(Context context) throws Exception {
        android.content.SharedPreferences prefs = context.getSharedPreferences("vutron_playback", Context.MODE_PRIVATE);
        String raw = prefs.getString("current_track", "");
        if (raw != null && !raw.isEmpty()) return new JSONObject(raw);
        return new JSONObject().put("id", prefs.getLong("lastTrackId", prefs.getLong("trackId", 0L)))
                .put("name", prefs.getString("lastTitle", prefs.getString("title", BuildConfig.APP_DISPLAY_NAME)))
                .put("artist", prefs.getString("lastArtist", prefs.getString("artist", "")));
    }

    private static String localSource(JSONObject song) throws IOException {
        if (song.optBoolean("missingLocal")) throw new PlaybackFailure.Reported("local_missing", "备份未包含音频，请重新授权音乐文件夹或导入原歌单包后播放");
        String value = first(song, "localUri", "localPath");
        if (value.isEmpty()) return "";
        if (value.startsWith("content://")) return value;
        File file = value.startsWith("file://") ? new File(Uri.parse(value).getPath()) : new File(value);
        if (file.isFile()) return Uri.fromFile(file).toString();
        // A cache can be evicted between displaying the list and playback.
        // Resolve the online identity again; never treat a missing local
        // user's recording as an unrelated online song with a generated id.
        if (song.optBoolean("cached") || "cache".equals(song.optString("source"))) return "";
        throw new PlaybackFailure.Reported("local_missing", "本地音频不存在，请重新扫描音乐文件夹");
    }

    static String artistText(JSONObject song) {
        JSONArray artists = song.optJSONArray("artists");
        if (artists == null) artists = song.optJSONArray("ar");
        StringBuilder text = new StringBuilder();
        if (artists != null) for (int i = 0; i < artists.length(); i++) {
            Object value = artists.opt(i);
            String name = value instanceof JSONObject ? ((JSONObject) value).optString("name", "")
                    : value instanceof String ? (String) value : "";
            if (!name.trim().isEmpty()) { if (text.length() > 0) text.append(" / "); text.append(name.trim()); }
        }
        return text.length() > 0 ? text.toString() : song.optString("artist", "");
    }

    private static String first(JSONObject value, String... keys) {
        for (String key : keys) {
            String text = value.optString(key, "").trim();
            if (!text.isEmpty()) return text;
        }
        return "";
    }
}
