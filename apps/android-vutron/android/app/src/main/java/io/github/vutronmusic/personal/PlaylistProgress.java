package io.github.vutronmusic.personal;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import org.json.JSONObject;
import java.util.Map;

/** Per-library bookmarks; no session, media URI or audio bytes are stored. */
final class PlaylistProgress {
    private static final String PREFS = "vutron_playlist_progress";
    private static final int MAX_PLAYLISTS = 512;
    private PlaylistProgress() { }

    static String key(String scope, String playlist) {
        if (scope == null || playlist == null || playlist.isEmpty() || playlist.length() > 256
                || !scope.matches("netease:[1-9][0-9]*|local:device|plugin:[a-zA-Z0-9._:-]{1,220}")) return "";
        return scope + "|" + playlist;
    }

    static JSONObject bookmark(JSONObject track, long position, long duration, long now) throws Exception {
        long id = track.optLong("neteaseId");
        if (id <= 0) id = track.optLong("id");
        if (id <= 0 || duration <= 0 || position < 0) return new JSONObject();
        JSONObject result = new JSONObject().put("trackId", id).put("cueTrackNo", track.optInt("cueTrackNo"))
                .put("position", Math.min(position, Math.max(0, duration - 1)))
                .put("duration", duration).put("updatedAt", now);
        if (PluginMedia.isPlugin(track)) result.put("pluginId",track.optString("pluginId")).put("pluginTrackId",track.optString("pluginTrackId"));
        return result;
    }

    static synchronized void save(Context context, JSONObject track, long position, long duration) {
        if (track == null) return;
        String playlist = track.optString("playlistVolumeKey");
        String scope = track.optString("playlistOrderScope", playlist.startsWith("netease:") ? "" : "local:device");
        String key = key(scope, playlist);
        if (key.isEmpty()) return;
        try {
            JSONObject value = bookmark(track, position, duration, System.currentTimeMillis());
            if (!value.has("trackId")) return;
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            SharedPreferences.Editor editor = prefs.edit();
            Map<String, ?> all = prefs.contains(key) ? java.util.Collections.emptyMap() : prefs.getAll();
            if (all.size() >= MAX_PLAYLISTS) {
                String oldest = null; long time = Long.MAX_VALUE;
                for (Map.Entry<String, ?> item : all.entrySet()) {
                    long updated;
                    try { updated = new JSONObject(String.valueOf(item.getValue())).optLong("updatedAt"); }
                    catch (Exception invalid) { updated = 0; }
                    if (updated < time) { oldest = item.getKey(); time = updated; }
                }
                if (oldest != null) editor.remove(oldest);
            }
            editor.putString(key, value.toString()).apply();
        } catch (Exception failure) { Log.w("VutronPlaylistProgress", "Could not save playlist progress", failure); }
    }

    static JSONObject read(Context context, String scope, String playlist) throws Exception {
        String key = key(scope, playlist);
        if (key.isEmpty()) return new JSONObject();
        return new JSONObject(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(key, "{}"));
    }
}
