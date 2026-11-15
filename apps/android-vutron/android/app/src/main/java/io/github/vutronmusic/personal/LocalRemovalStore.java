package io.github.vutronmusic.personal;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.TimeUnit;

/** Durable, exact local inverses. Expiring the toast never schedules a later deletion. */
final class LocalRemovalStore {
    private LocalRemovalStore() { }
    private static File file(Context c) { return new File(c.getFilesDir(), "local-removals.json"); }
    private static JSONArray load(Context c) throws Exception {
        return file(c).isFile() ? new JSONObject(new String(Files.readAllBytes(file(c).toPath()), StandardCharsets.UTF_8)).getJSONArray("records") : new JSONArray();
    }
    private static void save(Context c, JSONArray records) throws Exception { LibraryFiles.writeJson(file(c), new JSONObject().put("records", records)); }
    static synchronized JSObject list(Context c, int offset, int limit) throws Exception {
        JSONArray records = load(c), result = new JSONArray();
        for (int i = records.length() - 1 - offset; i >= Math.max(0, records.length() - offset - limit); i--) {
            JSONObject record = records.getJSONObject(i), track = record.getJSONObject("track");
            result.put(new JSONObject().put("id", record.getString("id")).put("name", track.optString("name"))
                    .put("artists", track.optJSONArray("artists") == null ? new JSONArray().put(PlaybackRequest.artistText(track)) : track.getJSONArray("artists"))
                    .put("album", track.optString("album", track.optJSONObject("al") == null ? "" : track.getJSONObject("al").optString("name")))
                    .put("removedAt", record.getLong("removedAt")));
        }
        return new JSObject().put("records", result).put("total", records.length());
    }
    static synchronized JSObject remove(Context c, LibraryTaskRunner tasks, JSONArray supplied, boolean stopConfirmed) throws Exception {
        if (supplied == null || supplied.length() == 0) return new JSObject().put("changed", false);
        File root = new File(c.getFilesDir(), "local-bundles");
        List<JSONObject> targets = new ArrayList<>(); Set<String> keys = new HashSet<>();
        JSONArray found = LocalLibraryManager.findTracks(c, root, supplied);
        for (int i = 0; i < found.length(); i++) {
            JSONObject target = found.getJSONObject(i);
            if (keys.add(LocalLibraryIds.key(target))) targets.add(target);
        }
        tasks.cancel();
        String group = UUID.randomUUID().toString(); JSONArray before = load(c), records = new JSONArray(before.toString());
        Rollback rollback = new Rollback(c, root, targets);
        try {
            Map<String, JSONArray> rawCollections = new HashMap<>(); Map<String, List<JSONObject>> grouped = new LinkedHashMap<>();
            JSONArray folderIndex = LocalTrackStore.loadFolderIndex(c), selectedIndex = LocalTrackStore.load(c);
            for (JSONObject target : targets) {
                String collection = target.optString("localPlaylistId"); JSONObject record = new JSONObject()
                        .put("id", UUID.randomUUID().toString()).put("group", group).put("track", target).put("removedAt", System.currentTimeMillis());
                if (collection.startsWith("restored:") || collection.startsWith("bundle:")) {
                    JSONArray raw = rawCollections.get(collection);
                    if (raw == null) { raw = collection.startsWith("restored:") ? LibraryBackup.collection(c, collection).getJSONArray("tracks") : LocalPlaylistStore.load(LocalPlaylistStore.directory(root, collection)).getJSONArray("tracks"); rawCollections.put(collection, raw); }
                    if (collection.startsWith("restored:")) record.put("kind", "restored").put("rows", LocalRemovalRows.capture(raw, row -> target.optString("localEntryKey").equals(row.optString("key")), row -> row.optString("key")));
                    else { File directory = LocalPlaylistStore.directory(root, collection); record.put("kind", "bundle").put("rows", LocalRemovalRows.capture(raw, row -> LocalPlaylistStore.matchesRemovedTrack(directory, row, target), LocalPlaylistStore::removalIdentity)); }
                    grouped.computeIfAbsent(collection, ignored -> new ArrayList<>()).add(target);
                } else {
                    String key = LocalTrackStore.exclusionKey(target);
                    record.put("kind", "index").put("rows", new JSONObject().put("folders", LocalRemovalRows.capture(folderIndex, row -> key.equals(LocalTrackStore.exclusionKey(row)), LocalTrackStore::exclusionKey))
                            .put("selected", LocalRemovalRows.capture(selectedIndex, row -> key.equals(LocalTrackStore.exclusionKey(row)), LocalTrackStore::exclusionKey)));
                    grouped.computeIfAbsent("index", ignored -> new ArrayList<>()).add(target);
                }
                records.put(record);
            }
            // Persist the inverse first; interrupted removals are safe to restore and never remove anything later.
            boolean accepted = commitThenPrepare(() -> {
                save(c, records);
                for (Map.Entry<String, List<JSONObject>> entry : grouped.entrySet()) {
                    String collection = entry.getKey();
                    if (collection.startsWith("restored:")) { Set<String> removed = new HashSet<>(); for (JSONObject row : entry.getValue()) removed.add(row.getString("localEntryKey")); LibraryBackup.removeEntries(c, collection, removed); }
                    else if (collection.startsWith("bundle:")) LocalPlaylistStore.removeTracks(root, collection, entry.getValue());
                    else LocalTrackStore.excludeMany(c, entry.getValue());
                }
            }, () -> AndroidPlaybackService.prepareLibraryRemoval(c, row -> keys.contains(LocalLibraryIds.key(row)), stopConfirmed, false).get(10, TimeUnit.SECONDS),
                () -> { rollback.restore(); save(c, before); });
            if (!accepted) return new JSObject().put("changed", false).put("requiresStop", true);
            return new JSObject().put("changed", true).put("removedCount", targets.size()).put("undoToken", group);
        } catch (Exception error) { throw error; }
    }
    @FunctionalInterface interface Mutation { void run() throws Exception; }
    @FunctionalInterface interface QueuePreparation { boolean run() throws Exception; }
    static boolean commitThenPrepare(Mutation commit, QueuePreparation prepare, Mutation rollback) throws Exception {
        final boolean accepted;
        try { commit.run(); accepted = prepare.run(); }
        catch (Exception error) { try { rollback.run(); } catch (Exception failed) { error.addSuppressed(failed); } throw error; }
        if (!accepted) rollback.run();
        return accepted;
    }
    static synchronized boolean restore(Context c, String id, boolean group) throws Exception {
        JSONArray before = load(c), selected = new JSONArray(), kept = new JSONArray(); List<JSONObject> targets = new ArrayList<>();
        for (int i = 0; i < before.length(); i++) {
            JSONObject record = before.getJSONObject(i);
            if (id.equals(record.optString(group ? "group" : "id"))) { selected.put(record); targets.add(record.getJSONObject("track")); }
            else kept.put(record);
        }
        if (selected.length() == 0) return false;
        File root = new File(c.getFilesDir(), "local-bundles"); Rollback rollback = new Rollback(c, root, targets);
        try {
            Map<String, JSONArray> byCollection = new LinkedHashMap<>(); JSONArray indexRecords = new JSONArray();
            for (int i = selected.length() - 1; i >= 0; i--) {
                JSONObject record = selected.getJSONObject(i), target = record.getJSONObject("track"); String collection = target.optString("localPlaylistId");
                if ("index".equals(record.getString("kind"))) { indexRecords.put(record); continue; }
                JSONArray rows = byCollection.computeIfAbsent(collection, ignored -> new JSONArray());
                for (int j = 0; j < record.getJSONArray("rows").length(); j++) rows.put(record.getJSONArray("rows").getJSONObject(j));
            }
            LocalTrackStore.restoreRecords(c, indexRecords, false);
            for (Map.Entry<String, JSONArray> entry : byCollection.entrySet()) {
                if (entry.getKey().startsWith("bundle:")) LocalPlaylistStore.restoreRemoved(root, entry.getKey(), entry.getValue());
                else LibraryBackup.restoreRemoved(c, entry.getKey(), entry.getValue());
            }
            save(c, kept); return true;
        } catch (Exception error) { try { rollback.restore(); } catch (Exception rollbackFailure) { error.addSuppressed(rollbackFailure); } throw error; }
    }
    static synchronized boolean restoreAllIndex(Context c) throws Exception {
        JSONArray current = load(c), selected = new JSONArray(), kept = new JSONArray(); List<JSONObject> targets = new ArrayList<>();
        for (int i = current.length() - 1; i >= 0; i--) {
            JSONObject record = current.getJSONObject(i);
            if ("index".equals(record.optString("kind"))) { selected.put(record); targets.add(record.getJSONObject("track")); }
            else kept.put(record);
        }
        Rollback rollback = new Rollback(c, new File(c.getFilesDir(), "local-bundles"), targets);
        try {
            boolean changed = LocalTrackStore.restoreRecords(c, selected, true);
            if (selected.length() > 0) save(c, kept);
            return changed || selected.length() > 0;
        } catch (Exception error) { try { rollback.restore(); } catch (Exception failure) { error.addSuppressed(failure); } throw error; }
    }
    private static final class Rollback {
        final Context context; final Map<File, byte[]> files = new LinkedHashMap<>(); final Map<String, Object> preferences = new HashMap<>();
        Rollback(Context c, File root, List<JSONObject> targets) throws Exception {
            context = c; SharedPreferences prefs = c.getSharedPreferences("local_tracks", Context.MODE_PRIVATE);
            for (String key : new String[]{"tracks", "folder_index"}) preferences.put(key, prefs.contains(key) ? prefs.getString(key, "[]") : null);
            preferences.put("excluded_tracks", prefs.contains("excluded_tracks") ? new HashSet<>(prefs.getStringSet("excluded_tracks", Collections.emptySet())) : null);
            for (JSONObject target : targets) {
                String collection = target.optString("localPlaylistId"); File path = collection.startsWith("restored:") ? new File(c.getFilesDir(), "restored-playlists.json")
                        : collection.startsWith("bundle:") ? new File(LocalPlaylistStore.directory(root, collection), "manifest.json") : null;
                if (path != null && !files.containsKey(path)) files.put(path, path.isFile() ? Files.readAllBytes(path.toPath()) : null);
            }
        }
        @SuppressWarnings("unchecked") void restore() throws Exception {
            for (Map.Entry<File, byte[]> entry : files.entrySet()) if (entry.getValue() != null) LibraryFiles.writeBytes(entry.getKey(), entry.getValue());
            SharedPreferences.Editor editor = context.getSharedPreferences("local_tracks", Context.MODE_PRIVATE).edit();
            for (Map.Entry<String, Object> entry : preferences.entrySet()) {
                if (entry.getValue() == null) editor.remove(entry.getKey());
                else if (entry.getValue() instanceof String) editor.putString(entry.getKey(), (String) entry.getValue());
                else editor.putStringSet(entry.getKey(), (Set<String>) entry.getValue());
            }
            if (!editor.commit()) throw new IOException("本地操作回滚失败");
        }
    }
}
