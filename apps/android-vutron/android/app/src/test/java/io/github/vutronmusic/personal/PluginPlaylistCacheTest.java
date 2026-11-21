package io.github.vutronmusic.personal;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;
import java.util.Map;

import static org.junit.Assert.*;

public class PluginPlaylistCacheTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private static final String PLUGIN = "fixture:source-1";
    private static final String ALICE = "a".repeat(64), BOB = "b".repeat(64);

    @Test public void readsOrderedMetadataAcrossInstancesAndNeverSavesOpaqueContext() throws Exception {
        File directory = temporary.newFolder();
        JSONObject first = track(PLUGIN, ALICE, "secret-remote-1", "First"), second = track(PLUGIN, ALICE, "secret-remote-2", "Second");
        JSONObject detail = playlist(3).put("coverFingerprint", "c".repeat(64));
        PluginPlaylistCache.Snapshot saved = PluginPlaylistCache.snapshot(PLUGIN, ALICE, "Source", detail, List.of(first, second, first));
        String key = PluginPlaylistCache.key(PLUGIN, ALICE, "secret-playlist-id");
        PluginPlaylistCache.write(directory, saved);
        Map<String, PluginPlaylistCache.Owner> alice = owners(ALICE);
        List<JSONObject> headers = PluginPlaylistCache.headers(directory, alice);
        assertEquals(1, headers.size());
        assertEquals(key, headers.get(0).getString("pluginCacheKey"));
        assertEquals(3, headers.get(0).getInt("trackCount"));
        assertEquals("c".repeat(64), headers.get(0).getString("coverFingerprint"));
        assertFalse(headers.get(0).has("tracks"));
        JSONArray rows = PluginPlaylistCache.read(directory, key, alice).rows();
        assertEquals(first.getLong("id"), rows.getJSONObject(0).getLong("id"));
        assertEquals(second.getLong("id"), rows.getJSONObject(1).getLong("id"));
        assertEquals(first.getLong("id"), rows.getJSONObject(2).getLong("id"));
        assertNotEquals(PluginPlaylistCache.rowKey(key, 0), PluginPlaylistCache.rowKey(key, 2));
        File file = new File(directory, key + ".snapshot");
        String raw = new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
        for (String secret : List.of("secret-", "sourceContext", "pluginSourceContext", "pluginTrackId", "signed.invalid", "content://", "localPath"))
            assertFalse(secret, raw.contains(secret));
    }

    @Test public void accountSwitchHidesReadsAndDeletionAndRemovingOneSnapshotKeepsTheOther() throws Exception {
        File directory = temporary.newFolder();
        PluginPlaylistCache.Snapshot alice = PluginPlaylistCache.snapshot(PLUGIN, ALICE, "Source", playlist(0), List.of());
        PluginPlaylistCache.Snapshot bob = PluginPlaylistCache.snapshot(PLUGIN, BOB, "Source", playlist(0), List.of());
        PluginPlaylistCache.write(directory, alice);
        PluginPlaylistCache.write(directory, bob);
        String aliceKey = alice.header().getString("pluginCacheKey"), bobKey = bob.header().getString("pluginCacheKey");
        assertNotEquals(aliceKey, bobKey);
        assertNotEquals(alice.header().getLong("id"), bob.header().getLong("id"));
        assertEquals(bobKey, PluginPlaylistCache.headers(directory, owners(BOB)).get(0).getString("pluginCacheKey"));
        assertThrows(IOException.class, () -> PluginPlaylistCache.read(directory, aliceKey, owners(BOB)));
        assertThrows(IOException.class, () -> PluginPlaylistCache.remove(directory, aliceKey, owners(BOB)));
        assertThrows(IOException.class, () -> PluginPlaylistCache.read(directory, "../" + aliceKey, owners(ALICE)));
        PluginPlaylistCache.remove(directory, aliceKey, owners(ALICE));
        assertTrue(PluginPlaylistCache.headers(directory, owners(ALICE)).isEmpty());
        assertEquals(0, PluginPlaylistCache.read(directory, bobKey, owners(BOB)).rows().length());
    }

    @Test public void cachedRecordingMustMatchScopedIdAndUnderlyingProviderTrack() throws Exception {
        JSONObject cached = track(PLUGIN, ALICE, "secret-track-1", "Track");
        JSONObject clean = PluginPlaylistCache.snapshot(PLUGIN, ALICE, "Source", playlist(1), List.of(cached)).rows().getJSONObject(0);
        assertTrue(PluginPlaylistCache.matchesAudio(clean, cached));
        // A same-number collision or unrelated injected row never exposes its audio.
        assertFalse(PluginPlaylistCache.matchesAudio(clean, track(PLUGIN, BOB, "secret-track-1", "Track").put("id", clean.getLong("id"))));
        assertFalse(PluginPlaylistCache.matchesAudio(clean, track(PLUGIN, ALICE, "secret-track-2", "Track").put("id", clean.getLong("id"))));
        assertThrows(IOException.class, () -> PluginPlaylistCache.snapshot(PLUGIN, ALICE, "Source", playlist(2), List.of(cached)));
    }

    @Test public void portableBackupStripsInjectedDataAndRestoresOnlyIntoCurrentAccountsWithoutOverwriting() throws Exception {
        File origin = temporary.newFolder(), target = temporary.newFolder();
        JSONObject song = track(PLUGIN, ALICE, "secret-track", "Source track");
        PluginPlaylistCache.Snapshot snapshot = PluginPlaylistCache.snapshot(PLUGIN, ALICE, "Source", playlist(1), List.of(song));
        JSONObject row = snapshot.rows().getJSONObject(0);
        row.put("pluginSourceContext", new JSONObject().put("token", "secret-context"));
        row.put("localUri", "content://secret-document");
        snapshot.header().put("picUrl", "https://signed.invalid/?token=secret-image");
        PluginPlaylistCache.write(origin, snapshot);
        String key = snapshot.header().getString("pluginCacheKey");
        File exported = new File(origin, key + ".snapshot");
        PluginPlaylistCache.sanitizeBackup(exported, key);
        String text = new String(PluginPlaylistCache.portableBackup(exported, key), StandardCharsets.UTF_8);
        assertFalse(text.contains("secret-"));
        assertFalse(PluginPlaylistCache.restoreBackup(target, exported, key, owners(BOB)));
        assertTrue(PluginPlaylistCache.restoreBackup(target, exported, key, owners(ALICE)));
        assertFalse(PluginPlaylistCache.restoreBackup(target, exported, key, owners(ALICE)));
        JSONObject restored = PluginPlaylistCache.read(target, key, owners(ALICE)).rows().getJSONObject(0);
        String fingerprint = PluginPlaylistCache.audioFingerprint(song);
        song.remove("pluginTrackId");
        song.put("trackFingerprint", fingerprint);
        assertTrue(PluginPlaylistCache.matchesAudio(restored, song));
        assertThrows(IOException.class, () -> PluginPlaylistCache.portableBackup(exported, "0".repeat(64)));
    }

    private static Map<String, PluginPlaylistCache.Owner> owners(String scope) {
        return Map.of(PLUGIN, new PluginPlaylistCache.Owner(scope, "Source"));
    }

    private static JSONObject playlist(int trackCount) throws Exception {
        return new JSONObject().put("id", "secret-playlist-id").put("name", "Saved list").put("trackCount", trackCount)
                .put("picUrl", "https://signed.invalid/image?token=secret-cover").put("sourceContext", new JSONObject().put("cookie", "secret-cookie"));
    }

    private static JSONObject track(String pluginId, String scope, String id, String name) throws Exception {
        return PluginTrackAdapter.track(pluginId, new JSONObject().put("id", id).put("name", name).put("duration", 126000)
                .put("picUrl", "https://signed.invalid/audio?token=secret-url")
                .put("sourceContext", new JSONObject().put("authorization", "secret-auth")), scope)
                .put("localUri", "content://secret-document").put("localPath", "C:/secret-audio.mp3");
    }
}
