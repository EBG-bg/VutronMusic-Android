package io.github.vutronmusic.personal;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Offline metadata only: reconnects playlist rows to existing, account-scoped audio cache entries. */
final class PluginPlaylistCache {
    private static final String TAG = "VutronPluginPlaylists";
    private static final String DIRECTORY = "plugin-playlist-cache-v1";
    private static final int MAX_PLAYLISTS = 512, MAX_TRACKS = 20_000;
    private static final int MAX_HEADER_BYTES = 8 * 1024;
    static final int MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
    private static final long MAX_TOTAL_BYTES = 96L * 1024 * 1024;
    private static final Object LOCK = new Object();

    private PluginPlaylistCache() { }

    record Owner(String scope, String name) { }
    record Snapshot(JSONObject header, JSONArray rows) { }

    static String key(String pluginId, String scope, String remoteId) throws Exception {
        return AndroidPluginManager.digest(PluginTrackAdapter.playlistKey(AndroidPluginManager.identity(pluginId), checkedKey(scope), remoteId));
    }

    static void save(Context context, String pluginId, String accountScope, JSONObject detail, List<JSONObject> adaptedTracks) throws Exception {
        Map<String, Owner> owners = currentOwners(context);
        Owner owner = owners.get(pluginId);
        if (owner == null || !owner.scope.equals(accountScope)) throw new IOException("插件账号已变化，请重新打开音乐库");
        for (JSONObject track : adaptedTracks) if (!visible(track, owners)) throw new IOException("曲目的插件账号已变化，请重新打开音乐库");
        Snapshot snapshot = snapshot(pluginId, accountScope, owner.name, detail, adaptedTracks);
        write(root(context), snapshot);
    }

    static void write(File directory, Snapshot snapshot) throws Exception {
        if (!publish(directory, snapshot, encode(snapshot), true)) throw new IOException("离线歌单资料已满，请先删除不再使用的歌单快照");
    }

    private static byte[] encode(Snapshot snapshot) throws IOException {
        byte[] header = snapshot.header.toString().getBytes(StandardCharsets.UTF_8);
        byte[] rows = snapshot.rows.toString().getBytes(StandardCharsets.UTF_8);
        if (header.length > MAX_HEADER_BYTES || header.length + 1L + rows.length > MAX_SNAPSHOT_BYTES)
            throw new IOException("歌单资料超过离线保存上限");
        byte[] contents = new byte[header.length + 1 + rows.length];
        System.arraycopy(header, 0, contents, 0, header.length);
        contents[header.length] = '\n';
        System.arraycopy(rows, 0, contents, header.length + 1, rows.length);
        return contents;
    }

    private static boolean publish(File directory, Snapshot snapshot, byte[] contents, boolean replaceExisting) throws Exception {
        synchronized (LOCK) {
            // Publish header and ordered tracks together; a failed save leaves the previous snapshot intact.
            if (!directory.isDirectory() && !directory.mkdirs() && !directory.isDirectory()) throw new IOException("无法创建离线歌单目录");
            File file = file(directory, snapshot.header.getString("pluginCacheKey"));
            boolean exists = file.isFile();
            if (!replaceExisting && exists) return false;
            File[] previous = snapshotFiles(directory);
            if ((!exists && previous.length >= MAX_PLAYLISTS) || bytes(previous) - file.length() + contents.length > MAX_TOTAL_BYTES) return false;
            LibraryFiles.writeBytes(file, contents);
            return true;
        }
    }

    static List<JSONObject> list(Context context) {
        try {
            File directory = root(context);
            if (snapshotFiles(directory).length == 0) return List.of();
            List<JSONObject> headers = headers(directory, currentOwners(context));
            for (JSONObject header : headers) withCover(context, header, "coverLocalUri");
            return headers;
        } catch (Exception unavailable) {
            Log.w(TAG, "Cannot inspect offline playlist owners");
            return List.of();
        }
    }

    static List<JSONObject> headers(File directory, Map<String, Owner> owners) {
        List<JSONObject> result = new ArrayList<>();
        synchronized (LOCK) {
            for (File snapshot : snapshotFiles(directory)) {
                try (InputStream input = open(snapshot)) {
                    JSONObject header = readHeader(input, snapshot.getName().substring(0, 64));
                    if (visible(header, owners)) result.add(header);
                } catch (Exception unreadable) {
                    Log.w(TAG, "Ignoring an unreadable offline playlist header");
                }
            }
        }
        result.sort(Comparator.comparingLong((JSONObject row) -> row.optLong("savedAt")).reversed());
        return result;
    }

    static List<JSONObject> tracks(Context context, String key) throws Exception {
        Snapshot snapshot = read(root(context), key, currentOwners(context));
        Map<Long, AudioCache.Entry> available = new HashMap<>();
        // One cheap index read. Playback alone verifies hashes and updates audio LRU.
        for (AudioCache.Entry entry : AudioCache.backupEntries(context)) available.put(entry.songId, entry);
        Map<String, Owner> owners = currentOwners(context);
        JSONObject header = snapshot.header;
        if (!visible(header, owners)) throw new IOException("当前插件账号无法读取此离线歌单");
        List<JSONObject> result = new ArrayList<>(snapshot.rows.length());
        for (int i = 0; i < snapshot.rows.length(); i++) {
            JSONObject row = snapshot.rows.getJSONObject(i);
            if (!visible(row, owners)) continue;
            AudioCache.Entry cached = available.get(row.optLong("id"));
            if (cached != null && matchesAudio(row, cached.song)) {
                row.put("cached", true).put("cacheSource", cached.source).put("cacheBitrate", cached.bitrate)
                        .put("cacheFormat", cached.format).put("cacheLossless", cached.lossless).put("bytes", cached.bytes);
            }
            row.put("localEntryKey", rowKey(key, i)).put("source", "plugin-snapshot").put("offlineOnly", true)
                    .put("playlistVolumeKey", header.getString("volumeKey")).put("playlistVolumeName", header.getString("name"));
            result.add(withCover(context, row, "picLocalUri"));
        }
        return result;
    }

    static Snapshot read(File directory, String key, Map<String, Owner> owners) throws Exception {
        synchronized (LOCK) {
            try (InputStream input = open(file(directory, key))) {
                return readSnapshot(input, requireOwned(input, key, owners));
            }
        }
    }

    static void remove(Context context, String key) throws Exception {
        remove(root(context), key, currentOwners(context));
    }

    static void remove(File directory, String key, Map<String, Owner> owners) throws Exception {
        synchronized (LOCK) {
            File snapshot = file(directory, key);
            try (InputStream input = open(snapshot)) { requireOwned(input, key, owners); }
            if (!snapshot.delete()) throw new IOException("未能移除离线歌单资料");
        }
    }

    static void clear(Context context) throws IOException {
        synchronized (LOCK) {
            for (File snapshot : snapshotFiles(root(context))) if (!snapshot.delete() && snapshot.exists())
                throw new IOException("部分离线歌单资料未能清理");
        }
    }

    static long bytes(Context context) {
        synchronized (LOCK) { return bytes(snapshotFiles(root(context))); }
    }

    static List<File> backupFiles(Context context) throws Exception {
        File[] files = snapshotFiles(root(context));
        if (files.length == 0) return List.of();
        Map<String, Owner> owners = currentOwners(context);
        List<File> result = new ArrayList<>();
        synchronized (LOCK) {
            for (File file : files) try (InputStream input = open(file)) {
                JSONObject header = readHeader(input, file.getName().substring(0, 64));
                if (visible(header, owners) && allVisible(readSnapshot(input, header).rows, owners)) result.add(file);
            } catch (Exception unreadable) { Log.w(TAG, "Ignoring an unreadable offline playlist backup entry"); }
        }
        return result;
    }

    static byte[] portableBackup(File file, String key) throws Exception { return encode(portableSnapshot(file, key)); }

    static void sanitizeBackup(File staged, String key) throws Exception { LibraryFiles.writeBytes(staged, portableBackup(staged, key)); }

    static boolean restoreBackup(Context context, File staged, String key) throws Exception {
        return restoreBackup(root(context), staged, key, currentOwners(context));
    }

    static boolean restoreBackup(File directory, File staged, String key, Map<String, Owner> owners) throws Exception {
        Snapshot snapshot = portableSnapshot(staged, key);
        if (!visible(snapshot.header, owners) || !allVisible(snapshot.rows, owners)) return false;
        File targetVolume = directory.isDirectory() ? directory : directory.getParentFile();
        if (targetVolume != null && targetVolume.getUsableSpace() < staged.length()) return false;
        return publish(directory, snapshot, encode(snapshot), false);
    }

    private static Snapshot portableSnapshot(File file, String key) throws Exception {
        try (InputStream input = open(file)) {
            Snapshot snapshot = readSnapshot(input, readHeader(input, key));
            JSONObject source = snapshot.header;
            String id = AndroidPluginManager.identity(source.getString("pluginId")), scope = checkedKey(source.getString("pluginAccountScope"));
            String volumeKey = source.getString("volumeKey"), prefix = PluginTrackAdapter.playlistScope(id, scope) + ":";
            if (!volumeKey.startsWith(prefix) || !validKey(volumeKey.substring(prefix.length()))
                    || !key.equals(AndroidPluginManager.digest(volumeKey))) throw new IOException("离线歌单标识不匹配");
            long numericId = PluginTrackAdapter.id(id, "snapshot:" + key);
            if (source.getLong("id") != numericId) throw new IOException("离线歌单标识不匹配");
            JSONObject header = new JSONObject().put("version", 1).put("id", numericId).put("name", text(source.getString("name"), 500))
                    .put("pluginCacheKey", key).put("pluginId", id).put("pluginAccountScope", scope).put("offlineSnapshot", true)
                    .put("trackCount", snapshot.rows.length()).put("cacheProviderName", text(source.optString("cacheProviderName"), 96))
                    .put("savedAt", Math.max(0, source.optLong("savedAt"))).put("createTime", Math.max(0, source.optLong("createTime")))
                    .put("volumeKey", volumeKey);
            copyCover(source, header);
            JSONArray rows = new JSONArray();
            for (int i = 0; i < snapshot.rows.length(); i++) {
                JSONObject track = snapshot.rows.getJSONObject(i);
                rows.put(trackMetadata(track, AndroidPluginManager.identity(track.getString("pluginId")), checkedKey(track.getString("pluginAccountScope")),
                        track.getLong("id"), checkedKey(track.getString("trackFingerprint"))));
            }
            return new Snapshot(header, rows);
        }
    }

    private static boolean allVisible(JSONArray tracks, Map<String, Owner> owners) throws Exception {
        for (int i = 0; i < tracks.length(); i++) if (!visible(tracks.getJSONObject(i), owners)) return false;
        return true;
    }

    static Snapshot snapshot(String pluginId, String scope, String provider, JSONObject detail, List<JSONObject> ordered) throws Exception {
        Object rawId = detail.get("id");
        if (!(rawId instanceof String || rawId instanceof Number)) throw new IOException("插件歌单标识无效");
        if (ordered.size() > MAX_TRACKS || detail.has("trackCount") && detail.optLong("trackCount", -1) != ordered.size())
            throw new IOException("歌单仍有曲目未读取，无法保存离线资料");
        String remoteId = String.valueOf(rawId), cacheKey = key(pluginId, scope, remoteId);
        String name = text(detail.optString("name"), 500);
        long now = System.currentTimeMillis();
        long numericId = PluginTrackAdapter.id(pluginId, "snapshot:" + cacheKey);
        JSONObject header = new JSONObject().put("version", 1).put("id", numericId).put("name", name).put("pluginCacheKey", cacheKey)
                .put("pluginId", pluginId).put("pluginAccountScope", scope).put("offlineSnapshot", true)
                .put("trackCount", ordered.size()).put("cacheProviderName", text(provider, 96)).put("savedAt", now)
                .put("createTime", detail.optLong("createTime", now)).put("volumeKey", PluginTrackAdapter.playlistKey(pluginId, scope, remoteId));
        copyCover(detail, header);
        JSONArray rows = new JSONArray();
        for (JSONObject source : ordered) rows.put(displayTrack(source));
        return new Snapshot(header, rows);
    }

    private static JSONObject displayTrack(JSONObject source) throws Exception {
        String pluginId = AndroidPluginManager.identity(source.getString("pluginId")), scope = checkedKey(source.getString("pluginAccountScope"));
        String remoteId = source.getString("pluginTrackId");
        if (remoteId.isEmpty() || remoteId.length() > 512) throw new IOException("插件曲目标识无效");
        String fingerprint = audioFingerprint(pluginId, scope, remoteId);
        return trackMetadata(source, pluginId, scope, source.getLong("id"), fingerprint);
    }

    private static String audioFingerprint(String pluginId, String scope, String trackId) throws Exception {
        return AndroidPluginManager.digest(pluginId + "\0" + scope + "\0" + trackId);
    }

    private static JSONObject trackMetadata(JSONObject source, String pluginId, String scope, long id, String fingerprint) throws Exception {
        // Same low 52 bits of the leading seven hash bytes as PluginTrackAdapter.id.
        if (id != numericTrackId(fingerprint)) throw new IOException("插件曲目标识无效");
        JSONArray names = new JSONArray(), artists = source.optJSONArray("artists");
        for (int i = 0; artists != null && i < Math.min(artists.length(), 32); i++) {
            String name = text(artists.optString(i), 200);
            if (!name.isEmpty()) names.put(name);
        }
        JSONObject safe = new JSONObject().put("id", id).put("name", text(source.optString("name"), 500)).put("artists", names)
                .put("album", text(source.optString("album"), 500)).put("duration", Math.max(0, Math.min(86_400_000L, source.optLong("duration"))))
                .put("pluginId", pluginId).put("pluginAccountScope", scope).put("trackVolumeKey", "plugin:" + id)
                .put("trackFingerprint", fingerprint);
        copyCover(source, safe);
        return safe;
    }

    /** Cache ZIPs keep this digest instead of the provider's raw ID. */
    static String audioFingerprint(JSONObject value) throws Exception {
        String pluginId = value.optString("pluginId"), scope = value.optString("pluginAccountScope");
        String id = value.optString("pluginTrackId"), saved = value.optString("trackFingerprint");
        if (pluginId.isEmpty() || !validKey(scope)) return "";
        String fingerprint = id.isEmpty() && validKey(saved) ? saved : id.isEmpty() ? "" : audioFingerprint(pluginId, scope, id);
        return !fingerprint.isEmpty() && numericTrackId(fingerprint) == value.optLong("id") ? fingerprint : "";
    }

    private static long numericTrackId(String fingerprint) {
        return Long.parseLong(fingerprint.substring(1, 14), 16) | (1L << 52);
    }

    static boolean matchesAudio(JSONObject row, JSONObject cached) throws Exception {
        return row.optLong("id", 0) > 0 && row.optLong("id") == cached.optLong("id")
                && row.getString("pluginId").equals(cached.optString("pluginId"))
                && row.getString("pluginAccountScope").equals(cached.optString("pluginAccountScope"))
                && row.getString("trackFingerprint").equals(audioFingerprint(cached));
    }

    static String rowKey(String key, int index) { return "plugin-snapshot:" + key + ":" + index; }

    private static JSONObject requireOwned(InputStream input, String key, Map<String, Owner> owners) throws Exception {
        JSONObject header = readHeader(input, key);
        if (!visible(header, owners)) throw new IOException("当前插件账号无法读取此离线歌单");
        return header;
    }

    static boolean matchesScope(JSONObject row, String scope) {
        return scope != null && scope.equals(row.optString("pluginAccountScope"));
    }

    private static boolean visible(JSONObject row, Map<String, Owner> owners) {
        Owner owner = owners.get(row.optString("pluginId"));
        return owner != null && matchesScope(row, owner.scope);
    }

    private static Map<String, Owner> currentOwners(Context context) throws Exception {
        Map<String, Owner> result = new HashMap<>();
        JSONArray plugins = AndroidPluginManager.list(context).getJSONArray("plugins");
        for (int i = 0; i < plugins.length(); i++) {
            JSONObject plugin = plugins.getJSONObject(i);
            if (plugin.optBoolean("enabled", true)) result.put(plugin.getString("id"), new Owner(plugin.getString("accountScope"), plugin.optString("name")));
        }
        return result;
    }

    private static void copyCover(JSONObject source, JSONObject target) throws Exception {
        String fingerprint = source.optString("coverFingerprint");
        if (validKey(fingerprint)) target.put("coverFingerprint", fingerprint);
    }

    private static JSONObject withCover(Context context, JSONObject row, String field) throws Exception {
        String fingerprint = row.optString("coverFingerprint");
        row.remove("coverFingerprint");
        if (validKey(fingerprint)) {
            String local = ArtworkCache.resolveOwnedFingerprint(context, fingerprint);
            if (!local.isEmpty()) row.put(field, local);
        }
        // Internal playlist volume IDs are kept on track rows, not exposed in the catalogue.
        row.remove("volumeKey");
        row.remove("version");
        return row;
    }

    private static JSONObject readHeader(InputStream input, String key) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        for (int next; (next = input.read()) >= 0; ) {
            if (next == '\n') {
                JSONObject value = new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
                if (value.optInt("version") == 1 && checkedKey(key).equals(value.optString("pluginCacheKey")) && value.optLong("id") > 0) return value;
                break;
            }
            if (bytes.size() >= MAX_HEADER_BYTES) break;
            bytes.write(next);
        }
        throw new IOException("离线歌单索引损坏");
    }

    private static Snapshot readSnapshot(InputStream input, JSONObject header) throws Exception {
        JSONArray rows = readTracks(input);
        if (rows.length() > MAX_TRACKS || rows.length() != header.getInt("trackCount")) throw new IOException("离线歌单资料不完整");
        return new Snapshot(header, rows);
    }

    private static JSONArray readTracks(InputStream input) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        for (int length; (length = input.read(buffer)) != -1; ) {
            if (bytes.size() + length > MAX_SNAPSHOT_BYTES) throw new IOException("离线歌单资料过大");
            bytes.write(buffer, 0, length);
        }
        return new JSONArray(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
    }

    private static InputStream open(File snapshot) throws IOException {
        if (!snapshot.isFile() || snapshot.length() <= 0 || snapshot.length() > MAX_SNAPSHOT_BYTES) throw new IOException("离线歌单资料不可用");
        return new BufferedInputStream(new FileInputStream(snapshot));
    }

    private static File root(Context context) { return new File(context.getFilesDir(), DIRECTORY); }

    private static File file(File root, String key) throws IOException { return new File(root, checkedKey(key) + ".snapshot"); }

    private static boolean validKey(String key) { return key != null && key.matches("[a-f0-9]{64}"); }

    private static String checkedKey(String key) throws IOException {
        if (!validKey(key)) throw new IOException("离线歌单标识无效");
        return key;
    }

    private static File[] snapshotFiles(File directory) {
        File[] files = directory.listFiles(file -> file.getName().endsWith(".snapshot") && file.getName().length() == 73
                && validKey(file.getName().substring(0, 64)) && file.isFile());
        return files == null ? new File[0] : files;
    }

    private static long bytes(File[] snapshots) {
        long size = 0;
        for (File snapshot : snapshots) size += snapshot.length();
        return size;
    }

    private static String text(String input, int limit) {
        String clean = input.replace('\r', ' ').replace('\n', ' ').trim();
        return clean.substring(0, Math.min(clean.length(), limit));
    }
}
