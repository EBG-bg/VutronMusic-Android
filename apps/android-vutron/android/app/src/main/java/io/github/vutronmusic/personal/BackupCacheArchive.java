package io.github.vutronmusic.personal;

import android.content.Context;
import android.graphics.BitmapFactory;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/** Portable ZIP around a v1 JSON backup and a deliberately selected set of offline cache files. */
final class BackupCacheArchive {
    private static final long MIB = 1024L * 1024L;
    private static final long MAX_ARCHIVE_BYTES = 12L * 1024 * MIB;
    private static final int MAX_ITEMS = 25_000;
    private static final String MANIFEST = "backup.json";
    private static final String ID = "[1-9][0-9]{0,18}";
    private static final String AUDIO = "audio/" + ID + "\\.audio";
    private static final String PLAYLIST = "playlists/(?:(?:user|recommendations)-" + ID + "|playlist-" + ID + "-" + ID + ")\\.json";
    private static final long MAX_PLAYLIST_BYTES = 8 * MIB;
    private static final String PLUGIN_PLAYLIST = "plugin-playlists/[a-f0-9]{64}\\.snapshot";

    private BackupCacheArchive() { }

    record Audio(long id, JSONObject song, String source, File file, String checksum, AudioCache.AudioInfo info) { }
    record Count(int restored, int skipped) { }
    private record CachedFile(String name, File file) { }
    private record Copied(long bytes, String checksum) { }

    static int write(Context context, JSONObject backup, OutputStream destination) throws Exception {
        List<AudioCache.Entry> audio = AudioCache.backupEntries(context);
        JSONArray descriptors = new JSONArray();
        for (AudioCache.Entry entry : audio) descriptors.put(new JSONObject().put("id", entry.songId).put("bytes", entry.bytes)
                .put("sha256", AudioCache.backupChecksum(entry)).put("song", portableAudio(entry.song)));
        backup.put("audioEntries", descriptors);
        List<File> pluginPlaylists = PluginPlaylistCache.backupFiles(context);
        backup.put("cacheArchive", pluginPlaylists.isEmpty() ? 1 : 2);
        File files = context.getFilesDir();
        List<CachedFile> others = new ArrayList<>();
        addFiles(others, files, "artwork-cache-v1", "artwork/");
        addFiles(others, files, "lyric-cache", "lyrics/");
        addFiles(others, files, "plugin-lyrics-v1", "plugin-lyrics/");
        long owner = PlaylistCache.cachedOwnerId(context);
        if (owner > 0) {
            backup.put("playlistOwner", owner);
            addFiles(others, files, "playlist-cache-v1", "playlists/");
            others.removeIf(entry -> entry.name.startsWith("playlists/") && playlistOwner(entry.name) != owner);
        }
        for (File file : pluginPlaylists) others.add(new CachedFile("plugin-playlists/" + file.getName(), file));
        int count = others.size() + audio.size();
        if (count > MAX_ITEMS) throw new IOException("缓存条目超过备份上限");
        long bytes = 0;
        for (AudioCache.Entry entry : audio) bytes += entry.bytes;
        for (CachedFile entry : others) bytes += entry.file.length();
        if (bytes > MAX_ARCHIVE_BYTES) throw new IOException("缓存备份超过 12 GiB");
        backup.put("cacheItemCount", count);
        LibraryTaskRunner.progress(0, count);
        int done = 0;
        try (ZipOutputStream zip = new ZipOutputStream(new BufferedOutputStream(destination))) {
            // Audio and image bytes are already compressed; skip further compression.
            zip.setLevel(0);
            writeEntry(zip, MANIFEST, LibraryBackup.exportBytes(backup));
            for (AudioCache.Entry entry : audio) {
                zip.putNextEntry(new ZipEntry("audio/" + entry.songId + ".audio"));
                try (InputStream input = new FileInputStream(entry.file)) {
                    Copied copied = copy(input, zip, 512 * MIB, true);
                    if (copied.bytes != entry.bytes || !copied.checksum.equals(AudioCache.backupChecksum(entry)))
                        throw new IOException("音频缓存有变化或损坏，请重试备份");
                }
                zip.closeEntry(); LibraryTaskRunner.progress(++done, count);
            }
            for (CachedFile cached : others) {
                if (cached.name.startsWith("artwork/")) {
                    zip.putNextEntry(new ZipEntry(cached.name));
                    try (InputStream input = new FileInputStream(cached.file)) { copy(input, zip, limit(cached.name), false); }
                    zip.closeEntry();
                } else if (cached.name.matches(PLUGIN_PLAYLIST)) {
                    writeEntry(zip, cached.name, PluginPlaylistCache.portableBackup(cached.file, pluginPlaylistKey(cached.name)));
                } else {
                    writeExportJson(zip, cached.name, cached.file);
                }
                LibraryTaskRunner.progress(++done, count);
            }
        }
        return count;
    }

    private static void addFiles(List<CachedFile> values, File root, String directory, String prefix) {
        File[] files = new File(root, directory).listFiles();
        if (files == null) return;
        for (File file : files) {
            String name = prefix + file.getName();
            if (limit(name) > 0 && Files.isRegularFile(file.toPath(), LinkOption.NOFOLLOW_LINKS)) values.add(new CachedFile(name, file));
        }
    }

    static boolean isZip(BufferedInputStream source) throws IOException {
        source.mark(4);
        try { return source.read() == 'P' && source.read() == 'K' && source.read() == 3 && source.read() == 4; }
        finally { source.reset(); }
    }

    /** Read only the first (small, bounded) ZIP entry so the user can choose what to restore. */
    static JSONObject inspectManifest(InputStream source) throws Exception {
        try (ZipInputStream zip = new ZipInputStream(source)) {
            ZipEntry entry = zip.getNextEntry();
            if (entry == null || !MANIFEST.equals(entry.getName())) throw new IOException("请选择 Vutron Music 导出的缓存备份 ZIP");
            JSONObject backup = new JSONObject(new String(readEntry(zip, LibraryBackup.MAX_BYTES), StandardCharsets.UTF_8));
            int format = backup.optInt("cacheArchive");
            JSONArray audio = backup.optJSONArray("audioEntries");
            int items = backup.optInt("cacheItemCount", -1);
            if ((format != 1 && format != 2) || audio == null || items < audio.length() || items > MAX_ITEMS)
                throw new IOException("缓存备份清单无效");
            LibraryBackup.validate(backup);
            return backup;
        }
    }

    static final class Staged implements AutoCloseable {
        private final File work;
        final JSONObject backup;
        private final List<Audio> audio;
        private final List<CachedFile> others;
        private final long owner;

        private Staged(File work, JSONObject backup, List<Audio> audio, List<CachedFile> others, long owner) {
            this.work = work; this.backup = backup; this.audio = audio; this.others = others; this.owner = owner;
        }

        Count restore(Context context) throws Exception {
            int restored = AudioCache.restoreBackup(context, audio);
            boolean restoreOwner = PlaylistCache.cachedOwnerId(context) == 0;
            boolean playlistAdded = false;
            // Publish contents before the playlist index that makes them visible.
            others.sort(Comparator.comparingInt(entry -> entry.name.startsWith("playlists/user-") ? 1 : 0));
            for (CachedFile entry : others) {
                File f = entry.file;
                String name = entry.name;
                boolean added;
                if (name.startsWith("artwork/")) {
                    added = ArtworkCache.restoreArchiveEntry(context, name.substring("artwork/".length()), f);
                } else if (name.startsWith("playlists/")) {
                    added = PlaylistCache.restoreArchiveSnapshot(context, owner, name.substring("playlists/".length()), f);
                    playlistAdded |= added;
                } else if (name.matches(PLUGIN_PLAYLIST)) {
                    added = PluginPlaylistCache.restoreBackup(context, f, pluginPlaylistKey(name));
                } else {
                    boolean plugin = name.startsWith("plugin-lyrics/");
                    added = moveNew(f, context.getFilesDir(), plugin ? "plugin-lyrics-v1" : "lyric-cache", name.substring(name.indexOf('/') + 1));
                }
                if (added) restored++;
            }
            if (restoreOwner && playlistAdded && owner > 0 && PlaylistCache.cachedOwnerId(context) == 0) PlaylistCache.rememberOwner(context, owner);
            return new Count(restored, audio.size() + others.size() - restored);
        }

        @Override public void close() { clearStage(work); }
    }

    static Staged stage(Context context, InputStream source) throws Exception { return stage(context.getFilesDir(), source); }

    static Staged stage(File root, InputStream source) throws Exception {
        File work = Files.createTempDirectory(root.toPath(), "backup-restore-").toFile();
        boolean success = false;
        try (ZipInputStream zip = new ZipInputStream(source)) {
            ZipEntry entry = zip.getNextEntry();
            if (entry == null || !MANIFEST.equals(entry.getName())) throw new IOException("请选择 Vutron Music 导出的缓存备份 ZIP");
            JSONObject backup = new JSONObject(new String(readEntry(zip, LibraryBackup.MAX_BYTES), StandardCharsets.UTF_8));
            int format = backup.optInt("cacheArchive");
            if (format != 1 && format != 2) throw new IOException("缓存备份 ZIP 格式不支持");
            LibraryBackup.validate(backup);
            long owner = backup.optLong("playlistOwner");
            int expected = backup.optInt("cacheItemCount", -1);
            if (expected < 0 || expected > MAX_ITEMS) throw new IOException("缓存备份条目数量无效");
            JSONArray metadata = backup.getJSONArray("audioEntries");
            if (metadata.length() > MAX_ITEMS) throw new IOException("缓存条目超过备份上限");
            Map<Long, JSONObject> descriptions = new HashMap<>();
            for (int i = 0; i < metadata.length(); i++) {
                JSONObject row = metadata.getJSONObject(i);
                long id = row.getLong("id"), bytes = row.getLong("bytes");
                if (id <= 0 || bytes < 1024 || bytes > 512 * MIB || !row.getString("sha256").matches("[a-f0-9]{64}")
                        || descriptions.put(id, row) != null) throw new IOException("音频缓存备份索引无效");
            }
            int total = 0;
            long remaining = Math.min(MAX_ARCHIVE_BYTES, Math.max(0, work.getUsableSpace() - 32 * MIB));
            Set<String> visited = new HashSet<>();
            List<Audio> audio = new ArrayList<>(); List<CachedFile> others = new ArrayList<>();
            LibraryTaskRunner.progress(0, expected);
            while ((entry = zip.getNextEntry()) != null) {
                String name = entry.getName(); long maximum = limit(name);
                if (++total > expected || entry.isDirectory() || maximum <= 0 || !visited.add(name)
                        || name.startsWith("playlists/") && (owner <= 0 || playlistOwner(name) != owner)
                        || format == 1 && name.matches(PLUGIN_PLAYLIST))
                    throw new IOException("缓存备份包含无效、重复或超量的条目");
                File stage = new File(work, total + ".tmp");
                boolean audioFile = name.startsWith("audio/");
                Copied copied;
                try (OutputStream output = new FileOutputStream(stage)) { copied = copy(zip, output, Math.min(remaining, maximum), audioFile); }
                remaining -= copied.bytes;
                if (audioFile) {
                    long id = Long.parseLong(name.substring(6, name.length() - 6));
                    JSONObject record = descriptions.remove(id);
                    if (record == null || copied.bytes != record.getLong("bytes") || !copied.checksum.equals(record.getString("sha256")))
                        throw new IOException("音频缓存备份校验失败");
                    JSONObject song = portableAudio(record.getJSONObject("song"));
                    if (song.optLong("id") != id) throw new IOException("音频缓存备份标识不匹配");
                    AudioCache.AudioInfo info = AudioCache.inspectBackup(stage, song);
                    audio.add(new Audio(id, song, "离线备份", stage, copied.checksum, info));
                } else if (name.startsWith("artwork/")) {
                    BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
                    BitmapFactory.decodeFile(stage.getAbsolutePath(), bounds);
                    if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || (long) bounds.outWidth * bounds.outHeight > 64_000_000)
                        throw new IOException("备份封面不是有效的图片");
                    others.add(new CachedFile(name, stage));
                } else if (name.matches(PLUGIN_PLAYLIST)) {
                    PluginPlaylistCache.sanitizeBackup(stage, pluginPlaylistKey(name));
                    others.add(new CachedFile(name, stage));
                } else {
                    JSONObject portable = portableJson(name, readJson(stage, maximum));
                    LibraryFiles.writeJson(stage, portable);
                    others.add(new CachedFile(name, stage));
                }
                if (total % 16 == 0) LibraryTaskRunner.progress(total, expected);
            }
            if (!descriptions.isEmpty() || total != expected) throw new IOException("缓存备份缺少文件");
            LibraryTaskRunner.progress(total, total);
            success = true;
            return new Staged(work, backup, audio, others, owner);
        } finally { if (!success) clearStage(work); }
    }

    /** Every extraction path is an app-owned temporary file, never a ZIP entry name. */
    static long limit(String name) {
        if (name.matches(AUDIO)) return 512 * MIB;
        if (name.matches("artwork/[a-f0-9]{64}\\.img")) return 4 * MIB;
        if (name.matches("lyrics/" + ID + "\\.json")) return MIB / 2;
        if (name.matches("plugin-lyrics/" + ID + "\\.json")) return MIB;
        if (name.matches(PLAYLIST)) return MAX_PLAYLIST_BYTES;
        if (name.matches(PLUGIN_PLAYLIST)) return 16 * MIB;
        return 0;
    }

    private static String pluginPlaylistKey(String name) { return name.substring("plugin-playlists/".length(), "plugin-playlists/".length() + 64); }

    private static long playlistOwner(String name) {
        String token = name.substring(name.indexOf('-') + 1).split("[-.]", 2)[0];
        try { return Long.parseLong(token); } catch (NumberFormatException invalid) { return 0; }
    }

    static void writeExportJson(ZipOutputStream zip, String name, File source) throws Exception {
        // Raw NetEase snapshots also keep provider metadata that is discarded in the archive.
        long sourceLimit = name.matches(PLAYLIST) ? PlaylistCache.archiveSourceLimit(source.getName()) : limit(name);
        byte[] portable = portableJson(name, readJson(source, sourceLimit)).toString().getBytes(StandardCharsets.UTF_8);
        writeEntry(zip, name, portable);
    }

    private static void writeEntry(ZipOutputStream zip, String name, byte[] bytes) throws IOException {
        if (!MANIFEST.equals(name) && bytes.length > limit(name)) throw new IOException("缓存备份资料超过大小上限");
        zip.putNextEntry(new ZipEntry(name)); zip.write(bytes); zip.closeEntry();
    }

    private static Copied copy(InputStream input, OutputStream output, long max, boolean hash) throws Exception {
        byte[] buffer = new byte[64 * 1024]; int count;
        long bytes = 0; MessageDigest digest = hash ? MessageDigest.getInstance("SHA-256") : null;
        while ((count = input.read(buffer)) != -1) {
            LibraryTaskRunner.checkCancelled();
            if ((bytes += count) > max) throw new IOException("缓存文件超过大小上限或存储空间不足");
            if (digest != null) digest.update(buffer, 0, count);
            output.write(buffer, 0, count);
        }
        if (bytes == 0) throw new IOException("缓存备份包含空文件");
        StringBuilder checksum = new StringBuilder();
        if (digest != null) for (byte value : digest.digest()) checksum.append(String.format(Locale.ROOT, "%02x", value & 255));
        return new Copied(bytes, checksum.toString());
    }

    private static byte[] readEntry(InputStream entry, long max) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        copy(entry, bytes, max, false);
        return bytes.toByteArray();
    }

    private static JSONObject readJson(File file, long max) throws Exception {
        try (FileInputStream input = new FileInputStream(file)) {
            long size = input.getChannel().size();
            if (size <= 0 || size > max) throw new IOException("缓存备份 JSON 文件大小无效");
            // Use the open file's validated size so large snapshots need only one raw buffer.
            byte[] bytes = new byte[(int) size];
            int offset = 0;
            while (offset < bytes.length) {
                LibraryTaskRunner.checkCancelled();
                int count = input.read(bytes, offset, Math.min(64 * 1024, bytes.length - offset));
                if (count < 0) throw new IOException("缓存资料已变化，请重试备份");
                offset += count;
            }
            if (input.read() != -1) throw new IOException("缓存资料已变化，请重试备份");
            return new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        }
    }

    static boolean moveNew(File source, File root, String directory, String name) throws IOException {
        File targetRoot = new File(root, directory);
        Files.createDirectories(targetRoot.toPath());
        File destination = new File(targetRoot, name);
        if (destination.exists() || new File(targetRoot, name + ".bak").exists()) return false;
        try { Files.move(source.toPath(), destination.toPath()); return true; }
        catch (java.nio.file.FileAlreadyExistsException race) { return false; }
    }

    private static void clearStage(File work) {
        File[] files = work.listFiles();
        if (files != null) for (File file : files) file.delete();
        work.delete();
    }

    /** Never archive an input URL from a plugin, which can contain access tokens or a private host. */
    private static String publicCover(String value) {
        try {
            URI uri = new URI(value);
            String host = uri.getHost();
            if (host == null || uri.getUserInfo() != null || value.length() > 2048 || uri.getPort() != -1
                    || !("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme()))
                    || !(host.equalsIgnoreCase("music.126.net") || host.toLowerCase(Locale.ROOT).endsWith(".music.126.net"))) return "";
            // NetEase's public image key lives in the path. Signed and unknown query parameters are excluded.
            String path = uri.getRawPath();
            if (path == null || !path.matches("/[a-zA-Z0-9/_+=.-]+")) return "";
            String result = uri.getScheme() + "://" + host + path;
            String query = uri.getRawQuery();
            return query != null && query.matches("param=(?:96|192|320|512)y(?:96|192|320|512)") ? result + "?" + query : result;
        } catch (Exception invalid) { return ""; }
    }

    private static JSONObject portableAudio(JSONObject value) throws Exception {
        JSONObject result = portableTrack(value);
        String plugin = value.optString("pluginId"), scope = value.optString("pluginAccountScope");
        if (plugin.matches("[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}(?::[a-zA-Z0-9_-]{1,48})?")) {
            result.put("pluginId", plugin);
            if (scope.matches("[a-f0-9]{64}")) result.put("pluginAccountScope", scope);
            String fingerprint = PluginPlaylistCache.audioFingerprint(value);
            if (!fingerprint.isEmpty()) result.put("trackFingerprint", fingerprint);
        }
        String gain = value.optString("trackVolumeKey");
        if (gain.matches("(?:track:id|plugin):[1-9][0-9]{0,18}|track:local:[a-f0-9]{64}")) result.put("trackVolumeKey", gain);
        return result;
    }

    private static JSONObject portableTrack(JSONObject raw) throws Exception {
        long id = raw.optLong("id");
        if (id <= 0 || id > 9_007_199_254_740_991L) throw new IOException("备份曲目标识无效");
        JSONObject result = new JSONObject().put("id", id).put("name", text(raw.optString("name"), 500));
        JSONArray artists = raw.optJSONArray("ar"); if (artists == null) artists = raw.optJSONArray("artists");
        JSONArray names = new JSONArray();
        for (int i = 0; artists != null && i < Math.min(40, artists.length()); i++) {
            JSONObject artist = artists.optJSONObject(i);
            names.put(text(artist == null ? artists.optString(i) : artist.optString("name"), 200));
        }
        if (names.length() == 0 && raw.opt("artist") instanceof String) names.put(text(raw.getString("artist"), 200));
        JSONObject album = raw.optJSONObject("al"); if (album == null) album = raw.optJSONObject("album");
        result.put("artists", names).put("album", text(album == null ? raw.optString("album", "") : album.optString("name"), 500));
        result.put("duration", Math.max(0, Math.min(86_400_000L, raw.optLong("dt", raw.optLong("duration")))));
        String cover = publicCover(ArtworkSource.coverUrl(raw)); if (!cover.isEmpty()) result.put("picUrl", cover);
        for (String key : new String[]{"cueTrackNo", "cueOffsetMs", "cueDurationMs", "neteaseId"})
            if (raw.opt(key) instanceof Number && raw.optLong(key) >= 0) result.put(key, raw.optLong(key));
        return result;
    }

    private static JSONArray playlistRows(JSONArray values) throws Exception {
        JSONArray result = new JSONArray();
        if (values == null) return result;
        if (values.length() > 10_000) throw new IOException("备份歌单过多");
        for (int i = 0; i < values.length(); i++) {
            JSONObject source = values.getJSONObject(i);
            long id = source.optLong("id"); if (id <= 0) throw new IOException("备份歌单标识无效");
            JSONObject row = new JSONObject().put("id", id).put("name", text(source.optString("name"), 500))
                    .put("coverImgUrl", publicCover(source.optString("coverImgUrl", source.optString("picUrl"))))
                    .put("trackCount", Math.max(0, source.optInt("trackCount")))
                    .put("description", text(source.optString("description"), 4096)).put("subscribed", source.optBoolean("subscribed"));
            JSONObject creator = source.optJSONObject("creator");
            row.put("creatorUserId", Math.max(0, source.optLong("creatorUserId", creator == null ? 0 : creator.optLong("userId"))));
            for (String key : new String[]{"privacy", "specialType", "createTime"}) if (source.opt(key) instanceof Number) row.put(key, source.optLong(key));
            JSONArray tags = source.optJSONArray("tags"), safeTags = new JSONArray();
            for (int j = 0; tags != null && j < Math.min(tags.length(), 30); j++) safeTags.put(text(tags.optString(j), 120));
            row.put("tags", safeTags); result.put(row);
        }
        return result;
    }

    static JSONObject portableJson(String name, JSONObject input) throws Exception {
        if (name.startsWith("playlists/")) {
            long owner = playlistOwner(name);
            if (owner <= 0 || input.optLong("userId") != owner) throw new IOException("歌单缓存备份账号不匹配");
            JSONObject result = new JSONObject().put("version", 1).put("userId", owner).put("updatedAt", input.optLong("updatedAt"));
            if (name.startsWith("playlists/playlist-")) {
                long id = Long.parseLong(name.substring(name.lastIndexOf('-') + 1, name.length() - 5));
                JSONArray songs = input.getJSONArray("tracks");
                if (id != input.optLong("playlistId") || songs.length() > 20_000) throw new IOException("备份歌单曲目无效");
                JSONArray rows = new JSONArray(); for (int i = 0; i < songs.length(); i++) rows.put(portableTrack(songs.getJSONObject(i)));
                return result.put("playlistId", id).put("tracks", rows);
            }
            result.put("playlists", playlistRows(input.optJSONArray("playlists")));
            if (name.startsWith("playlists/user-")) result.put("visitedPlaylists", playlistRows(input.optJSONArray("visitedPlaylists"))).put("tracks", new JSONObject());
            return result;
        }
        JSONObject result = new JSONObject();
        if (name.startsWith("lyrics/")) {
            long id = Long.parseLong(name.substring(7, name.length() - 5));
            if (input.has("_songId") && input.optLong("_songId") != id) throw new IOException("歌词缓存备份标识不匹配");
            result.put("_songId", id).put("_revision", input.optInt("_revision")).put("_checkedAt", input.optLong("_checkedAt"));
            if ("amll-ttml-db".equals(input.optString("_wordSource"))) result.put("_wordSource", "amll-ttml-db");
            for (String key : new String[]{"lrc", "tlyric", "yrc", "ytlrc"}) if (input.opt(key) instanceof String) result.put(key, input.getString(key));
            return result;
        }
        JSONArray lines = input.getJSONArray("lines"), safeLines = new JSONArray();
        for (int i = 0; i < lines.length(); i++) {
            JSONObject source = lines.getJSONObject(i), line = new JSONObject();
            for (String key : new String[]{"start", "end"}) if (source.opt(key) instanceof Number) line.put(key, source.get(key));
            for (String key : new String[]{"lyric", "tlyric"}) {
                JSONObject text = source.optJSONObject(key); if (text == null) continue;
                JSONObject item = new JSONObject().put("text", text.optString("text"));
                JSONArray words = text.optJSONArray("info"), info = new JSONArray();
                for (int j = 0; words != null && j < words.length(); j++) {
                    JSONObject word = words.getJSONObject(j);
                    info.put(new JSONObject().put("word", word.optString("word")).put("start", word.optLong("start")).put("end", word.optLong("end")));
                }
                if (words != null) item.put("info", info);
                line.put(key, item);
            }
            safeLines.put(line);
        }
        return result.put("lines", safeLines);
    }

    private static String text(String value, int max) { return value.substring(0, Math.min(max, value.length())); }
}
