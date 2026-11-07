package io.github.vutronmusic.personal;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.Arrays;
import java.util.Collections;
import static org.junit.Assert.*;

public class NeteasePlaybackPolicyTest {
    private static JSONObject audio(String source) throws Exception {
        return new JSONObject().put("url", "https://audio.invalid/full.flac").put("source", source)
                .put("br", 1411200).put("type", "flac").put("lossless", true)
                .put("identityRank", 8).put("headers", new JSONObject().put("Referer", "https://audio.invalid"));
    }
    private static NeteasePlaybackPolicy.Gate online(AtomicBoolean value) {
        return () -> { if (!value.get()) throw new IOException("offline"); };
    }
    private static JSONObject original(String id) throws Exception {
        return new JSONObject().put("id", id).put("name", "Original title")
                .put("artists", new JSONArray().put(new JSONObject().put("id", "artist").put("name", "Original artist")))
                .put("sourceContext", new JSONObject().put("id", "opaque-provider-field")
                        .put("nested", new JSONObject().put("hash", "unchanged")));
    }

    @Test public void bothAccountEntrypointsUseOfficialFirstAndRetainItsFullQualityEvidence() throws Exception {
        for (String account : new String[]{"native-account", "plugin-instance-account"}) {
            JSONObject result = audio("netease"); String before = result.toString(); AtomicInteger fallback = new AtomicInteger();
            JSONObject selected = NeteasePlaybackPolicy.resolveSources(() -> { }, () -> {
                assertTrue(account.endsWith("account")); NeteasePlaybackPolicy.requireCompleteAudio(result); return result;
            }, () -> true, () -> { fallback.incrementAndGet(); throw new IOException("must not run"); });
            assertSame(result, selected); assertEquals(before, selected.toString()); assertEquals(0, fallback.get());
        }
    }

    @Test public void trialAndMissingOfficialAudioUseTheSameConfiguredFallbackWithoutStrippingEvidence() throws Exception {
        JSONObject fallback = audio("validated-other-source"); String before = fallback.toString();
        for (JSONObject official : new JSONObject[]{new JSONObject().put("url", "https://audio.invalid/trial.mp3")
                .put("freeTrialInfo", new JSONObject().put("start", 0).put("end", 30)), new JSONObject().put("url", JSONObject.NULL), null}) {
            JSONObject selected = NeteasePlaybackPolicy.resolveSources(() -> { }, () -> {
                NeteasePlaybackPolicy.requireCompleteAudio(official); return official;
            }, () -> true, () -> fallback);
            assertSame(fallback, selected); assertEquals(before, selected.toString());
        }
    }

    @Test public void completeOfficialAudioAcceptsExplicitNullTrialInfoAndPreservesReplayGainMetadata() throws Exception {
        JSONObject value = audio("netease").put("freeTrialInfo", JSONObject.NULL).put("gain", -4.25).put("peak", 0.95);
        String before = value.toString(); NeteasePlaybackPolicy.requireCompleteAudio(value); assertEquals(before, value.toString());
    }

    @Test public void disabledAutomaticMatchingReturnsTheOriginalFailureAndNeverCallsAnotherSource() {
        IOException denied = new IOException("account has no full audio"); AtomicInteger fallback = new AtomicInteger();
        IOException failure = assertThrows(IOException.class, () -> NeteasePlaybackPolicy.resolveSources(() -> { },
                () -> { throw denied; }, () -> false, () -> { fallback.incrementAndGet(); return null; }));
        assertSame(denied, failure); assertEquals(0, fallback.get());
    }

    @Test public void anOfflineGatePreventsBothProvidersFromStarting() {
        AtomicInteger calls = new AtomicInteger(); AtomicBoolean allowed = new AtomicBoolean(false);
        assertThrows(IOException.class, () -> NeteasePlaybackPolicy.resolveSources(online(allowed),
                () -> { calls.incrementAndGet(); return null; }, () -> true, () -> { calls.incrementAndGet(); return null; }));
        assertEquals(0, calls.get());
    }

    @Test public void changingModeAfterOfficialFailureCannotStartTheFallback() {
        AtomicBoolean allowed = new AtomicBoolean(true); AtomicInteger fallback = new AtomicInteger();
        IOException failure = assertThrows(IOException.class, () -> NeteasePlaybackPolicy.resolveSources(online(allowed),
                () -> { allowed.set(false); throw new IOException("official failed"); }, () -> true,
                () -> { fallback.incrementAndGet(); return null; }));
        assertEquals("offline", failure.getMessage()); assertEquals(0, fallback.get());
    }

    @Test public void anAccountChangeRejectsOfficialResultsWithoutStartingAnotherProvider() throws Exception {
        AtomicReference<String> scope = new AtomicReference<>("plugin-account-a"); AtomicInteger fallback = new AtomicInteger();
        NeteasePlaybackPolicy.Gate gate = () -> { if (!"plugin-account-a".equals(scope.get())) throw new IOException("PLUGIN_ACCOUNT_CHANGED"); };
        JSONObject result = audio("netease");
        IOException failure = assertThrows(IOException.class, () -> NeteasePlaybackPolicy.resolveSources(gate,
                () -> { scope.set("plugin-account-b"); return result; }, () -> true,
                () -> { fallback.incrementAndGet(); return result; }));
        assertEquals("PLUGIN_ACCOUNT_CHANGED", failure.getMessage()); assertEquals(0, fallback.get());
    }

    @Test public void aFallbackResultCannotEscapeAfterSourceDisableOrServerChange() throws Exception {
        AtomicBoolean enabled = new AtomicBoolean(true); JSONObject value = audio("other");
        IOException failure = assertThrows(IOException.class, () -> NeteasePlaybackPolicy.resolveSources(online(enabled),
                () -> { throw new IOException("official failed"); }, () -> true,
                () -> { enabled.set(false); return value; }));
        assertEquals("offline", failure.getMessage());
    }

    @Test public void providerFailuresKeepBothDiagnosticsButNeverReenterEitherSource() {
        IOException official = new IOException("official unavailable"), other = new IOException("matching unavailable");
        AtomicInteger first = new AtomicInteger(), second = new AtomicInteger();
        IOException combined = assertThrows(IOException.class, () -> NeteasePlaybackPolicy.resolveSources(() -> { },
                () -> { first.incrementAndGet(); throw official; }, () -> true, () -> { second.incrementAndGet(); throw other; }));
        assertSame(other, combined.getCause()); assertSame(official, combined.getSuppressed()[0]);
        assertEquals(1, first.get()); assertEquals(1, second.get());
    }

    @Test public void threadCancellationAndEndpointPermissionChecksCannotStartAProvider() {
        AtomicInteger calls = new AtomicInteger();
        Thread.currentThread().interrupt();
        try {
            assertThrows(InterruptedIOException.class, () -> NeteasePlaybackPolicy.resolveSources(() -> { },
                    () -> { calls.incrementAndGet(); return null; }, () -> true, () -> { calls.incrementAndGet(); return null; }));
            assertFalse(NeteasePlaybackPolicy.permitted(() -> { }));
        } finally { Thread.interrupted(); }
        assertEquals(0, calls.get()); assertFalse(NeteasePlaybackPolicy.permitted(() -> { throw new IOException("account changed"); }));
    }

    @Test public void neteasePublicIdDoesNotReplacePluginQueueCacheVolumeOrOpaqueIdentity() throws Exception {
        JSONObject raw = original("1234567890"), song = PluginTrackAdapter.track("netease:second", raw, "scope-second");
        song.put("pluginPlaylistContext", new JSONObject().put("opaque", "playlist-context"));
        String before = song.toString(); long cacheId = song.getLong("id");
        assertNotEquals(1234567890L, cacheId); assertEquals(1234567890L, NeteasePlaybackPolicy.publicTrackId(song));
        assertEquals(before, song.toString()); assertEquals(cacheId, song.getLong("id"));
        assertEquals("opaque-provider-field", song.getJSONObject("pluginSourceContext").getString("id"));
        assertEquals("scope-second", song.getString("pluginAccountScope"));
        assertEquals("playlist-context", song.getJSONObject("pluginPlaylistContext").getString("opaque"));
    }

    @Test public void invalidOrInconsistentPublicIdsCannotFallBackToGeneratedNativeOrContextIds() throws Exception {
        for (Object id : new Object[]{"", "0", "-1", "1.5", "0012", "song:12", "9223372036854775808", JSONObject.NULL}) {
            JSONObject song = new JSONObject().put("id", 777).put("pluginTrackId", String.valueOf(id))
                    .put("pluginTrack", new JSONObject().put("id", id)).put("pluginSourceContext", new JSONObject().put("id", 12));
            assertThrows(IOException.class, () -> NeteasePlaybackPolicy.publicTrackId(song));
        }
        JSONObject mismatch = new JSONObject().put("pluginTrackId", "456").put("pluginTrack", new JSONObject().put("id", 123));
        assertThrows(IOException.class, () -> NeteasePlaybackPolicy.publicTrackId(mismatch));
        assertThrows(IOException.class, () -> NeteasePlaybackPolicy.publicTrackId(new JSONObject().put("id", 123)));
    }

    @Test public void restoredPublicStringIdsRemainUsableWithoutReadingAProviderContext() throws Exception {
        JSONObject restored = new JSONObject().put("pluginTrackId", "1234567890123").put("id", 9007199254740000L)
                .put("pluginSourceContext", new JSONObject().put("id", "unrelated"));
        assertEquals(1234567890123L, NeteasePlaybackPolicy.publicTrackId(restored));
    }

    private static JSONObject local(String uri) throws Exception {
        return new JSONObject().put("id", 999).put("name", "Original title").put("localHasTitle", true)
                .put("ar", new JSONArray().put(new JSONObject().put("name", "Original artist")))
                .put("al", new JSONObject().put("name", "Original album")).put("duration", 180000)
                .put("localUri", uri).put("localFileName", "Original recording.flac");
    }
    private static JSONObject localMatchSong() throws Exception {
        JSONObject raw = original("123").put("duration", 180000).put("album", new JSONObject().put("name", "Original album"));
        return PluginTrackAdapter.track("netease:second", raw, "plugin-account-second")
                .put("pluginPlaylistContext", new JSONObject().put("opaque", "playlist"));
    }

    @Test public void authorizedLocalIndexMatchingUsesTheSameIdentityEvidenceWithoutReplacingPluginOwnership() throws Exception {
        JSONObject song = localMatchSong(), query = NeteasePlaybackPolicy.localMatchTarget(song); String before = song.toString();
        JSONObject nativeQuery = new JSONObject().put("id", 123).put("name", "Original title").put("duration", 180000)
                .put("artists", new JSONArray().put("Original artist")).put("album", "Original album");
        JSONObject file = local("content://authorized/original");
        JSONObject nativeMatch = LocalPlaybackResolver.match(nativeQuery, Collections.singletonList(file));
        JSONObject pluginMatch = LocalPlaybackResolver.match(query, Collections.singletonList(file));
        JSONObject result = NeteasePlaybackPolicy.withLocalAudio(song, pluginMatch);
        assertNotNull(nativeMatch); assertNotNull(result); assertEquals(nativeMatch.getString("localUri"), result.getString("localUri"));
        assertEquals(123, query.getLong("id")); assertEquals(before, song.toString());
        for (String key : new String[]{"id", "pluginId", "pluginTrackId", "pluginAccountScope", "trackVolumeKey", "playlistVolumeKey", "playlistOrderScope", "playlistOrderKey"})
            assertEquals(key, song.get(key), result.get(key));
        for (String key : new String[]{"pluginTrack", "pluginSourceContext", "pluginPlaylistContext"}) assertEquals(song.getJSONObject(key).toString(), result.getJSONObject(key).toString());
        assertFalse(result.has("neteaseId"));
    }

    @Test public void aBoundLocalFileUsesThePublicServiceIdAndDoesNotAccidentallyMatchTheSyntheticCacheId() throws Exception {
        JSONObject song = localMatchSong(), query = NeteasePlaybackPolicy.localMatchTarget(song);
        JSONObject bound = local("content://authorized/bound").put("neteaseId", 123).put("name", "Custom file label");
        assertNotNull(LocalPlaybackResolver.match(query, Collections.singletonList(bound)));
        bound.put("neteaseId", song.getLong("id"));
        assertNull(LocalPlaybackResolver.match(query, Collections.singletonList(bound)));
    }

    @Test public void localVersionAndDuplicateFileAmbiguityRemainConservativeForPluginSelections() throws Exception {
        JSONObject query = NeteasePlaybackPolicy.localMatchTarget(localMatchSong());
        JSONObject one = local("content://authorized/a"), two = local("content://authorized/b");
        assertNull(LocalPlaybackResolver.match(query, Arrays.asList(one, two)));
        assertNull(LocalPlaybackResolver.match(query, Collections.singletonList(new JSONObject(one.toString()).put("name", "Original title (Live)"))));
        assertNull(LocalPlaybackResolver.match(query, Collections.singletonList(new JSONObject(one.toString())
                .put("ar", new JSONArray().put(new JSONObject().put("name", "Different singer"))))));
    }

    @Test public void aMatchedCueCopiesOnlyFileAndSegmentFieldsAndKeepsThePluginPlaybackIdentity() throws Exception {
        JSONObject song = localMatchSong(), cue = local("content://authorized/cue").put("cueTrackNo", 2)
                .put("cueOffsetMs", 200000).put("cueDurationMs", 180000).put("cueAlbum", "CUE album");
        JSONObject matched = LocalPlaybackResolver.match(NeteasePlaybackPolicy.localMatchTarget(song), Collections.singletonList(cue));
        assertNotNull(matched);
        // Even fields returned alongside a match cannot become source ownership.
        matched.put("pluginId", "local").put("id", 999).put("pluginAccountScope", "different")
                .put("trackVolumeKey", "local-volume").put("sourceContext", new JSONObject().put("new", "unrelated"));
        JSONObject result = NeteasePlaybackPolicy.withLocalAudio(song, matched);
        assertEquals("netease:second", result.getString("pluginId")); assertEquals(song.getLong("id"), result.getLong("id"));
        assertEquals(song.getString("trackVolumeKey"), result.getString("trackVolumeKey"));
        assertEquals("plugin-account-second", result.getString("pluginAccountScope"));
        assertEquals(song.getJSONObject("pluginSourceContext").toString(), result.getJSONObject("pluginSourceContext").toString());
        assertFalse(result.has("sourceContext")); assertEquals(200000, result.getLong("cueOffsetMs"));
        assertEquals(180000, result.getLong("duration")); assertEquals(2, result.getInt("cueTrackNo"));
        assertNull(NeteasePlaybackPolicy.withLocalAudio(song, null));
    }
}
