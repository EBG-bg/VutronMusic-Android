package io.github.vutronmusic.personal;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;
import java.util.HashSet;
import java.util.Set;

/** The original local plugin sees only recordings already granted to this app. */
final class PluginLocalLibrary {
    static JSONArray tracks(Context context,String pluginId) throws Exception {
        JSONObject source=AndroidPluginManager.requireEnabled(context,pluginId);
        if(!"local".equals(source.optString("type")))throw new AndroidPluginManager.PluginFailure("PLUGIN_NOT_LOCAL","仅本地来源可读取授权音乐库");
        return tracks(context);
    }
    static JSONArray tracks(Context context) throws Exception {
        JSONArray result = new JSONArray(); Set<String> seen = new HashSet<>();
        append(result, seen, LocalTrackStore.load(context));
        append(result, seen, LocalTrackStore.loadFolderIndex(context));
        JSONArray bundles = LocalPlaylistStore.list(new File(context.getFilesDir(), "local-bundles"));
        for (int i=0;i<bundles.length();i++) append(result, seen, bundles.getJSONObject(i).optJSONArray("localTracks"));
        return result;
    }
    private static void append(JSONArray result, Set<String> seen, JSONArray rows) throws Exception {
        if (rows == null) return;
        for (int i=0;i<rows.length();i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row != null && !LocalLibraryIds.uri(row).isEmpty() && seen.add(LocalLibraryIds.key(row))) result.put(row);
        }
    }
    static JSONObject find(Context context, String id) throws Exception {
        JSONArray rows = tracks(context);
        for (int i=0;i<rows.length();i++) {
            JSONObject row = rows.getJSONObject(i);
            if (id.equals(String.valueOf(row.opt("id")))) return row;
        }
        throw new IOException("本地插件曲目已移除或不在授权目录中");
    }
}
