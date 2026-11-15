package io.github.vutronmusic.personal;

import android.content.Context;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;

/** The sole bridge boundary for local removals; never deletes external original audio. */
final class LocalLibraryManager {
    private LocalLibraryManager() { }
    static JSObject manage(Context context, LibraryTaskRunner tasks, String action, JSONObject supplied, String collectionId, boolean stopConfirmed) throws Exception {
        if ("restoreRemoved".equals(action)) return new JSObject().put("changed", LocalRemovalStore.restoreAllIndex(context));
        if ("removeTrack".equals(action)) return LocalRemovalStore.remove(context, tasks, new JSONArray().put(supplied), stopConfirmed);
        File root = new File(context.getFilesDir(), "local-bundles");
        Predicate<JSONObject> removed;
        if ("deletePlaylist".equals(action)) {
            if (collectionId.startsWith("restored:")) LibraryBackup.collection(context, collectionId);
            else LocalPlaylistStore.directory(root, collectionId);
            removed = row -> LocalLibraryIds.inCollection(row, collectionId);
        } else if ("forgetFolder".equals(action)) {
            boolean found = false; JSONArray trees = LocalFolderStore.loadTreeUris(context);
            for (int i = 0; i < trees.length(); i++) if (collectionId.equals(LocalFolderStore.folderId(trees.optString(i)))) found = true;
            if (!found) throw new IOException("文件夹未授权或已移除");
            removed = row -> LocalLibraryIds.inCollection(row, collectionId);
        } else throw new IOException("本地资料操作无效");
        tasks.cancel();
        if (!AndroidPlaybackService.prepareLibraryRemoval(context, removed, stopConfirmed, "deletePlaylist".equals(action)).get(10, TimeUnit.SECONDS))
            return new JSObject().put("changed", false).put("requiresStop", true);
        if ("deletePlaylist".equals(action)) {
            LocalTrackStore.removeMatching(context, removed);
            if (collectionId.startsWith("restored:")) LibraryBackup.remove(context, collectionId, null);
            else LocalPlaylistStore.delete(root, collectionId);
        } else LocalFolderStore.removeTree(context, collectionId);
        return new JSObject().put("changed", true);
    }
    static JSONArray findTracks(Context context, File root, JSONArray supplied) throws Exception {
        java.util.Map<String, java.util.Map<String, JSONObject>> sources = new java.util.HashMap<>(); JSONArray result = new JSONArray();
        for (int i = 0; i < supplied.length(); i++) {
            JSONObject track = supplied.getJSONObject(i);
            if (LocalLibraryIds.uri(track).isEmpty() && track.optString("localEntryKey").isEmpty()) throw new IOException("只能移除已导入的本地曲目");
            String collection = track.optString("localPlaylistId");
            String source = collection.startsWith("bundle:") || collection.startsWith("restored:") ? collection : "index";
            java.util.Map<String, JSONObject> indexed = sources.get(source);
            if (indexed == null) {
                JSONArray rows;
                if (source.startsWith("bundle:")) rows = LocalPlaylistStore.load(LocalPlaylistStore.directory(root, source)).getJSONArray("localTracks");
                else if (source.startsWith("restored:")) rows = LibraryBackup.tracks(context, source);
                else { rows = LocalTrackStore.loadFolderIndex(context); JSONArray selected = LocalTrackStore.load(context); for (int j = 0; j < selected.length(); j++) rows.put(selected.getJSONObject(j)); }
                indexed = new java.util.HashMap<>();
                for (int j = 0; j < rows.length(); j++) { JSONObject row = rows.getJSONObject(j); indexed.put(LocalLibraryIds.key(row), row); }
                sources.put(source, indexed);
            }
            JSONObject target = indexed.get(LocalLibraryIds.key(track));
            if (target == null) throw new IOException("曲目已移除或不属于本地音乐库");
            result.put(target);
        }
        return result;
    }
}
