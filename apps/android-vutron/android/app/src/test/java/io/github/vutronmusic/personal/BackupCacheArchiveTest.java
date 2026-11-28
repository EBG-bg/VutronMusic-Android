package io.github.vutronmusic.personal;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Random;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.Assert.*;

public class BackupCacheArchiveTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();

    @Test public void networkPrivacySettingsAreExplicitAndCredentialsAreNeverIncluded() throws Exception {
        JSONObject preferences = new JSONObject().put("audio_sources", new JSONObject().put("auto_match", false).put("token", "test-token"))
                .put("lyric_overlay", new JSONObject().put("wifi_validation", true).put("font_size", 22))
                .put("playback_tuning", new JSONObject().put("prefetchWifi", true).put("speed", 1.3))
                .put("vutron_user", new JSONObject().put("cookie", "test-only"));
        JSONObject plain = LibraryBackup.exportPreferences(preferences, false), optedIn = LibraryBackup.exportPreferences(preferences, true);
        assertFalse(plain.getJSONObject("audio_sources").has("auto_match"));
        assertFalse(plain.getJSONObject("lyric_overlay").has("wifi_validation"));
        assertFalse(plain.getJSONObject("playback_tuning").has("prefetchWifi"));
        assertEquals(22, plain.getJSONObject("lyric_overlay").getInt("font_size"));
        assertFalse(optedIn.getJSONObject("audio_sources").getBoolean("auto_match"));
        assertTrue(optedIn.getJSONObject("lyric_overlay").getBoolean("wifi_validation"));
        assertTrue(optedIn.getJSONObject("playback_tuning").getBoolean("prefetchWifi"));
        assertFalse(optedIn.toString().contains("test-only"));
        assertFalse(optedIn.toString().contains("test-token"));
    }

    @Test public void stagingValidCacheKeepsExistingFileAndCleansTemporaryDirectory() throws Exception {
        File root = temporary.newFolder();
        File current = new File(root, "lyric-cache").toPath().resolve("123.json").toFile();
        Files.createDirectories(current.getParentFile().toPath());
        Files.write(current.toPath(), "current".getBytes(StandardCharsets.UTF_8));
        byte[] archive = zip(1, "lyrics/123.json", new JSONObject().put("_songId", 123).put("lrc", "[00:00.00]Hello").put("token", "discard-me"));
        try (BackupCacheArchive.Staged staged = BackupCacheArchive.stage(root, new ByteArrayInputStream(archive))) {
            assertEquals(0, staged.backup.getJSONArray("collections").length());
            File stagedFile = findStage(root).toPath().resolve("1.tmp").toFile();
            JSONObject cached = new JSONObject(new String(Files.readAllBytes(stagedFile.toPath()), StandardCharsets.UTF_8));
            assertEquals("[00:00.00]Hello", cached.getString("lrc"));
            assertFalse(cached.has("token"));
            assertFalse(BackupCacheArchive.moveNew(stagedFile, root, "lyric-cache", "123.json"));
            assertEquals("current", new String(Files.readAllBytes(current.toPath()), StandardCharsets.UTF_8));
        }
        assertNull(findStage(root));
    }

    @Test public void inspectingZipManifestDoesNotReadOrDecompressCachePayload() throws Exception {
        byte[] payload = new byte[3 * 1024 * 1024]; new Random(42).nextBytes(payload);
        byte[] archive = zip(1, 1, "audio/123.audio", payload);
        CountingInput input = new CountingInput(archive);
        JSONObject manifest = BackupCacheArchive.inspectManifest(new BufferedInputStream(input));
        assertEquals(1, manifest.getInt("cacheItemCount"));
        assertEquals(0, manifest.getJSONArray("collections").length());
        assertTrue("inspection reads only the first ZIP member", input.count < 32 * 1024);
    }

    @Test public void cacheSpaceEstimateUsesArchiveTotalAndSupportsOlderAudioManifests() throws Exception {
        long audioBytes = 2L * 1024 * 1024 * 1024;
        long archiveBytes = audioBytes + 12 * 1024 * 1024;
        JSONArray audioEntries = new JSONArray();
        for (int id = 123; id < 127; id++) audioEntries.put(new JSONObject().put("id", id)
                .put("bytes", 512L * 1024 * 1024).put("sha256", "a".repeat(64)));
        JSONObject current = new JSONObject().put("cacheItemCount", 4).put("cacheTotalBytes", archiveBytes)
                .put("audioEntries", audioEntries);
        BackupCacheArchive.SpaceRequirement currentSpace = BackupCacheArchive.spaceRequirement(current, Long.MAX_VALUE);
        assertEquals(archiveBytes + 32L * 1024 * 1024, currentSpace.requiredBytes());
        assertTrue(currentSpace.sufficient());

        JSONObject older = new JSONObject().put("cacheItemCount", 4).put("audioEntries", audioEntries);
        BackupCacheArchive.SpaceRequirement olderSpace = BackupCacheArchive.spaceRequirement(older, audioBytes + 32L * 1024 * 1024);
        assertEquals(audioBytes + 32L * 1024 * 1024, olderSpace.requiredBytes());
        assertTrue(olderSpace.sufficient());
    }

    @Test public void insufficientCacheSpaceFailsWithRequiredAndAvailableBytes() throws Exception {
        long archiveBytes = 3L * 1024 * 1024 * 1024;
        JSONObject manifest = new JSONObject().put("cacheItemCount", 2).put("cacheTotalBytes", archiveBytes)
                .put("audioEntries", new JSONArray());
        long required = archiveBytes + 32L * 1024 * 1024;
        IOException failure = assertThrows(IOException.class,
                () -> BackupCacheArchive.requireSpace(manifest, required - 1));
        assertEquals("BACKUP_CACHE_SPACE:" + required + ":" + (required - 1), failure.getMessage());
    }

    @Test public void invalidPathAndMissingEntriesFailBeforeAnyCacheFileIsApplied() throws Exception {
        File root = temporary.newFolder();
        for (byte[] archive : new byte[][]{zip(1, "lyrics/../vutron_user.xml", new JSONObject().put("value", "x")), zip(2, "lyrics/123.json", new JSONObject().put("_songId", 123))}) {
            try {
                BackupCacheArchive.stage(root, new ByteArrayInputStream(archive));
                fail("Invalid archive accepted");
            } catch (IOException expected) { assertEquals(0, root.list().length); }
        }
    }

    @Test public void knownPlaylistFieldsAndPublicCoverArePortableWithoutSignedQueriesOrDiskPaths() throws Exception {
        JSONObject raw = new JSONObject().put("userId", 42).put("playlistId", 8)
                .put("tracks", new JSONArray().put(new JSONObject().put("id", 12).put("name", "Song")
                        .put("picUrl", "https://p1.music.126.net/sample/name.jpg?accessToken=test-only")
                        .put("localUri", "file:///private/Fake.mp3").put("token", "test-only")));
        JSONObject result = BackupCacheArchive.portableJson("playlists/playlist-42-8.json", raw);
        JSONObject track = result.getJSONArray("tracks").getJSONObject(0);
        assertEquals("https://p1.music.126.net/sample/name.jpg", track.getString("picUrl"));
        assertFalse(result.toString().contains("test-only"));
        assertFalse(track.has("localUri"));
    }

    @Test public void largeNativePlaylistExportsAfterSanitizationAndCanBeImported() throws Exception {
        File raw = temporary.newFile("playlist-42-91.json");
        String name = "playlists/" + raw.getName();
        String discarded = "x".repeat(8 * 1024);
        int count = 1050;
        try (Writer writer = Files.newBufferedWriter(raw.toPath(), StandardCharsets.UTF_8)) {
            writer.write("{\"version\":1,\"userId\":42,\"playlistId\":91,\"tracks\":[");
            for (int id = 1; id <= count; id++) {
                if (id > 1) writer.write(',');
                writer.write(new JSONObject().put("id", id).put("name", "Track " + id)
                        .put("duration", 180000).put("rawProviderMetadata", discarded).toString());
            }
            writer.write("]}");
        }
        assertEquals(8L * 1024 * 1024, BackupCacheArchive.limit(name));
        assertTrue(raw.length() > BackupCacheArchive.limit(name));
        assertTrue(raw.length() <= PlaylistCache.archiveSourceLimit(raw.getName()));
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(output)) {
            put(zip, "backup.json", new JSONObject().put("format", 1).put("generator", LibraryBackup.GENERATOR)
                    .put("cacheArchive", 1).put("cacheItemCount", 1).put("playlistOwner", 42)
                    .put("audioEntries", new JSONArray()).put("collections", new JSONArray()));
            BackupCacheArchive.writeExportJson(zip, name, raw);
        }
        File root = temporary.newFolder();
        try (BackupCacheArchive.Staged staged = BackupCacheArchive.stage(root, new ByteArrayInputStream(output.toByteArray()))) {
            File member = new File(findStage(root), "1.tmp");
            assertTrue(member.length() <= BackupCacheArchive.limit(name));
            JSONObject portable = new JSONObject(new String(Files.readAllBytes(member.toPath()), StandardCharsets.UTF_8));
            JSONArray tracks = portable.getJSONArray("tracks");
            assertEquals(count, tracks.length());
            assertEquals(1, tracks.getJSONObject(0).getLong("id"));
            assertEquals(count, tracks.getJSONObject(count - 1).getLong("id"));
            assertFalse(tracks.getJSONObject(0).has("rawProviderMetadata"));
        }
    }

    @Test public void versionTwoStagesPortablePluginPlaylistsAndOldFormatCannotClaimThem() throws Exception {
        String plugin = "fixture", account = "a".repeat(64);
        JSONObject original = new JSONObject().put("id", "song").put("name", "Song").put("sourceContext", new JSONObject());
        PluginPlaylistCache.Snapshot snapshot = PluginPlaylistCache.snapshot(plugin, account, "Fixture",
                new JSONObject().put("id", "mix").put("name", "Mix").put("trackCount", 1), java.util.List.of(PluginTrackAdapter.displayTrack(plugin, original, account)));
        String key = snapshot.header().getString("pluginCacheKey"), name = "plugin-playlists/" + key + ".snapshot";
        snapshot.rows().getJSONObject(0).put("sourceContext", new JSONObject().put("token", "test-only"));
        byte[] bytes = (snapshot.header() + "\n" + snapshot.rows()).getBytes(StandardCharsets.UTF_8);
        File root = temporary.newFolder();
        try (BackupCacheArchive.Staged staged = BackupCacheArchive.stage(root, new ByteArrayInputStream(zip(2, 1, name, bytes)))) {
            File picked = new File(findStage(root), "1.tmp");
            assertEquals(2, staged.backup.getInt("cacheArchive"));
            assertFalse(new String(Files.readAllBytes(picked.toPath()), StandardCharsets.UTF_8).contains("test-only"));
        }
        assertNull(findStage(root));
        assertThrows(IOException.class, () -> BackupCacheArchive.stage(root, new ByteArrayInputStream(zip(1, 1, name, bytes))));
    }

    @Test public void accountEnvelopeSurvivesJsonAndZipAndRequiresImportOptIn() throws Exception {
        char[] password = "test-backup-password".toCharArray();
        JSONObject account = new JSONObject().put("session", "fixture-session-value");
        JSONObject settings = new JSONObject().put("audio_sources", new JSONObject().put("auto_match", true));
        JSONObject document = new JSONObject().put("generator", LibraryBackup.GENERATOR).put("format", 1)
                .put("collections", new JSONArray()).put("settings", settings).put("cacheArchive", 1)
                .put("cacheItemCount", 0).put("audioEntries", new JSONArray())
                .put(LibraryBackup.ACCOUNT_ENVELOPE, BackupAccountCipher.seal(account, password));
        byte[] json = LibraryBackup.exportBytes(document);
        assertFalse(new String(json, StandardCharsets.UTF_8).contains("fixture-session-value"));
        ByteArrayOutputStream zipped = new ByteArrayOutputStream();
        try (ZipOutputStream archive = new ZipOutputStream(zipped)) { put(archive, "backup.json", document); }
        try (BackupCacheArchive.Staged stage = BackupCacheArchive.stage(temporary.newFolder(), new ByteArrayInputStream(zipped.toByteArray()))) {
            for (JSONObject parsed : new JSONObject[]{LibraryBackup.read(new ByteArrayInputStream(json)), stage.backup}) {
                JSONObject publicImport = new JSONObject(parsed.toString());
                assertNull(LibraryBackup.takeAccountEnvelope(publicImport, false));
                assertFalse(publicImport.has(LibraryBackup.ACCOUNT_ENVELOPE));
                assertFalse(publicImport.getJSONObject("settings").getJSONObject("audio_sources").has("auto_match"));
                JSONObject envelope = LibraryBackup.takeAccountEnvelope(parsed, true);
                assertEquals(account.toString(), BackupAccountCipher.open(envelope, password).toString());
                assertTrue(parsed.getJSONObject("settings").getJSONObject("audio_sources").getBoolean("auto_match"));
                assertFalse(parsed.has(LibraryBackup.ACCOUNT_ENVELOPE));
            }
        }
        assertNull(LibraryBackup.takeAccountEnvelope(new JSONObject(), true));
        assertThrows(IOException.class, () -> LibraryBackup.takeAccountEnvelope(new JSONObject().put(LibraryBackup.ACCOUNT_ENVELOPE, "plaintext"), true));
    }

    private static File findStage(File root) {
        File[] stages = root.listFiles(file -> file.getName().startsWith("backup-restore-"));
        return stages == null || stages.length == 0 ? null : stages[0];
    }

    private static final class CountingInput extends ByteArrayInputStream {
        long count;
        CountingInput(byte[] data) { super(data); }
        @Override public synchronized int read(byte[] value, int offset, int length) { int size=super.read(value,offset,length); if(size>0) count+=size; return size; }
        @Override public synchronized int read() { int value=super.read(); if(value>=0) count++; return value; }
    }

    private static byte[] zip(int count, String entry, JSONObject data) throws Exception {
        return zip(1, count, entry, data.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static byte[] zip(int format, int count, String entry, byte[] data) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(output)) {
            put(zip, "backup.json", new JSONObject().put("format", 1).put("generator", LibraryBackup.GENERATOR)
                    .put("cacheArchive", format).put("cacheItemCount", count).put("audioEntries", new JSONArray()).put("collections", new JSONArray()));
            zip.putNextEntry(new ZipEntry(entry)); zip.write(data); zip.closeEntry();
        }
        return output.toByteArray();
    }

    private static void put(ZipOutputStream zip, String name, JSONObject value) throws Exception {
        zip.putNextEntry(new ZipEntry(name)); zip.write(value.toString().getBytes(StandardCharsets.UTF_8)); zip.closeEntry();
    }
}
