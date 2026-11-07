package io.github.vutronmusic.personal;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

/** Regression boundaries between original plugin objects and native offline media. */
public class PluginCacheContractTest {
    private static JSONObject original() throws Exception {
        return new JSONObject().put("id", "song:opaque-7").put("name", "Recording").put("duration", 150000)
                .put("picUrl", "https://synthetic.invalid/cover/7").put("artists", new JSONArray().put(new JSONObject().put("id", "artist:9").put("name", "Artist")))
                .put("sourceContext", new JSONObject().put("opaqueProviderField", "unchanged")
                        .put("nested", new JSONObject().put("source", "server-owned")));
    }

    @Test public void privateCacheRoundTripRetainsProviderContextAndNeverBecomesANetEaseTrack() throws Exception {
        JSONObject raw = original(); String before = raw.toString();
        JSONObject nativeTrack = PluginTrackAdapter.track("emby:home", raw, "account-server-a");
        nativeTrack.put("pluginPlaylistContext", new JSONObject().put("id", "playlist:2"));
        JSONObject disk = new JSONObject(AudioCache.metadata(nativeTrack).toString());
        disk.put("cached", true).put("source", "cache");
        assertEquals(before, raw.toString());
        assertEquals(nativeTrack.getLong("id"), disk.getLong("id"));
        assertEquals("emby:home", disk.getString("pluginId"));
        assertEquals("account-server-a", disk.getString("pluginAccountScope"));
        assertEquals("song:opaque-7", disk.getString("pluginTrackId"));
        assertEquals(raw.getJSONObject("sourceContext").toString(), disk.getJSONObject("pluginSourceContext").toString());
        assertEquals(before, disk.getJSONObject("pluginTrack").toString());
        assertEquals("playlist:2", disk.getJSONObject("pluginPlaylistContext").getString("id"));
        assertEquals(nativeTrack.getString("trackVolumeKey"), PlaybackVolume.trackKey(disk));
        assertEquals(0, LyricOverlaySettings.remoteLyricId(disk));
    }

    @Test public void reusedServerSongIdsGetDifferentCacheAndVolumeIdentitiesForEachAccount() throws Exception {
        JSONObject serverA = PluginTrackAdapter.track("emby", original(), "account-server-a");
        JSONObject serverB = PluginTrackAdapter.track("emby", original(), "account-server-b");
        JSONObject restoredA = new JSONObject(AudioCache.metadata(serverA).toString());
        JSONObject restoredB = new JSONObject(AudioCache.metadata(serverB).toString());
        assertNotEquals(restoredA.getLong("id"), restoredB.getLong("id"));
        assertNotEquals(PlaybackVolume.trackKey(restoredA), PlaybackVolume.trackKey(restoredB));
        assertNotEquals(LyricOverlaySettings.trackIdentity(restoredA), LyricOverlaySettings.trackIdentity(restoredB));
        assertEquals(restoredA.getLong("id"), PluginTrackAdapter.track("emby", original(), "account-server-a").getLong("id"));
    }

    @Test public void remoteCueCacheKeepsTheRequestedSliceWhenTheWholeSourceIsSaved() throws Exception {
        JSONObject nativeTrack = PluginTrackAdapter.track("custom-stream", original(), "account-server-a")
                .put("cueTrackNo", 2).put("cueOffsetMs", 180000).put("cueDurationMs", 150000);
        JSONObject disk = new JSONObject(AudioCache.metadata(nativeTrack).toString());
        disk.put("cached", true).put("source", "cache");
        PlaybackSegment segment = PlaybackSegment.of(disk, 900000);
        assertTrue(segment.cue);
        assertEquals(180000, segment.start);
        assertEquals(150000, segment.length);
        assertEquals(195000, segment.absolute(15000));
        assertEquals(15000, segment.relative(195000));
        assertEquals(nativeTrack.getString("pluginAccountScope"), disk.getString("pluginAccountScope"));
        assertEquals(0, AudioCache.expectedSourceDuration(disk));
        AudioCache.validateCueSource(disk, 900000);
        AudioCache.validateCueSource(disk, 329000); // Container rounding may omit less than the existing 1.5s tolerance.
        try { AudioCache.validateCueSource(disk, 200000); fail("truncated source must not cache"); }
        catch (java.io.IOException expected) { }
        assertEquals(150000, AudioCache.expectedSourceDuration(PluginTrackAdapter.track("custom-stream", original(), "account-server-a")));
    }

    @Test public void invalidCueBoundsCannotTurnACompleteAudioFileIntoAnInvalidCachedSlice() throws Exception {
        JSONObject cue = new JSONObject().put("cueTrackNo", 2).put("cueOffsetMs", -1).put("cueDurationMs", 150000);
        try { AudioCache.validateCueSource(cue, 900000); fail("negative offset"); } catch (java.io.IOException expected) { }
        cue.put("cueOffsetMs", 180000).put("cueDurationMs", 0);
        try { AudioCache.validateCueSource(cue, 900000); fail("empty segment"); } catch (java.io.IOException expected) { }
        cue.put("cueOffsetMs", 900000).put("cueDurationMs", 150000);
        try { AudioCache.validateCueSource(cue, 900000); fail("offset at end"); } catch (java.io.IOException expected) { }
        // A normal recording still keeps its expected duration comparison and has no CUE bounds.
        AudioCache.validateCueSource(new JSONObject().put("duration", 150000), 900000);
        assertEquals(150000, AudioCache.expectedSourceDuration(new JSONObject().put("duration", 150000)));
    }

    @Test public void repeatedRealWordsAndTranslationKeepTheOriginalTimeUnitsAfterNativeConversion() throws Exception {
        JSONArray rows = new JSONArray().put(new JSONObject().put("start", 1.25).put("end", 3.25)
                .put("lyric", new JSONObject().put("text", "Go Go!").put("info", new JSONArray()
                        .put(new JSONObject().put("start", 1250).put("end", 1750).put("word", "Go"))
                        .put(new JSONObject().put("start", 2250).put("end", 3250).put("word", "Go!"))))
                .put("tlyric", new JSONObject().put("text", "走吧")));
        LyricTimeline timeline = LyricTimeline.fromPlugin(rows, "lyric");
        LyricTimeline.Line line = timeline.lines.get(0);
        assertEquals(1250, line.time);
        assertEquals(2000, line.duration);
        assertEquals(2, line.words.size());
        assertEquals(3, line.words.get(1).first);
        assertEquals(2250, line.words.get(1).start);
        assertEquals(1000, line.words.get(1).duration);
        assertEquals(4.5f, line.highlightedCharacters(2750, 3250), 0.001f);
        assertEquals("走吧", new LyricRepository.Lyrics(timeline, LyricTimeline.fromPlugin(rows, "tlyric"), true).translationAt(0));
    }
}
