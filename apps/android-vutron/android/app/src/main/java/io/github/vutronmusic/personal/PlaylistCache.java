package io.github.vutronmusic.personal;

import android.content.Context;
import android.util.AtomicFile;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Offline snapshot of playlist rows and their complete ordered track lists. */
final class PlaylistCache {
    private static final String TAG = "VutronPlaylistCache";
    private static final String DIRECTORY = "playlist-cache-v1";
    private static final int MAX_BYTES = 16 * 1024 * 1024;
    private static final int MAX_PLAYLIST_BYTES = 64 * 1024 * 1024;
    private static final Object LOCK = new Object();

    private PlaylistCache() { }

    /** Trusted, app-owned sources are read up to the same limit used by their native writer. */
    static int archiveSourceLimit(String fileName) {
        return fileName.startsWith("playlist-") ? MAX_PLAYLIST_BYTES : MAX_BYTES;
    }

    /** Cache ownership is not an authenticated session and survives logout. */
    static void rememberOwner(Context context, long userId) {
        if (userId > 0) context.getSharedPreferences("vutron_cache_index", Context.MODE_PRIVATE)
                .edit().putLong("owner_id", userId).apply();
    }

    static long cachedOwnerId(Context context) {
        String profile = context.getSharedPreferences("vutron_user", Context.MODE_PRIVATE).getString("profile", "");
        long legacyOwner = 0;
        try { if (profile != null && !profile.isEmpty()) legacyOwner = new JSONObject(profile).optLong("userId", 0); }
        catch (JSONException invalid) { Log.d(TAG, "No readable session profile for cache ownership"); }
        if (legacyOwner > 0) { rememberOwner(context, legacyOwner); return legacyOwner; }
        long owner = context.getSharedPreferences("vutron_cache_index", Context.MODE_PRIVATE).getLong("owner_id", 0);
        if (owner > 0) return owner;
        owner = cachedOwnerId(root(context));
        if (owner > 0) rememberOwner(context, owner);
        return owner;
    }

    /** Also recovers snapshots left by versions that already cleared their profile. */
    static long cachedOwnerId(File root) {
        File[] files = root.listFiles();
        if (files == null) return 0;
        java.util.regex.Pattern names = java.util.regex.Pattern.compile(
                "(?:(?:user|recommendations)-([0-9]+)|playlist-([0-9]+)-[0-9]+)[.]json(?:[.]bak)?");
        long selected = 0;
        long newest = Long.MIN_VALUE;
        for (File file : files) {
            if (!file.isFile()) continue;
            java.util.regex.Matcher match = names.matcher(file.getName());
            if (!match.matches()) continue;
            try {
                long owner = Long.parseLong(match.group(1) == null ? match.group(2) : match.group(1));
                long modified = file.lastModified();
                if (owner > 0 && (modified > newest || modified == newest && owner > selected)) {
                    selected = owner; newest = modified;
                }
            } catch (NumberFormatException invalid) { /* Ignore a filename outside the ID range. */ }
        }
        return selected;
    }

    static void savePlaylists(Context context, long userId, List<JSONObject> values) throws IOException {
        if (userId <= 0 || !ArtworkCache.canAutomaticallyCache(context)) return;
        synchronized (LOCK) {
            if (!ArtworkCache.canAutomaticallyCache(context)) return;
            JSONObject document = readDocument(context, userId);
            JSONArray rows = new JSONArray();
            if (values != null) for (JSONObject value : values) if (value != null && !excluded(document, value.optLong("id"))) rows.put(copy(value));
            try { document.put("playlists", rows).put("updatedAt", System.currentTimeMillis()); }
            catch (JSONException invalid) { throw new IOException("Cannot encode playlist snapshot", invalid); }
            writeDocument(context, userId, document);
        }
        if (values != null) for (JSONObject value : values) ArtworkCache.enqueue(context, value.optString("coverImgUrl", value.optString("picUrl", "")));
    }

    static void saveRecommendedPlaylists(Context context, long userId, List<JSONObject> values) throws IOException {
        if (userId <= 0 || !ArtworkCache.canAutomaticallyCache(context)) return;
        JSONArray rows = new JSONArray();
        if (values != null) for (JSONObject value : values) rows.put(copy(value));
        JSONObject document;
        try { document = new JSONObject().put("version", 1).put("userId", userId)
                .put("updatedAt", System.currentTimeMillis()).put("playlists", rows); }
        catch (JSONException invalid) { throw new IOException("Cannot encode home recommendation snapshot", invalid); }
        synchronized (LOCK) {
            if (ArtworkCache.canAutomaticallyCache(context)) writeAtomic(recommendationFile(context, userId), document, MAX_BYTES);
        }
    }

    static List<JSONObject> readRecommendedPlaylists(Context context, long userId) {
        List<JSONObject> result = new ArrayList<>();
        if (userId <= 0) return result;
        try {
            JSONObject document = readAtomic(recommendationFile(context, userId), MAX_BYTES);
            JSONArray rows = document == null ? null : document.optJSONArray("playlists");
            if (rows != null) for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row != null) result.add(decorate(context, row));
            }
        } catch (Exception error) { Log.w(TAG, "Home recommendation cache unavailable", error); }
        return result;
    }

    static boolean saveTracks(Context context, long userId, long playlistId, List<JSONObject> values) throws IOException {
        return saveTracks(context, userId, playlistId, values, null);
    }

    static boolean saveTracks(Context context, long userId, long playlistId, List<JSONObject> values, JSONObject suppliedPlaylist) throws IOException {
        return saveTracks(context, userId, playlistId, values, suppliedPlaylist, false);
    }

    static boolean saveTracks(Context context, long userId, long playlistId, List<JSONObject> values, JSONObject suppliedPlaylist, boolean explicitlyRestore) throws IOException {
        if (userId <= 0 || playlistId <= 0 || !explicitlyRestore && !ArtworkCache.canAutomaticallyCache(context)) return false;
        JSONArray rows = new JSONArray();
        if (values != null) for (JSONObject value : values) rows.put(copy(value));
        JSONObject snapshot;
        try { snapshot = new JSONObject().put("version", 1).put("userId", userId).put("playlistId", playlistId)
                .put("updatedAt", System.currentTimeMillis()).put("tracks", rows); }
        catch (JSONException invalid) { throw new IOException("Cannot encode playlist track snapshot", invalid); }
        synchronized (LOCK) {
            if (!explicitlyRestore && !ArtworkCache.canAutomaticallyCache(context)) return false;
            JSONObject document = readDocument(context, userId);
            if (!explicitlyRestore && excluded(document, playlistId)) return false;
            writeAtomic(trackFile(context, userId, playlistId), snapshot, MAX_PLAYLIST_BYTES);
            if (explicitlyRestore) exclude(document, playlistId, false);
            JSONObject recommendations = readAtomic(recommendationFile(context, userId), MAX_BYTES);
            JSONObject known = findPlaylist(document.optJSONArray("playlists"), playlistId);
            JSONObject recommended = findPlaylist(recommendations == null ? null : recommendations.optJSONArray("playlists"), playlistId);
            JSONObject visited = findPlaylist(document.optJSONArray("visitedPlaylists"), playlistId);
            JSONObject metadata = playlistMetadata(playlistId, rows.length(), known, recommended, suppliedPlaylist, visited);
            JSONArray updated = new JSONArray();
            JSONArray previous = document.optJSONArray("visitedPlaylists");
            if (previous != null) for (int index = 0; index < previous.length(); index++) {
                JSONObject row = previous.optJSONObject(index);
                if (row != null && row.optLong("id") != playlistId) updated.put(copy(row));
            }
            updated.put(metadata);
            try { document.put("visitedPlaylists", updated); }
            catch (JSONException invalid) { throw new IOException("Cannot encode visited playlist index", invalid); }
            writeDocument(context, userId, document);
            return true;
        }
    }

    static List<JSONObject> readPlaylists(Context context, long userId) {
        List<JSONObject> result = new ArrayList<>();
        if (userId <= 0) return result;
        try {
            JSONObject document = readDocument(context, userId);
            JSONArray rows = visiblePlaylists(document);
            if (rows != null) for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row != null) result.add(decorate(context, row));
            }
        } catch (Exception error) { Log.w(TAG, "Playlist cache unavailable", error); }
        return result;
    }

    static List<JSONObject> readTracks(Context context, long userId, long playlistId) {
        List<JSONObject> result = new ArrayList<>();
        if (userId <= 0 || playlistId <= 0) return result;
        try {
            if (excluded(readDocument(context, userId), playlistId)) return result;
            JSONObject snapshot = readAtomic(trackFile(context, userId, playlistId), MAX_PLAYLIST_BYTES);
            JSONArray rows = snapshot == null ? null : snapshot.optJSONArray("tracks");
            if (rows != null) for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row != null) result.add(decorate(context, row));
            }
        } catch (Exception error) { Log.w(TAG, "Playlist track cache unavailable", error); }
        return result;
    }

    static boolean excludesAutomaticSnapshot(Context context, long userId, long playlistId) throws IOException {
        return excluded(readDocument(context, userId), playlistId);
    }

    static boolean hasTrackSnapshot(Context context, long userId, long playlistId) {
        if (userId <= 0 || playlistId <= 0) return false;
        try { return !excluded(readDocument(context, userId), playlistId) && validTrackSnapshot(readAtomic(trackFile(context, userId, playlistId), MAX_PLAYLIST_BYTES), userId, playlistId); }
        catch (IOException unavailable) { return false; }
    }

    static boolean validTrackSnapshot(JSONObject snapshot, long userId, long playlistId) {
        return snapshot != null && snapshot.optLong("userId") == userId
                && snapshot.optLong("playlistId") == playlistId && snapshot.optJSONArray("tracks") != null;
    }

    static JSONArray mergedPlaylists(JSONArray owned, JSONArray visited) {
        JSONArray result = new JSONArray();
        java.util.Set<Long> seen = new java.util.LinkedHashSet<>();
        for (JSONArray source : new JSONArray[]{owned, visited}) {
            for (int index = 0; source != null && index < source.length(); index++) {
                JSONObject row = source.optJSONObject(index);
                if (row != null && row.optLong("id") > 0 && seen.add(row.optLong("id"))) result.put(copy(row));
            }
        }
        return result;
    }

    static JSONArray visiblePlaylists(JSONObject document) {
        JSONArray result = new JSONArray();
        JSONArray rows = mergedPlaylists(document.optJSONArray("playlists"), document.optJSONArray("visitedPlaylists"));
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row != null && !excluded(document, row.optLong("id"))) result.put(row);
        }
        return result;
    }
    static boolean excluded(JSONObject document, long playlistId) {
        JSONArray ids = document.optJSONArray("excludedPlaylistIds");
        for (int i = 0; ids != null && i < ids.length(); i++) if (ids.optLong(i) == playlistId) return true;
        return false;
    }
    static void exclude(JSONObject document, long playlistId, boolean excluded) throws IOException {
        JSONArray ids = document.optJSONArray("excludedPlaylistIds"), updated = new JSONArray();
        for (int i = 0; ids != null && i < ids.length(); i++) if (ids.optLong(i) > 0 && ids.optLong(i) != playlistId) updated.put(ids.optLong(i));
        if (excluded) updated.put(playlistId);
        try { document.put("excludedPlaylistIds", updated); }
        catch (JSONException invalid) { throw new IOException("无法保存缓存歌单移除记录", invalid); }
    }

    static JSONObject playlistMetadata(long playlistId, int trackCount, JSONObject... candidates) throws IOException {
        String name = "", cover = "";
        for (JSONObject candidate : candidates) {
            if (candidate == null || candidate.optLong("id", playlistId) != playlistId) continue;
            if (name.isEmpty() && candidate.opt("name") instanceof String) {
                name = candidate.optString("name").trim();
                if (name.length() > 500) name = name.substring(0, 500);
            }
            if (cover.isEmpty()) {
                String value = candidate.optString("coverImgUrl", candidate.optString("picUrl", "")).trim();
                try {
                    java.net.URI uri = new java.net.URI(value);
                    if (value.length() <= 2048 && uri.getHost() != null && uri.getUserInfo() == null
                            && ("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme()))) cover = value;
                } catch (java.net.URISyntaxException invalidCover) { /* Keep searching known remote metadata. */ }
            }
        }
        try {
            JSONObject result = new JSONObject().put("id", playlistId).put("name", name.isEmpty() ? "歌单 " + playlistId : name)
                    .put("coverImgUrl", cover).put("trackCount", Math.max(0, trackCount));
            for (JSONObject candidate : candidates) if (candidate != null && candidate.optLong("id", playlistId) == playlistId) {
                for (String key : new String[]{"creatorUserId", "subscribed", "privacy", "description", "tags", "specialType"}) if (!result.has(key) && candidate.has(key)) result.put(key, candidate.get(key));
                if (!result.has("creatorUserId") && candidate.optJSONObject("creator") != null) result.put("creatorUserId", candidate.getJSONObject("creator").optLong("userId"));
            }
            return result;
        }
        catch (JSONException invalid) { throw new IOException("Cannot encode playlist display metadata", invalid); }
    }

    private static JSONObject findPlaylist(JSONArray rows, long playlistId) {
        for (int index = 0; rows != null && index < rows.length(); index++) {
            JSONObject row = rows.optJSONObject(index);
            if (row != null && row.optLong("id") == playlistId) return row;
        }
        return null;
    }

    static void removePlaylist(Context context, long userId, long playlistId) throws IOException {
        removePlaylist(context, userId, playlistId, false);
    }
    static void removeCachedPlaylist(Context context, long userId, long playlistId) throws IOException {
        removePlaylist(context, userId, playlistId, true);
    }
    private static void removePlaylist(Context context, long userId, long playlistId, boolean excludeFromAutomaticCache) throws IOException {
        if (userId <= 0 || playlistId <= 0) throw new IOException("歌单缓存标识无效");
        synchronized (LOCK) {
            JSONObject document = readDocument(context, userId);
            if (excludeFromAutomaticCache) exclude(document, playlistId, true);
            try {
                for (String key : new String[]{"playlists", "visitedPlaylists"}) {
                    JSONArray kept = new JSONArray(), rows = document.optJSONArray(key);
                    for (int i = 0; rows != null && i < rows.length(); i++) if (rows.getJSONObject(i).optLong("id") != playlistId) kept.put(rows.getJSONObject(i));
                    document.put(key, kept);
                }
            } catch (JSONException invalid) { throw new IOException("删除歌单缓存索引失败", invalid); }
            writeDocument(context, userId, document);
            new AtomicFile(trackFile(context, userId, playlistId)).delete();
            if (trackFile(context, userId, playlistId).exists() || new File(trackFile(context, userId, playlistId) + ".bak").exists()) throw new IOException("歌单资料文件未能清理，请重试");
        }
    }

    static long bytes(Context context) {
        File root = root(context);
        File[] files = root.listFiles(file -> file.isFile() && !file.getName().endsWith(".bak"));
        long total = 0;
        if (files != null) for (File file : files) total += Math.max(0, file.length());
        return total;
    }

    static void clear(Context context) {
        synchronized (LOCK) {
            File[] files = root(context).listFiles();
            if (files != null) for (File file : files) if (file.isFile()) file.delete();
            ArtworkCache.clear(context);
        }
    }

    private static JSONObject decorate(Context context, JSONObject value) throws JSONException {
        JSONObject result = copy(value);
        String cover = result.optString("coverImgUrl", result.optString("picUrl", ""));
        if (!cover.isEmpty()) result.put("coverLocalUri", ArtworkCache.resolve(context, cover));
        JSONObject album = result.optJSONObject("al");
        if (album != null) {
            String pic = album.optString("picUrl", "");
            if (!pic.isEmpty()) album.put("picLocalUri", ArtworkCache.resolve(context, pic));
        }
        String pic = result.optString("picUrl", "");
        if (!pic.isEmpty()) result.put("picLocalUri", ArtworkCache.resolve(context, pic));
        return result;
    }

    private static JSONObject readDocument(Context context, long userId) throws IOException {
        AtomicFile file = new AtomicFile(new File(root(context), "user-" + userId + ".json"));
        if (!file.getBaseFile().isFile() && !new File(file.getBaseFile() + ".bak").isFile()) return emptyDocument(userId);
        synchronized (LOCK) {
            try (FileInputStream input = file.openRead(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (output.size() + count > MAX_BYTES) throw new IOException("Playlist cache exceeds its size limit");
                    output.write(buffer, 0, count);
                }
                return new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
            } catch (Exception invalid) {
                Log.w(TAG, "Unreadable playlist cache; replacing snapshot", invalid);
                return emptyDocument(userId);
            }
        }
    }

    private static JSONObject emptyDocument(long userId) throws IOException {
        try { return new JSONObject().put("version", 1).put("userId", userId).put("playlists", new JSONArray()).put("tracks", new JSONObject()); }
        catch (JSONException invalid) { throw new IOException("Cannot create playlist cache snapshot", invalid); }
    }

    private static void writeDocument(Context context, long userId, JSONObject document) throws IOException {
        writeAtomic(new File(root(context), "user-" + userId + ".json"), document, MAX_BYTES);
    }

    private static File trackFile(Context context, long userId, long playlistId) {
        return new File(root(context), "playlist-" + userId + "-" + playlistId + ".json");
    }

    private static File recommendationFile(Context context, long userId) {
        return new File(root(context), "recommendations-" + userId + ".json");
    }

    private static JSONObject readAtomic(File base, int maxBytes) throws IOException {
        AtomicFile file = new AtomicFile(base);
        if (!file.getBaseFile().isFile() && !new File(file.getBaseFile() + ".bak").isFile()) return null;
        synchronized (LOCK) {
            try (FileInputStream input = file.openRead(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (output.size() + count > maxBytes) throw new IOException("Playlist snapshot exceeds its size limit");
                    output.write(buffer, 0, count);
                }
                return new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
            } catch (Exception invalid) {
                Log.w(TAG, "Unreadable playlist track snapshot", invalid);
                return null;
            }
        }
    }

    private static void writeAtomic(File destination, JSONObject document, int maxBytes) throws IOException {
        byte[] raw = document.toString().getBytes(StandardCharsets.UTF_8);
        if (raw.length > maxBytes) throw new IOException("Playlist cache exceeds its size limit");
        writeAtomic(destination, raw);
    }

    private static void writeAtomic(File destination, byte[] raw) throws IOException {
        File root = destination.getParentFile();
        if (!root.isDirectory() && !root.mkdirs() && !root.isDirectory()) throw new IOException("Playlist cache directory unavailable");
        AtomicFile file = new AtomicFile(destination);
        FileOutputStream output = null;
        try {
            output = file.startWrite();
            output.write(raw);
            file.finishWrite(output);
        } catch (IOException failure) {
            if (output != null) file.failWrite(output);
            throw failure;
        }
    }

    /** Restore only absent cache rows/snapshots, retaining the destination account's exclusions. */
    static boolean restoreArchiveSnapshot(Context context, long owner, String name, File staged) throws Exception {
        synchronized (LOCK) {
            File base = root(context);
            if (name.startsWith("user-")) {
                File destination = new File(base, name);
                if (!destination.exists() && !new File(base, name + ".bak").exists())
                    return BackupCacheArchive.moveNew(staged, context.getFilesDir(), DIRECTORY, name);
                JSONObject target = readDocument(context, owner);
                JSONObject source = readAtomic(staged, MAX_BYTES);
                if (source == null) throw new IOException("无法读取待恢复的歌单索引");
                byte[] merged = mergedArchiveIndex(target, source, MAX_BYTES);
                if (merged == null) return false;
                writeAtomic(destination, merged);
                return true;
            }
            if (name.startsWith("playlist-")) {
                long playlistId = Long.parseLong(name.substring(name.lastIndexOf('-') + 1, name.length() - 5));
                if (excluded(readDocument(context, owner), playlistId)) return false;
            }
            return BackupCacheArchive.moveNew(staged, context.getFilesDir(), DIRECTORY, name);
        }
    }

    /** A valid archive and an existing index can exceed the limit only after combining. Keep the old index. */
    static byte[] mergedArchiveIndex(JSONObject target, JSONObject source, int maxBytes) throws JSONException {
        JSONArray previous = target.optJSONArray("visitedPlaylists"), merged = new JSONArray();
        for (int i = 0; previous != null && i < previous.length(); i++) merged.put(previous.get(i));
        JSONArray current = visiblePlaylists(target);
        java.util.Set<Long> ids = new java.util.HashSet<>();
        for (int i = 0; i < current.length(); i++) ids.add(current.getJSONObject(i).getLong("id"));
        int previousSize = merged.length();
        JSONArray items = visiblePlaylists(source);
        for (int i = 0; i < items.length(); i++) {
            JSONObject row = items.getJSONObject(i); long id = row.getLong("id");
            if (!excluded(target, id) && ids.add(id)) merged.put(row);
        }
        if (merged.length() == previousSize) return null;
        JSONObject updated = new JSONObject();
        for (java.util.Iterator<String> keys = target.keys(); keys.hasNext();) {
            String key = keys.next(); updated.put(key, target.get(key));
        }
        updated.put("visitedPlaylists", merged);
        byte[] encoded = updated.toString().getBytes(StandardCharsets.UTF_8);
        return encoded.length <= maxBytes ? encoded : null;
    }

    private static JSONObject copy(JSONObject value) {
        try { return new JSONObject(value == null ? "{}" : value.toString()); }
        catch (JSONException invalid) { throw new IllegalArgumentException("Invalid playlist cache value", invalid); }
    }
    private static File root(Context context) { return new File(context.getFilesDir(), DIRECTORY); }
}
