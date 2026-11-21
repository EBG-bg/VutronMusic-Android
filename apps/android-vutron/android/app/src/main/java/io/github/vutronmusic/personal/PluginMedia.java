package io.github.vutronmusic.personal;

import android.content.Context;
import android.net.Uri;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

/** Resolves public Vutron resource protocols without interpreting sourceContext. */
final class PluginMedia {
    static final int MAX_PLAYBACK_CANDIDATES = 3;
    static final class StaleAccount extends IOException {
        StaleAccount() { super("插件账号变化，旧播放请求已取消"); }
    }
    private PluginMedia() { }
    static boolean isPlugin(JSONObject song) { return song != null && !song.optString("pluginId").isEmpty(); }
    static String sourceOverride(Context context, JSONObject song) {
        try {
            long trackId;
            if (isPlugin(song)) {
                JSONObject source = AndroidPluginManager.requireInstalled(context, song.optString("pluginId"));
                if (!"netease".equals(source.optString("baseId", source.optString("id")))) return "";
                trackId = NeteasePlaybackPolicy.publicTrackId(song);
            } else {
                if (song.optLong("neteaseId") > 0) trackId = song.optLong("neteaseId");
                else if (!song.optString("localUri").isEmpty() || !song.optString("localPath").isEmpty()
                        || !song.optString("localFolderId").isEmpty() || !song.optString("localPlaylistId").isEmpty()) return "";
                else trackId = song.optLong("id");
            }
            return TrackSourceOverrides.get(context, trackId);
        } catch (Exception unavailable) { return ""; }
    }
    static boolean networkAllowed(Context context, JSONObject song) {
        if (!isPlugin(song)) return !LocalOnlyMode.enabled(context);
        try { if (AndroidPluginManager.local(context,song.optString("pluginId"))) return true; }
        catch (Exception unavailable) { /* Removed sources can still expose completed offline audio. */ }
        return AndroidPluginManager.networkAllowed(context);
    }
    static void requireOnline(Context context, JSONObject song) throws IOException {
        if (!isPlugin(song)) { LocalOnlyMode.requireOnline(context); return; }
        if (!networkAllowed(context, song)) throw new IOException("当前离线，插件只能播放已完成缓存或已授权的本地文件");
    }
    static JSONObject parameters(Uri uri) throws Exception {
        JSONObject result = new JSONObject();
        for (String key : uri.getQueryParameterNames()) result.put(key, uri.getQueryParameter(key));
        return result;
    }
    static String resolvedUrl(Object result) throws Exception {
        if (result instanceof String) return (String) result;
        if (result instanceof JSONObject) {
            JSONObject object = (JSONObject) result;
            if (object.opt("data") instanceof String) return object.getString("data");
            if (object.optJSONObject("data") != null) object = object.getJSONObject("data");
            return object.optString("url");
        }
        throw new IOException("插件资源地址不符合原版协议");
    }
    static JSONObject location(Context context, String pluginId, String originalUri, boolean image) throws Exception {
        return location(context, pluginId, originalUri, image, "");
    }
    private static JSONObject location(Context context, String pluginId, String originalUri, boolean image, String scope) throws Exception {
        String wrapped = "vutron://get-online-music/";
        if (originalUri.startsWith(wrapped)) originalUri = originalUri.substring(wrapped.length());
        Uri uri = Uri.parse(originalUri);
        Object response = originalUri;
        if ("vutron".equals(uri.getScheme()) && "get-plugin-asset".equals(uri.getHost())) {
            String type = uri.getQueryParameter("type");
            if (!(image ? "pic".equals(type) : "stream".equals(type))) throw new IOException("插件资源类型不匹配");
            response = AndroidPluginManager.invoke(context, pluginId, image ? "getPic" : "getStream", parameters(uri), scope);
        } else if ("vutron".equals(uri.getScheme()) && "local-asset".equals(uri.getHost())) {
            JSONObject row = PluginLocalLibrary.find(context, uri.getQueryParameter("id"));
            return new JSONObject().put("url", LocalLibraryIds.uri(row)).put("local", true).put("localTrack", row).put("headers", new JSONObject());
        }
        String url = resolvedUrl(response);
        if (!(url.startsWith("http://") || url.startsWith("https://"))) throw new IOException("插件未返回有效的网络媒体地址");
        JSONObject headers = response instanceof JSONObject ? ((JSONObject) response).optJSONObject("headers") : null;
        return AndroidPluginManager.resolveMedia(context, pluginId, url, headers == null ? new JSONObject() : headers);
    }
    static JSONObject resolve(Context context, JSONObject song) throws Exception {
        String pluginId = song.getString("pluginId");
        String suppliedScope = song.optString("pluginAccountScope");
        String scope = AndroidPluginManager.accountScope(context, pluginId);
        if (!suppliedScope.isEmpty() && !suppliedScope.equals(scope)) throw new StaleAccount();
        JSONObject definition = AndroidPluginManager.requireInstalled(context, pluginId);
        if ("netease".equals(definition.optString("baseId", pluginId))) return resolveNetease(context, song, pluginId, scope, false, "");
        JSONObject result = AndroidPluginManager.callScoped(context, pluginId, "songUrl", song.getJSONObject("pluginSourceContext"),scope);
        requirePlaybackOwner(context, pluginId, scope);
        if (result.optInt("code") != 200 || result.optJSONObject("data") == null) throw new IOException(result.optString("message", "插件没有提供可播放音频"));
        JSONObject data = result.getJSONObject("data");
        JSONObject resolved = resolvePlaybackLocation(data.optJSONArray("url"), url -> resolveOwnedLocation(context, pluginId, scope, url));
        if (!resolved.optBoolean("local")) resolved.put("pluginMediaOwner", scope);
        if (resolved.optJSONObject("localTrack") != null) {
            JSONObject local = resolved.getJSONObject("localTrack");
            for (String key : new String[]{"localUri", "localPath", "localFileName", "cueTrackNo", "cueOffsetMs", "cueDurationMs"}) if (local.has(key)) song.put(key, local.get(key));
        }
        if (data.optLong("cueDuration") > 0) {
            song.put("cueTrackNo", Math.max(1, song.optInt("cueTrackNo"))).put("cueOffsetMs", Math.max(0, data.optLong("cueOffset")))
                    .put("cueDurationMs", data.getLong("cueDuration"));
        }
        song.put("playbackSource", pluginId).put("playbackCached", false);
        return resolved.put("source", pluginId);
    }

    private static void requirePlaybackOwner(Context context, String pluginId, String scope) throws Exception {
        if (Thread.currentThread().isInterrupted()) throw new java.io.InterruptedIOException("插件播放已取消");
        AndroidPluginManager.requireEnabled(context, pluginId);
        if (!scope.equals(AndroidPluginManager.accountScope(context, pluginId))) throw new StaleAccount();
    }

    private static JSONObject resolveOwnedLocation(Context context, String pluginId, String scope, String url) throws Exception {
        requirePlaybackOwner(context, pluginId, scope);
        JSONObject selected = location(context, pluginId, url, false, scope);
        requirePlaybackOwner(context, pluginId, scope);
        return selected;
    }

    interface PlaybackLocationResolver { JSONObject resolve(String url) throws Exception; }

    /** Register only the chosen address. Retain the next distinct candidates for this request. */
    static JSONObject resolvePlaybackLocation(JSONArray urls, PlaybackLocationResolver resolver) throws Exception {
        LinkedHashSet<String> unique = new LinkedHashSet<>();
        for (int i = 0; urls != null && i < urls.length() && unique.size() < MAX_PLAYBACK_CANDIDATES; i++) {
            Object item = urls.opt(i);
            if (!(item instanceof String url) || url.isBlank() || url.length() > 24 * 1024) continue;
            if (url.startsWith("https://") || url.startsWith("http://") || url.startsWith("vutron://")) unique.add(url);
        }
        return resolveCandidates(new ArrayList<>(unique), 0, resolver);
    }

    static JSONObject resolveCandidates(List<String> candidates, int attempted, PlaybackLocationResolver resolver) throws Exception {
        int total = attempted + candidates.size();
        if (attempted < 0 || total > MAX_PLAYBACK_CANDIDATES) throw new IOException("插件播放地址数量无效");
        IOException firstFailure = null;
        for (int i = 0; i < candidates.size(); i++) {
            String url = candidates.get(i);
            try {
                JSONObject resolved = resolver.resolve(url);
                if (resolved.optBoolean("local")) return resolved;
                JSONArray backups = new JSONArray();
                for (String remaining : candidates.subList(i + 1, candidates.size()))
                    if (!remaining.startsWith("vutron://local-asset")) backups.put(remaining);
                int attempt = attempted + i + 1;
                return resolved.put("pluginMediaCandidates", backups)
                        .put("pluginMediaAttempt", attempt).put("pluginMediaTotal", attempt + backups.length());
            } catch (StaleAccount cancelled) { throw cancelled; }
            catch (java.io.InterruptedIOException interrupted) {
                if (Thread.currentThread().isInterrupted() || !(interrupted instanceof java.net.SocketTimeoutException)) throw interrupted;
                if (firstFailure == null) firstFailure = interrupted;
            } catch (AndroidPluginManager.PluginFailure unavailable) {
                if (!"PLUGIN_ERROR".equals(unavailable.code)) throw unavailable;
                if (firstFailure == null) firstFailure = unavailable;
            } catch (IOException unavailable) { if (firstFailure == null) firstFailure = unavailable; }
        }
        if (firstFailure != null) throw firstFailure;
        throw new IOException("插件没有返回播放地址");
    }

    static JSONObject retryMedia(Context context, JSONObject song, String owner, String[] backups, int attempted) throws Exception {
        String pluginId = song.getString("pluginId");
        if (owner == null || owner.isEmpty() || backups == null || backups.length == 0) throw new IOException("该插件没有备用播放地址");
        String suppliedScope = song.optString("pluginAccountScope");
        if (!suppliedScope.isEmpty() && !suppliedScope.equals(owner)) throw new StaleAccount();
        JSONObject resolved = resolveCandidates(java.util.Arrays.asList(backups), attempted, url -> {
            JSONObject location = resolveOwnedLocation(context, pluginId, owner, url);
            if (location.optBoolean("local")) throw new IOException("插件备用网络地址无效");
            return location;
        });
        return resolved.put("source", pluginId).put("pluginMediaOwner", owner);
    }

    /** Optional local-index matching happens before cache lookup, as on the native NetEase path. */
    static JSONObject matchLocalNetease(Context context, JSONObject song) throws Exception {
        if (!isPlugin(song)) return null;
        String pluginId = song.optString("pluginId"), suppliedScope = song.optString("pluginAccountScope");
        String expectedScope;
        try {
            JSONObject source = AndroidPluginManager.requireInstalled(context, pluginId);
            if (!"netease".equals(source.optString("baseId", pluginId))) return null;
            expectedScope = suppliedScope.isEmpty() ? AndroidPluginManager.accountScope(context, pluginId) : suppliedScope;
            AndroidPluginManager.requireNeteasePlaybackScope(context, pluginId, expectedScope);
        } catch (Exception unavailable) {
            // Completed standalone cache remains usable after a source/account
            // is removed; do not turn optional matching into an earlier gate.
            return null;
        }
        JSONObject target;
        try { target = NeteasePlaybackPolicy.localMatchTarget(song); }
        catch (IOException invalidIdentity) { return null; }
        JSONObject matched = LocalPlaybackResolver.match(context, target);
        try { AndroidPluginManager.requireNeteasePlaybackScope(context, pluginId, expectedScope); }
        catch (Exception changed) { return null; }
        return NeteasePlaybackPolicy.withLocalAudio(song, matched);
    }

    static JSONObject retryNetease(Context context, JSONObject song, String rejectedMatch) throws Exception {
        String pluginId = song.getString("pluginId");
        JSONObject definition = AndroidPluginManager.requireInstalled(context, pluginId);
        if (!"netease".equals(definition.optString("baseId", pluginId))) throw new IOException("当前来源不支持网易云重试");
        return resolveNetease(context, song, pluginId, song.optString("pluginAccountScope"), true, rejectedMatch);
    }

    private static JSONObject resolveNetease(Context context, JSONObject song, String pluginId, String suppliedScope,
            boolean retry, String rejectedMatch) throws Exception {
        // Do not reinterpret song.id, which is the stable plugin cache/queue ID.
        // The original sourceContext and lyric/comment/reporting identities stay intact.
        long neteaseId = NeteasePlaybackPolicy.publicTrackId(song);
        String expectedScope = suppliedScope.isEmpty() ? AndroidPluginManager.accountScope(context, pluginId) : suppliedScope;
        NeteasePlaybackPolicy.Gate gate = () -> {
            try {
                AndroidPluginManager.requireNeteasePlaybackScope(context, pluginId, expectedScope);
                requireOnline(context, song);
            } catch (IOException failure) { throw failure; }
            catch (Exception failure) { throw new IOException("无法验证网易云来源账号，请重新打开音乐库", failure); }
        };
        NeteasePlaybackPolicy.check(gate);
        JSONObject resolved;
        if (!rejectedMatch.isEmpty()) resolved = PlaybackSourceResolver.resolveOtherMatch(context, neteaseId, rejectedMatch, gate);
        else {
            AndroidPluginManager.NeteasePlaybackSession session = AndroidPluginManager.neteasePlaybackSession(context, pluginId, expectedScope);
            resolved = retry ? PlaybackSourceResolver.resolveCompatible(context, neteaseId, session.cookie, gate)
                    : PlaybackSourceResolver.resolveSession(context, neteaseId, session.cookie, ignored -> { }, gate);
        }
        NeteasePlaybackPolicy.check(gate);
        song.put("playbackSource", resolved.optString("source", "netease")).put("playbackCached", false);
        return resolved;
    }
    static LyricRepository.Lyrics lyrics(Context context, JSONObject song) throws IOException {
        File file = new File(new File(context.getFilesDir(), "plugin-lyrics-v1"), song.optLong("id") + ".json");
        JSONArray rows = null;
        if (file.isFile() && file.length() <= 1024 * 1024) try { rows = new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8)).optJSONArray("lines"); }
        catch (Exception invalid) { android.util.Log.w("VutronPluginLyrics", "Ignoring an invalid plugin lyric cache"); }
        boolean installed=false;
        try { installed=AndroidPluginManager.installed(context,song.optString("pluginId")); }
        catch (Exception unavailable) { android.util.Log.w("VutronPluginLyrics","Cannot inspect the installed plugin registry"); }
        boolean mayLoad = installed && AndroidPluginManager.networkAllowed(context);
        try { if(installed) mayLoad |= AndroidPluginManager.local(context, song.optString("pluginId")); }
        catch (Exception unavailable) { android.util.Log.w("VutronPluginLyrics", "Cannot inspect the plugin lyric capability"); }
        JSONArray selectedRows=null;
        if (mayLoad) try {
            String scope=song.optString("pluginAccountScope");
            if (!scope.isEmpty() && !scope.equals(AndroidPluginManager.accountScope(context,song.getString("pluginId")))) throw new IOException("插件账号已变化");
            String owner=song.getString("pluginId");
            JSONObject original=song.getJSONObject("pluginTrack");
            JSONArray plugins=AndroidPluginManager.list(context).getJSONArray("plugins");
            PluginSourceMatching.match(context,owner,scope,original,plugins);
            JSONArray candidates=PluginSourceRegistry.candidates(context,owner,scope,song.getString("pluginTrackId"),
                    song.getJSONObject("pluginSourceContext"),"lyric",plugins);
            for (int i=0;i<candidates.length();i++) {
                JSONObject candidate=candidates.getJSONObject(i);
                String id=candidate.getString("pluginId"), account=candidate.getString("accountScope");
                try {
                    if (!account.equals(AndroidPluginManager.accountScope(context,id))) continue;
                    JSONObject result=AndroidPluginManager.callScoped(context,id,"getLyric",candidate.getJSONObject("sourceContext"),account);
                    if (!scope.equals(AndroidPluginManager.accountScope(context,owner))) throw new IOException("插件账号已变化");
                    if (!account.equals(AndroidPluginManager.accountScope(context,id))) continue;
                    if (result.optInt("code")!=200 || result.optJSONArray("data")==null || result.getJSONArray("data").length()==0) continue;
                    selectedRows=preferredLyrics(selectedRows,result.getJSONArray("data"));
                    if (LyricTimeline.fromPlugin(selectedRows,"lyric").hasWordTiming()) break;
                } catch (Exception failure) {
                    android.util.Log.w("VutronPluginLyrics", "Lyric candidate "+id+" failed: "+failure.getClass().getSimpleName());
                }
            }
        } catch (Exception failure) { android.util.Log.w("VutronPluginLyrics", "Plugin lyric retrieval failed: " + failure.getClass().getSimpleName()); }
        rows=preferredLyrics(selectedRows,rows);
        if (rows == null) rows = new JSONArray();
        if (mayLoad && rows.length()>0) try {
            if (!file.getParentFile().isDirectory()) file.getParentFile().mkdirs();
            if (rows.toString().getBytes(StandardCharsets.UTF_8).length<=1024*1024) LibraryFiles.writeJson(file,new JSONObject().put("lines",rows));
        } catch (Exception unavailable) { android.util.Log.w("VutronPluginLyrics", "Lyrics usable but could not be cached"); }
        return new LyricRepository.Lyrics(LyricTimeline.fromPlugin(rows, "lyric"), LyricTimeline.fromPlugin(rows, "tlyric"), true);
    }

    /** Retain the complete fallback while looking for a provider's real word intervals. */
    static JSONArray preferredLyrics(JSONArray current, JSONArray candidate) {
        if (current == null || current.length()==0) return candidate;
        LyricTimeline saved=LyricTimeline.fromPlugin(current,"lyric"), next=LyricTimeline.fromPlugin(candidate,"lyric");
        return !saved.hasWordTiming() && next.hasWordTiming() && next.hasComparableCoverage(saved) ? candidate : current;
    }
}
