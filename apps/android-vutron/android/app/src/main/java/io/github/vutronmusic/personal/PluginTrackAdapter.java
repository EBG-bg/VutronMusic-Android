package io.github.vutronmusic.personal;

import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Keeps provider IDs and opaque context intact behind an Android-safe ID. */
final class PluginTrackAdapter {
    private PluginTrackAdapter() { }

    static long id(String pluginId, String providerId) throws Exception {
        if (pluginId == null || !pluginId.matches("[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}(?::[a-zA-Z0-9_-]{1,48})?")
                || providerId == null || providerId.isEmpty() || providerId.length() > 1024) throw new IllegalArgumentException("插件歌曲标识无效");
        byte[] digest = MessageDigest.getInstance("SHA-256").digest((pluginId + "\0" + providerId).getBytes(StandardCharsets.UTF_8));
        long value = 0;
        for (int i=0; i<7; i++) value = (value << 8) | (digest[i] & 255L);
        return (value & ((1L << 52) - 1)) | (1L << 52);
    }

    static JSONObject track(String pluginId, JSONObject original) throws Exception {
        return track(pluginId, original, "");
    }

    static String playlistKey(String pluginId,String accountScope,String rawId) throws Exception {
        if (rawId==null || rawId.isEmpty() || rawId.length()>4096) throw new IllegalArgumentException("插件歌单标识无效");
        return "plugin:"+pluginId+":"+accountScope+":"+AndroidPluginManager.digest(rawId);
    }

    static String playlistScope(String pluginId,String accountScope) { return "plugin:"+pluginId+":"+accountScope; }

    static JSONObject track(String pluginId, JSONObject original, String accountScope) throws Exception {
        if (original == null || original.optJSONObject("sourceContext") == null) throw new IllegalArgumentException("插件歌曲缺少上下文");
        String rawId = String.valueOf(original.get("id"));
        if (rawId.isEmpty() || rawId.length()>512) throw new IllegalArgumentException("插件歌曲标识过长");
        long id = id(pluginId, accountScope.isEmpty() ? rawId : accountScope + "\0" + rawId);
        JSONArray names = new JSONArray(), artists = original.optJSONArray("artists");
        if (artists != null) for (int i=0;i<artists.length();i++) {
            JSONObject item = artists.optJSONObject(i);
            String name = item == null ? artists.optString(i) : item.optString("name");
            if (!name.isEmpty()) names.put(name);
        }
        JSONObject album = original.optJSONObject("album");
        return new JSONObject().put("id", id).put("name", original.optString("name"))
                .put("duration", Math.max(0, original.optLong("duration"))).put("artists", names)
                .put("album", album == null ? "" : album.optString("name"))
                .put("picUrl", original.optString("picUrl")).put("pluginId", pluginId).put("pluginAccountScope", accountScope)
                .put("pluginTrackId", rawId).put("pluginSourceContext", new JSONObject(original.getJSONObject("sourceContext").toString()))
                .put("pluginTrack", new JSONObject(original.toString())).put("source", "plugin")
                .put("trackVolumeKey", "plugin:" + id).put("playlistVolumeKey", "plugin:" + pluginId + ":" + accountScope)
                .put("playlistVolumeName", pluginId).put("playlistOrderScope", "plugin:" + pluginId + ":" + accountScope)
                .put("playlistOrderKey", pluginId);
    }
}
