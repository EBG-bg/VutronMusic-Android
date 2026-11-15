package io.github.vutronmusic.personal;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.File;
import java.io.InterruptedIOException;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.Assert.*;

/** Real-file checks without starting Android workers or a media player. */
public class AudioCacheListingTest {
    private File root;
    private File previousDirectory;
    private Map<Long, AudioCache.Entry> entries;
    private Map<Long, AudioCache.Entry> previousEntries;
    private final byte[] audio = new byte[131072];

    @Before @SuppressWarnings("unchecked") public void setUp() throws Exception {
        root = Files.createTempDirectory("vutron-cache-list-").toFile();
        previousDirectory = (File) field("directory").get(null);
        entries = (Map<Long, AudioCache.Entry>) field("entries").get(null);
        previousEntries = new HashMap<>(entries);
        entries.clear();
        field("directory").set(null, root);
        for (int i = 0; i < audio.length; i++) audio[i] = (byte) (i % 251);
    }

    @After public void tearDown() throws Exception {
        entries.clear();
        entries.putAll(previousEntries);
        field("directory").set(null, previousDirectory);
        File[] files = root.listFiles();
        if (files != null) for (File file : files) Files.deleteIfExists(file.toPath());
        Files.deleteIfExists(root.toPath());
        Thread.interrupted();
    }

    @Test public void repeatedListingDoesNotReadAudioTouchLruOrWriteIndex() throws Exception {
        AudioCache.Entry first = add(1, 100, 7, new JSONObject().put("id", 1));
        AudioCache.Entry second = add(2, 200, 9, new JSONObject().put("id", 2));
        // A same-size content change remains a display row until selected for playback.
        byte[] changed = audio.clone(); changed[0] ^= 1;
        Files.write(second.file.toPath(), changed);
        for (int poll = 0; poll < 5; poll++) {
            List<JSONObject> songs = AudioCache.list(null);
            assertEquals(2, songs.size());
            assertEquals(2, songs.get(0).getLong("id"));
            assertEquals(second.file.getAbsolutePath(), songs.get(0).getString("localPath"));
            assertEquals("file://" + second.file.getAbsolutePath(), songs.get(0).getString("localUri"));
            assertTrue(songs.get(0).getBoolean("cached"));
            assertTrue(songs.get(0).getBoolean("offlineOnly"));
        }
        assertEquals(0, ((ReadTrackedFile) first.file).contentPathReads);
        assertEquals(0, ((ReadTrackedFile) second.file).contentPathReads);
        assertEquals(7, lastUsed(first));
        assertEquals(9, lastUsed(second));
        assertFalse(new File(root, "index.json").exists());
        assertFalse(first.song.has("localUri"));
        assertFalse(second.song.has("cached"));
    }

    @Test public void missingAndResizedFilesAreNotListedAndUnrelatedEntriesStayUntouched() throws Exception {
        AudioCache.Entry valid = add(1, 100, 7, new JSONObject().put("id", 1));
        AudioCache.Entry missing = add(2, 200, 9, new JSONObject().put("id", 2));
        AudioCache.Entry resized = add(3, 300, 11, new JSONObject().put("id", 3));
        Files.delete(missing.file.toPath());
        Files.write(resized.file.toPath(), new byte[1024]);
        List<JSONObject> songs = AudioCache.list(null);
        assertEquals(1, songs.size());
        assertEquals(1, songs.get(0).getLong("id"));
        assertEquals(3, entries.size());
        assertEquals(7, lastUsed(valid));
        assertEquals(0, ((ReadTrackedFile) valid.file).contentPathReads);
    }

    @Test public void playbackIntegrityReadsOnlySelectedFileAndRejectsSameSizeCorruption() throws Exception {
        AudioCache.Entry selected = add(1, 100, 7, new JSONObject().put("id", 1));
        AudioCache.Entry other = add(2, 200, 9, new JSONObject().put("id", 2));
        assertTrue(AudioCache.intact(selected));
        int pathReadsPerVerification = ((ReadTrackedFile) selected.file).contentPathReads;
        assertTrue(pathReadsPerVerification > 0);
        assertEquals(0, ((ReadTrackedFile) other.file).contentPathReads);
        byte[] changed = audio.clone(); changed[changed.length - 1] ^= 1;
        Files.write(selected.file.toPath(), changed);
        assertEquals(selected.bytes, selected.file.length());
        assertFalse(AudioCache.intact(selected));
        assertTrue(((ReadTrackedFile) selected.file).contentPathReads > pathReadsPerVerification);
        assertEquals(0, ((ReadTrackedFile) other.file).contentPathReads);
        Files.delete(selected.file.toPath());
        assertFalse(AudioCache.intact(selected));
    }

    @Test public void interruptedIntegrityStillCancelsWithoutReadingOtherFiles() throws Exception {
        AudioCache.Entry selected = add(1, 100, 7, new JSONObject().put("id", 1));
        Thread.currentThread().interrupt();
        try { assertThrows(InterruptedIOException.class, () -> AudioCache.intact(selected)); }
        finally { Thread.interrupted(); }
        assertEquals(7, lastUsed(selected));
        assertSame(selected, entries.get(1L));
    }

    @Test public void evictedCacheClearsOnlyDisplayLocationAndRetainsFallbackIdentity() throws Exception {
        JSONObject song = new JSONObject().put("id", 55).put("cached", true).put("source", "cache")
                .put("offlineOnly", true).put("localPath", "/retired.audio").put("localUri", "file:///retired.audio")
                .put("pluginId", "emby:home").put("pluginAccountScope", "account-a")
                .put("pluginTrackId", "opaque-song").put("pluginSourceContext", new JSONObject().put("server", "a"))
                .put("trackVolumeKey", "track:plugin:55").put("cueOffsetMs", 2000).put("cueDurationMs", 3000);
        assertNull(PlaybackRequest.selectedCache(null, song));
        assertFalse(song.has("localUri")); assertFalse(song.has("localPath"));
        assertFalse(song.has("cached")); assertFalse(song.has("source")); assertFalse(song.has("offlineOnly"));
        assertEquals("account-a", song.getString("pluginAccountScope"));
        assertEquals("opaque-song", song.getString("pluginTrackId"));
        assertEquals("a", song.getJSONObject("pluginSourceContext").getString("server"));
        assertEquals("track:plugin:55", song.getString("trackVolumeKey"));
        assertEquals(2000, song.getLong("cueOffsetMs"));
        Method localSource = PlaybackRequest.class.getDeclaredMethod("localSource", JSONObject.class);
        localSource.setAccessible(true);
        assertEquals("", localSource.invoke(null, song));
        JSONObject local = new JSONObject().put("id", 55).put("localUri", "content://authorized/recording");
        assertEquals("content://authorized/recording", localSource.invoke(null, local));
    }

    @Test public void cancelledCacheSelectionThrowsBeforeClearingLocationOrStartingFallback() throws Exception {
        AudioCache.Entry entry = add(55, 100, 7, new JSONObject().put("id", 55));
        JSONObject song = new JSONObject().put("id", 55).put("cached", true).put("source", "cache")
                .put("offlineOnly", true).put("localPath", entry.file.getAbsolutePath())
                .put("localUri", "file://" + entry.file.getAbsolutePath())
                .put("pluginId", "emby:home").put("pluginAccountScope", "account-a");
        String before = song.toString();
        boolean[] continued = {false};
        Thread.currentThread().interrupt();
        try {
            assertThrows(InterruptedIOException.class, () -> {
                PlaybackRequest.selectedCache(null, song);
                continued[0] = true;
            });
            assertTrue(Thread.currentThread().isInterrupted());
        } finally { Thread.interrupted(); }
        assertFalse(continued[0]);
        assertEquals(before, song.toString());
        assertSame(entry, entries.get(55L));
        assertEquals(7, lastUsed(entry));
        assertTrue(entry.file.isFile());
        assertTrue(((ReadTrackedFile) entry.file).contentPathReads > 0);
        assertFalse(new File(root, "index.json").exists());
    }

    @Test public void cacheQualityComesFromVerifiedEntryAndPluginIdentitySurvivesListing() throws Exception {
        JSONObject original = new JSONObject().put("id", 55).put("pluginId", "emby:home")
                .put("pluginAccountScope", "account-a").put("pluginTrackId", "opaque-song")
                .put("pluginSourceContext", new JSONObject().put("server", "a"))
                .put("trackVolumeKey", "track:plugin:55");
        AudioCache.Entry entry = add(55, 100, 7, original);
        JSONObject listed = AudioCache.list(null).get(0);
        listed.put("cacheBitrate", 1).put("cacheFormat", "stale").put("cacheLossless", false);
        PlaybackRequest.cachedPlayback(listed, entry);
        assertEquals("verified-provider", listed.getString("playbackSource"));
        assertEquals(900000, listed.getLong("playbackBitrate"));
        assertEquals("flac", listed.getString("playbackFormat"));
        assertTrue(listed.getBoolean("playbackLossless"));
        assertTrue(listed.getBoolean("playbackCached"));
        assertEquals("account-a", listed.getString("pluginAccountScope"));
        assertEquals(original.getJSONObject("pluginSourceContext").toString(), listed.getJSONObject("pluginSourceContext").toString());
        assertEquals("track:plugin:55", PlaybackVolume.trackKey(listed));
    }

    private AudioCache.Entry add(long id, long cachedAt, long lastUsed, JSONObject song) throws Exception {
        File actual = new File(root, "track-" + id + "-00000000000000000000000000000000.audio");
        Files.write(actual.toPath(), audio);
        Constructor<AudioCache.Entry> constructor = AudioCache.Entry.class.getDeclaredConstructor(long.class,
                File.class, JSONObject.class, String.class, long.class, String.class, long.class, long.class,
                boolean.class, long.class, long.class, String.class, int.class);
        constructor.setAccessible(true);
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(audio);
        StringBuilder hash = new StringBuilder();
        for (byte value : digest) hash.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        AudioCache.Entry entry = constructor.newInstance(id, new ReadTrackedFile(actual), song,
                "verified-provider", 900000L, "flac", (long) audio.length, 10000L, true,
                cachedAt, lastUsed, hash.toString(), AudioCache.QUALITY_POLICY);
        entries.put(id, entry);
        return entry;
    }

    private static Field field(String name) throws Exception {
        Field field = AudioCache.class.getDeclaredField(name); field.setAccessible(true); return field;
    }
    private static long lastUsed(AudioCache.Entry entry) throws Exception {
        Field field = AudioCache.Entry.class.getDeclaredField("lastUsed"); field.setAccessible(true); return field.getLong(entry);
    }

    /** FileInputStream calls getPath; metadata operations deliberately use the delegate. */
    private static final class ReadTrackedFile extends File {
        private final File actual;
        int contentPathReads;
        ReadTrackedFile(File actual) { super(actual.getPath()); this.actual = actual; }
        @Override public boolean isFile() { return actual.isFile(); }
        @Override public long length() { return actual.length(); }
        @Override public String getAbsolutePath() { return actual.getAbsolutePath(); }
        @Override public String getPath() { contentPathReads++; return super.getPath(); }
        @Override public java.nio.file.Path toPath() { return actual.toPath(); }
    }
}
