package io.github.vutronmusic.personal;

import android.content.Context;
import android.net.Uri;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/** Resolves public Vutron resource protocols without interpreting sourceContext. */
final class PluginMedia {
    private PluginMedia() { }
    static boolean isPlugin(JSONObject song) { return song != null && !song.optString("pluginId").isEmpty(); }
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
        String wrapped = "vutron://get-online-music/";
        if (originalUri.startsWith(wrapped)) originalUri = originalUri.substring(wrapped.length());
        Uri uri = Uri.parse(originalUri);
        Object response = originalUri;
        if ("vutron".equals(uri.getScheme()) && "get-plugin-asset".equals(uri.getHost())) {
            String type = uri.getQueryParameter("type");
            if (!(image ? "pic".equals(type) : "stream".equals(type))) throw new IOException("插件资源类型不匹配");
            response = AndroidPluginManager.invoke(context, pluginId, image ? "getPic" : "getStream", parameters(uri));
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
        String scope=song.optString("pluginAccountScope");
        if (!scope.isEmpty() && !scope.equals(AndroidPluginManager.accountScope(context,pluginId))) throw new IOException("歌曲所属的插件账号或服务器已变化，请重新打开音乐库");
        JSONObject definition = AndroidPluginManager.requireInstalled(context, pluginId);
        if ("netease".equals(definition.optString("baseId", pluginId))) return resolveNetease(context, song, pluginId, scope);
        JSONObject result = AndroidPluginManager.callScoped(context, pluginId, "songUrl", song.getJSONObject("pluginSourceContext"),scope);
        if (!scope.isEmpty() && !scope.equals(AndroidPluginManager.accountScope(context,pluginId))) throw new IOException("插件账号变化，旧播放请求已取消");
        if (result.optInt("code") != 200 || result.optJSONObject("data") == null) throw new IOException(result.optString("message", "插件没有提供可播放音频"));
        JSONObject data = result.getJSONObject("data"); JSONArray urls = data.optJSONArray("url");
        if (urls == null || urls.length() == 0) throw new IOException("插件没有返回播放地址");
        JSONObject resolved = location(context, pluginId, urls.getString(0), false);
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

    private static JSONObject resolveNetease(Context context, JSONObject song, String pluginId, String suppliedScope) throws Exception {
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
        AndroidPluginManager.NeteasePlaybackSession session = AndroidPluginManager.neteasePlaybackSession(context, pluginId, expectedScope);
        JSONObject resolved = PlaybackSourceResolver.resolveSession(context, neteaseId, session.cookie, ignored -> { }, gate);
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
                    rows=result.getJSONArray("data");
                    if (!file.getParentFile().isDirectory()) file.getParentFile().mkdirs();
                    if (rows.toString().getBytes(StandardCharsets.UTF_8).length<=1024*1024) LibraryFiles.writeJson(file,new JSONObject().put("lines",rows));
                    break;
                } catch (Exception failure) {
                    android.util.Log.w("VutronPluginLyrics", "Lyric candidate "+id+" failed: "+failure.getClass().getSimpleName());
                }
            }
        } catch (Exception failure) { android.util.Log.w("VutronPluginLyrics", "Plugin lyric retrieval failed: " + failure.getClass().getSimpleName()); }
        if (rows == null) rows = new JSONArray();
        return new LyricRepository.Lyrics(LyricTimeline.fromPlugin(rows, "lyric"), LyricTimeline.fromPlugin(rows, "tlyric"), true);
    }
}
