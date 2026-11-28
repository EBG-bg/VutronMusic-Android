package io.github.vutronmusic.personal;

import android.content.Context;
import android.graphics.BitmapFactory;
import android.content.SharedPreferences;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Small, durable artwork cache used by playlists, tracks and the player metadata. */
final class ArtworkCache {
    private static final String TAG = "VutronArtworkCache";
    private static final String DIRECTORY = "artwork-cache-v1";
    private static final int MAX_BYTES = 4 * 1024 * 1024;
    private static final int MAX_FILES = 4096;
    private static final String PREFS = "artwork_cache_settings";
    private static final String AUTO_CACHE = "auto_cache";
    private static final String FULL_AT = "full_at_capacity_mib";
    private static final String FULL_BYTES = "full_at_usage_bytes";
    private static final long MIB = 1024L * 1024L;
    private static final long DEFAULT_CAPACITY_MB = 128;
    private static final Map<String, List<Result>> PENDING = new HashMap<>();
    private static final Map<String, ArtworkTasks.Task> TASKS = new HashMap<>();
    private static final Object PENDING_LOCK = new Object();
    private static final Object CACHE_LOCK = new Object();
    private static final java.util.Set<String> MANUAL = new java.util.HashSet<>();
    private static final java.util.Set<HttpURLConnection> CONNECTIONS = new java.util.HashSet<>();
    private static final ArtworkTasks WORKER = ArtworkTasks.create();
    private static final java.util.concurrent.atomic.AtomicLong CACHE_REVISION = new java.util.concurrent.atomic.AtomicLong();
    private static File measuredRoot;
    private static Usage usage;

    private record Usage(long bytes, int count) { }
    private static final class NotAdmitted extends IOException { }

    private ArtworkCache() { }

    static void cancelNetworkDownloads() {
        List<HttpURLConnection> active;
        synchronized (PENDING_LOCK) { active = new ArrayList<>(CONNECTIONS); }
        for (HttpURLConnection connection : active) connection.disconnect();
    }

    interface Result {
        void success(String uri);
        void failure(Exception error);
    }

    interface OwnedLoader { byte[] load() throws Exception; }

    static String resolveOwned(Context context, String key) {
        return resolveOwnedFingerprint(context, ownedFingerprint(key));
    }

    static String ownedFingerprint(String key) { return sha256(key); }

    static String resolveOwnedFingerprint(Context context, String fingerprint) {
        if (!fingerprint.matches("[a-f0-9]{64}")) return "";
        File file = new File(root(context), fingerprint + ".img");
        return file.isFile() && file.length() > 0 ? "file://" + file.getAbsolutePath() : "";
    }

    /** Plugin images use the same capacity, file accounting and priority lanes. */
    static void fetchOwned(Context context, String key, OwnedLoader loader, Result result) {
        fetchOwned(context, key, loader, result, "", false);
    }

    static void fetchOwnedManual(Context context, String key, OwnedLoader loader) {
        if (!hasRoomForManual(context)) return;
        fetchOwned(context, key, loader, null, "", true);
    }

    /** A null derived image keeps the original (animated, unsupported or already small) cache URI. */
    static void fetchDerived(Context context, String key, String originalUri, OwnedLoader loader, Result result) {
        fetchOwned(context, key, loader, result, originalUri, false);
    }

    private static void fetchOwned(Context context, String key, OwnedLoader loader, Result result, String originalUri, boolean manualRequest) {
        String cached = resolveOwned(context, key);
        if (!cached.isEmpty()) { if (result != null) result.success(cached); return; }
        final long revision = CACHE_REVISION.get();
        synchronized (PENDING_LOCK) {
            if (manualRequest) MANUAL.add(key);
            List<Result> listeners = PENDING.get(key);
            if (listeners != null) {
                if (result != null) listeners.add(result);
                ArtworkTasks.Task task = TASKS.get(key);
                if (task != null && result != null) task.promote();
                return;
            }
            listeners = new ArrayList<>();
            if (result != null) listeners.add(result);
            PENDING.put(key, listeners);
            TASKS.put(key, WORKER.submit(() -> {
                String uri = null; Exception failure = null;
                try {
                    if (revision != CACHE_REVISION.get()) throw new IOException("Artwork cache was cleared");
                    if (manualRequest && !hasRoomForManual(context)) {
                        synchronized (PENDING_LOCK) {
                            if (PENDING.get(key).isEmpty()) throw new NotAdmitted();
                        }
                    }
                    // Derived covers are optional. Plugin images may still need a
                    // native request (authenticated URLs) for on-screen display.
                    byte[] bytes = !originalUri.isEmpty() && !canAutomaticallyCache(context) ? null : loader.load();
                    if (bytes == null && !originalUri.isEmpty()) {
                        if (revision != CACHE_REVISION.get()) throw new IOException("Artwork cache was cleared");
                        uri = originalUri;
                    } else {
                        if (bytes == null || bytes.length == 0 || bytes.length > MAX_BYTES) throw new IOException("Artwork exceeds its size limit or is empty");
                        BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
                        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
                        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IOException("Artwork is not a decodable image");
                        File file = fileFor(context, key);
                        try {
                            checkAdmission(context, revision, manual(key), bytes.length);
                            File directory = file.getParentFile();
                            if (!directory.isDirectory() && !directory.mkdirs() && !directory.isDirectory()) throw new IOException("Artwork directory unavailable");
                            File partial = new File(file.getAbsolutePath() + ".part");
                            try {
                                try (FileOutputStream output = new FileOutputStream(partial)) { output.write(bytes); }
                                commit(context, revision, manual(key), partial, file); uri = "file://" + file.getAbsolutePath();
                            } finally { if (partial.isFile()) partial.delete(); }
                        } catch (NotAdmitted full) {
                            uri = originalUri.isEmpty() ? inlineArtwork(bytes, bounds.outMimeType) : originalUri;
                        }
                    }
                } catch (Exception error) { failure = error; }
                List<Result> completed;
                synchronized (PENDING_LOCK) { completed = PENDING.remove(key); TASKS.remove(key); MANUAL.remove(key); PENDING_LOCK.notifyAll(); }
                for (Result listener : completed) { if (failure == null) listener.success(uri); else listener.failure(failure); }
            }, result != null));
        }
    }

    static void enqueue(Context context, String remoteUrl) {
        request(context, remoteUrl, null, 512, false);
    }

    static void enqueueManual(Context context, String remoteUrl) {
        request(context, remoteUrl, null, 512, true);
    }

    /** Resolve on the artwork pool, sharing any in-flight prefetch for this URL. */
    static void fetch(Context context, String remoteUrl, Result result) {
        request(context, remoteUrl, result, 512, false);
    }

    /** Small views reuse old full covers offline and never overwrite the full-size cache. */
    static void fetch(Context context, String remoteUrl, int size, Result result) {
        final int requested = ArtworkSource.requestSize(size);
        if (requested == 512) { fetch(context, remoteUrl, result); return; }
        String sizedUrl = ArtworkSource.requestUrl(remoteUrl, requested);
        if (sizedUrl.isEmpty()) { result.failure(new IOException("Artwork URL must use HTTP or HTTPS")); return; }
        File thumbnail = cachedThumbnail(root(context), remoteUrl, requested);
        if (thumbnail != null) { result.success("file://" + thumbnail.getAbsolutePath()); return; }
        File cached = cachedFile(context, sizedUrl, sizedUrl);
        if (cached == null) cached = cachedFile(context, remoteUrl, normalized(remoteUrl));
        if (cached == null && (LocalOnlyMode.enabled(context) || !canAutomaticallyCache(context))) cached = offlineVariant(root(context), remoteUrl);
        final String alias = thumbnailKey(remoteUrl, requested);
        if (cached != null) { ArtworkThumbnail.request(context, "file://" + cached.getAbsolutePath(), requested, alias, result); return; }
        request(context, sizedUrl, new Result() {
            @Override public void success(String uri) {
                if (uri.startsWith("file://")) ArtworkThumbnail.request(context, uri, requested, alias, result);
                else result.success(uri);
            }
            @Override public void failure(Exception error) { result.failure(error); }
        }, requested, false);
    }

    private static void request(Context context, String remoteUrl, Result result, int size, boolean manual) {
        String url = ArtworkSource.requestUrl(remoteUrl, size);
        if (url.isEmpty()) {
            if (result != null) result.failure(new IOException("Artwork URL must use HTTP or HTTPS"));
            return;
        }
        // Earlier snapshots used the original URL as their cache key. Reuse
        // those images when the HTTPS/512px normalization changes that key.
        File cached = cachedFile(context, remoteUrl, url);
        if (cached == null && LocalOnlyMode.enabled(context)) cached = offlineVariant(root(context), remoteUrl);
        if (cached != null) {
            if (result != null) result.success("file://" + cached.getAbsolutePath());
            return;
        }
        if (LocalOnlyMode.enabled(context)) {
            if (result != null) result.failure(new IOException("本地模式下没有该封面缓存"));
            return;
        }
        if (!(manual ? hasRoomForManual(context) : canAutomaticallyCache(context))) {
            if (result != null) result.success(resolvedUri(offlineVariant(root(context), remoteUrl), url, false));
            return;
        }
        synchronized (PENDING_LOCK) {
            if (manual) MANUAL.add(url);
            List<Result> listeners = PENDING.get(url);
            if (listeners != null) {
                if (result != null) listeners.add(result);
                if (result != null || manual) {
                    ArtworkTasks.Task task = TASKS.get(url);
                    if (task != null) task.promote();
                }
                return;
            }
            listeners = new ArrayList<>();
            if (result != null) listeners.add(result);
            PENDING.put(url, listeners);
            final long revision = CACHE_REVISION.get();
            TASKS.put(url, WORKER.submit(() -> {
            String uri = null;
            Exception failure = null;
            try { uri = download(context.getApplicationContext(), url, revision); }
            catch (NotAdmitted full) {
                // No background request when the working set is full; a visible
                // public image can still render directly without an offline copy.
                uri = resolvedUri(offlineVariant(root(context), remoteUrl), url, LocalOnlyMode.enabled(context));
            }
            catch (Exception error) { failure = error; }
            List<Result> completedListeners;
            synchronized (PENDING_LOCK) {
                completedListeners = PENDING.remove(url);
                TASKS.remove(url);
                MANUAL.remove(url);
                PENDING_LOCK.notifyAll();
            }
            if (failure != null) Log.d(TAG, "Artwork cache request failed: " + failure.getMessage());
            for (Result listener : completedListeners) {
                if (failure == null) listener.success(uri);
                else listener.failure(failure);
            }
            }, result != null || manual));
        }
    }

    /** Wait for queued cover downloads during an explicit bulk-cache action. */
    static int awaitPending(long timeoutMs) throws InterruptedException {
        long deadline = System.currentTimeMillis() + Math.max(0, timeoutMs);
        synchronized (PENDING_LOCK) {
            while (!PENDING.isEmpty()) {
                long remaining = deadline - System.currentTimeMillis();
                if (remaining <= 0) break;
                PENDING_LOCK.wait(remaining);
            }
        }
        synchronized (PENDING_LOCK) { return PENDING.size(); }
    }

    static String resolve(Context context, String remoteUrl) {
        String url = normalized(remoteUrl);
        if (url.isEmpty()) return "";
        File file = cachedFile(context, remoteUrl, url);
        boolean localOnly = LocalOnlyMode.enabled(context);
        if (file == null && localOnly) file = offlineVariant(root(context), remoteUrl);
        // Return the same HTTPS/512px URL used by the native downloader when
        // the first request has not finished yet.  The old raw HTTP CDN URL
        // frequently redirects to a URL that WebView cannot display, which
        // left every first-render playlist card with a broken-image icon.
        return resolvedUri(file, url, localOnly);
    }

    static String resolvedUri(File cached, String remoteUrl, boolean localOnly) {
        return cached != null ? "file://" + cached.getAbsolutePath() : localOnly ? "" : remoteUrl;
    }

    static long bytes(Context context) {
        synchronized (CACHE_LOCK) { return usage(context).bytes; }
    }

    static long capacityMiB(Context context) {
        return preferences(context).getLong("capacity_mib", DEFAULT_CAPACITY_MB);
    }

    static boolean automatic(Context context) { return preferences(context).getBoolean(AUTO_CACHE, true); }

    static void trimRestoredCapacity(Context context, long value) {
        if (value < 32 || value > 1024) throw new IllegalArgumentException("Artwork cache capacity must be between 32 and 1024 MiB");
        synchronized (CACHE_LOCK) {
            trim(root(context), value * MIB);
            refreshUsage(context);
        }
    }

    static void setAutomatic(Context context, boolean enabled) {
        synchronized (CACHE_LOCK) { preferences(context).edit().putBoolean(AUTO_CACHE, enabled).apply(); }
    }

    static boolean canAutomaticallyCache(Context context) { return automatic(context) && hasRoom(context); }

    static boolean hasRoom(Context context) {
        synchronized (CACHE_LOCK) {
            long capacity = capacityMiB(context);
            Usage size = usage(context);
            return !fullFlag(preferences(context), size, capacity) && fits(size.bytes, size.count, capacity * MIB, 1);
        }
    }

    static boolean hasRoomForManual(Context context) {
        synchronized (CACHE_LOCK) {
            Usage current = usage(context);
            return fits(current.bytes, current.count, capacityMiB(context) * MIB, 1);
        }
    }

    private static boolean fullFlag(SharedPreferences prefs, Usage usage, long capacity) {
        return prefs.getLong(FULL_AT, -1) == capacity && usage.bytes >= prefs.getLong(FULL_BYTES, Long.MAX_VALUE);
    }

    static boolean fits(long used, int count, long capacity, long incoming) {
        return count < MAX_FILES && incoming >= 0 && used <= capacity && incoming <= capacity - used;
    }

    /** Restoring from a user-selected archive uses the same admission and accounting as downloads. */
    static boolean restoreArchiveEntry(Context context, String name, File staged) throws IOException {
        synchronized (CACHE_LOCK) {
            Usage current = usage(context);
            long size = staged.length();
            if (!fits(current.bytes, current.count, capacityMiB(context) * MIB, size)) return false;
            if (!BackupCacheArchive.moveNew(staged, context.getFilesDir(), DIRECTORY, name)) return false;
            usage = new Usage(current.bytes + size, current.count + 1);
            return true;
        }
    }

    /** Called after restoring externally prepared cached files. A normal write updates the inventory directly. */
    static void refreshUsage(Context context) {
        synchronized (CACHE_LOCK) {
            measuredRoot = null; usage = null;
            preferences(context).edit().remove(FULL_AT).remove(FULL_BYTES).apply();
        }
    }

    private static Usage usage(Context context) {
        File directory = root(context);
        if (usage != null && directory.equals(measuredRoot)) return usage;
        File[] files = directory.listFiles(file -> file.isFile() && file.length() > 0 && file.getName().endsWith(".img"));
        long bytes = 0;
        if (files != null) for (File file : files) bytes += Math.max(0, file.length());
        measuredRoot = directory; usage = new Usage(bytes, files == null ? 0 : files.length);
        return usage;
    }

    private static boolean manual(String key) { synchronized (PENDING_LOCK) { return MANUAL.contains(key); } }

    private static void checkAdmission(Context context, long revision, boolean manual, long size) throws IOException {
        synchronized (CACHE_LOCK) { requireSpace(context, revision, manual, size); }
    }

    private static void requireSpace(Context context, long revision, boolean manual, long size) throws IOException {
        if (revision != CACHE_REVISION.get()) throw new IOException("Artwork cache was cleared");
        long capacity = capacityMiB(context);
        SharedPreferences prefs = preferences(context);
        Usage current = usage(context);
        if (!manual && (!prefs.getBoolean(AUTO_CACHE, true) || fullFlag(prefs, current, capacity))) throw new NotAdmitted();
        if (!fits(current.bytes, current.count, capacity * MIB, size)) {
            if (!fullFlag(prefs, current, capacity)) prefs.edit().putLong(FULL_AT, capacity).putLong(FULL_BYTES, current.bytes).apply();
            throw new NotAdmitted();
        }
    }

    private static void commit(Context context, long revision, boolean manual, File partial, File target) throws IOException {
        synchronized (CACHE_LOCK) {
            if (revision != CACHE_REVISION.get()) throw new IOException("Artwork cache was cleared");
            if (target.isFile() && target.length() > 0) return;
            long size = partial.length();
            requireSpace(context, revision, manual, size);
            if (!partial.renameTo(target)) throw new IOException("Artwork commit failed");
            Usage current = usage(context);
            usage = new Usage(current.bytes + size, current.count + 1);
        }
    }

    private static String inlineArtwork(byte[] bytes, String type) throws IOException {
        if (type == null || !type.matches("image/[a-zA-Z0-9.+-]+")) throw new IOException("Unsupported artwork type");
        return "data:" + type + ";base64," + android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);
    }

    static byte[] inlineArtworkData(String value) throws IOException {
        int delimiter = value.indexOf(";base64,");
        if (!value.startsWith("data:image/") || delimiter < 11 || delimiter > 64 || value.length() > (MAX_BYTES / 3 + 1) * 4 + 72)
            throw new IOException("Invalid inline artwork");
        return android.util.Base64.decode(value.substring(delimiter + 8), android.util.Base64.DEFAULT);
    }

    static void setCapacityMiB(Context context, long value) throws IOException {
        if (value < 32 || value > 1024) throw new IllegalArgumentException("Artwork cache capacity must be between 32 and 1024 MiB");
        synchronized (CACHE_LOCK) {
            long previous = capacityMiB(context);
            if (previous == value) return;
            if (value < previous) trim(root(context), value * MIB);
            preferences(context).edit().putLong("capacity_mib", value).apply();
            refreshUsage(context);
        }
    }

    static void clear(Context context) {
        synchronized (CACHE_LOCK) {
            CACHE_REVISION.incrementAndGet();
            File[] files = root(context).listFiles();
            if (files != null) for (File file : files) if (file.isFile()) file.delete();
            refreshUsage(context);
        }
    }

    private static String download(Context context, String urlText, long revision) throws IOException {
        File root = root(context);
        if (!root.isDirectory() && !root.mkdirs() && !root.isDirectory()) throw new IOException("Artwork directory unavailable");
        File target = fileFor(context, urlText);
        if (target.isFile() && target.length() > 0) return "file://" + target.getAbsolutePath();
        LocalOnlyMode.requireOnline(context);
        checkAdmission(context, revision, manual(urlText), 1);
        URL url = new URL(urlText);
        if (url.getUserInfo() != null) throw new IOException("Artwork URL must not contain credentials");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(15000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36");
        connection.setRequestProperty("Referer", "https://music.163.com/");
        File part = new File(target.getAbsolutePath() + ".part");
        MusicConnectivity.Request network = MusicConnectivity.capture(context);
        synchronized (PENDING_LOCK) { CONNECTIONS.add(connection); }
        try {
            LocalOnlyMode.requireOnline(context);
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IOException("Artwork HTTP " + status);
            if (connection.getContentLengthLong() > MAX_BYTES) throw new IOException("Artwork too large");
            if (connection.getContentLengthLong() > 0) checkAdmission(context, revision, manual(urlText), connection.getContentLengthLong());
            int contentLength = connection.getContentLength();
            if (contentLength > MAX_BYTES) throw new IOException("Artwork exceeds 4 MiB (" + contentLength + " bytes)");
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(part)) {
                byte[] buffer = new byte[8192];
                int count;
            int total = 0, checkedAt = 0;
                while ((count = input.read(buffer)) != -1) {
                    LocalOnlyMode.requireOnline(context);
                    total += count;
                    if (total > MAX_BYTES) throw new IOException("Artwork too large");
                    if (total - checkedAt >= 64 * 1024) {
                        checkAdmission(context, revision, manual(urlText), total);
                        checkedAt = total;
                    }
                    output.write(buffer, 0, count);
                }
            }
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(part.getAbsolutePath(), bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IOException("Artwork response is not a decodable image");
            commit(context, revision, manual(urlText), part, target);
            return "file://" + target.getAbsolutePath();
        } catch (IOException failure) {
            MusicConnectivity.reportUnreachable(context, failure, network);
            throw failure;
        } finally {
            connection.disconnect();
            synchronized (PENDING_LOCK) { CONNECTIONS.remove(connection); }
            if (part.isFile()) part.delete();
        }
    }

    private static void trim(File root, long maxBytes) {
        File[] files = root.listFiles(file -> file.isFile() && !file.getName().endsWith(".part"));
        if (files == null) return;
        java.util.Arrays.sort(files, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
        long total = 0;
        for (File file : files) total += Math.max(0, file.length());
        int count = files.length;
        for (File file : files) {
            if (total <= maxBytes && count <= MAX_FILES) break;
            long length = Math.max(0, file.length());
            if (file.delete()) { total -= length; count--; }
        }
    }

    private static File root(Context context) { return new File(context.getFilesDir(), DIRECTORY); }

    private static SharedPreferences preferences(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static File fileFor(Context context, String url) {
        return new File(root(context), sha256(url) + ".img");
    }

    private static File cachedFile(Context context, String source, String url) {
        File target = fileFor(context, url);
        if (target.isFile() && target.length() > 0) return target;
        String original = source == null ? "" : source.trim();
        if (!original.equals(url)) {
            File legacy = fileFor(context, original);
            if (legacy.isFile() && legacy.length() > 0) return legacy;
        }
        return null;
    }

    private static String normalized(String value) {
        return ArtworkSource.requestUrl(value);
    }

    static String thumbnailKey(String source, int size) {
        int requested = ArtworkSource.requestSize(size);
        String full = ArtworkSource.requestUrl(source, 512);
        return requested == 512 || full.isEmpty() || full.equals(ArtworkSource.requestUrl(source, 96)) ? ""
                : "netease-thumbnail:v1:" + ArtworkSource.requestUrl(source, requested);
    }

    static File cachedThumbnail(File directory, String source, int size) {
        String key = thumbnailKey(source, size);
        if (key.isEmpty()) return null;
        File file = new File(directory, sha256(key) + ".img");
        return file.isFile() && file.length() > 0 ? file : null;
    }

    /** Offline views may use an already-cached smaller CDN variant; online large views still upgrade. */
    static File offlineVariant(File directory, String source) {
        String full = ArtworkSource.requestUrl(source, 512);
        if (full.isEmpty() || full.equals(ArtworkSource.requestUrl(source, 96))) return null;
        for (int size : new int[]{512,320,192,96}) {
            File thumbnail = cachedThumbnail(directory, source, size);
            if (thumbnail != null) return thumbnail;
            File candidate = new File(directory, sha256(ArtworkSource.requestUrl(source, size)) + ".img");
            if (candidate.isFile() && candidate.length() > 0) return candidate;
        }
        return null;
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(digest.length * 2);
            for (byte item : digest) result.append(String.format(Locale.ROOT, "%02x", item & 0xff));
            return result.toString();
        } catch (Exception impossible) { throw new IllegalStateException(impossible); }
    }
}
