package io.github.vutronmusic.personal;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class PluginTrackAdapterTest {
    @Test public void idsAreStableSafeAndSeparatedBySourceAndInstance() throws Exception {
        long first = PluginTrackAdapter.id("navidrome", "song:abc");
        assertEquals(first, PluginTrackAdapter.id("navidrome", "song:abc"));
        assertTrue(first >= (1L<<52)); assertTrue(first < (1L<<53));
        assertNotEquals(first, PluginTrackAdapter.id("navidrome:home", "song:abc"));
        assertNotEquals(first, PluginTrackAdapter.id("netease", "song:abc"));
    }
    @Test public void contextAndStringIdsAreOpaqueAndOriginalIsUnchanged() throws Exception {
        JSONObject context = new JSONObject().put("providerSecretField", "opaque").put("nested",new JSONObject().put("id","foo"));
        JSONObject raw = new JSONObject().put("id","song:abc").put("name","Track").put("duration",120000)
                .put("sourceContext",context).put("artists",new JSONArray().put(new JSONObject().put("id","a").put("name","Artist")));
        String original = raw.toString();
        JSONObject value = PluginTrackAdapter.track("navidrome:home",raw);
        assertEquals(original,raw.toString());
        assertEquals("song:abc",value.getString("pluginTrackId"));
        assertEquals(context.toString(),value.getJSONObject("pluginSourceContext").toString());
        assertEquals("Artist",value.getJSONArray("artists").getString(0));
    }
    @Test public void pluginLyricsKeepSecondsForLinesAndMillisecondsForRealWords() throws Exception {
        JSONArray lines = new JSONArray().put(new JSONObject().put("start",1.5).put("end",3)
                .put("lyric",new JSONObject().put("text","Hello world").put("info",new JSONArray()
                        .put(new JSONObject().put("start",1500).put("end",2100).put("word","Hello "))
                        .put(new JSONObject().put("start",2100).put("end",3000).put("word","world"))))
                .put("tlyric",new JSONObject().put("text","译文")));
        LyricTimeline timeline = LyricTimeline.fromPlugin(lines,"lyric");
        assertEquals(1500,timeline.lines.get(0).time);
        assertEquals(1500,timeline.lines.get(0).duration);
        assertEquals(2,timeline.lines.get(0).words.size());
        assertEquals(2100,timeline.lines.get(0).words.get(1).start);
        assertEquals("译文",new LyricRepository.Lyrics(timeline,LyricTimeline.fromPlugin(lines,"tlyric"),true).translationAt(0));
    }
    @Test public void pluginIdsNeverReachTheNetEaseLyricEndpoint() throws Exception {
        JSONObject raw=new JSONObject().put("id",1).put("pluginId","navidrome").put("cached",true);
        assertEquals(0,LyricOverlaySettings.remoteLyricId(raw));
        assertEquals("plugin:1",LyricOverlaySettings.trackIdentity(raw));
    }
    @Test public void longPublicPlaylistIdsKeepSeparatePortableBookmarkKeys() throws Exception {
        String plugin="p".repeat(64)+":"+"i".repeat(48),account="a".repeat(64),raw="opaque-playlist:"+"x".repeat(1000);
        String key=PluginTrackAdapter.playlistKey(plugin,account,raw);
        assertTrue(key.length()<=256);
        assertFalse(PlaylistProgress.key(PluginTrackAdapter.playlistScope(plugin,account),key).isEmpty());
        assertNotEquals(key,PluginTrackAdapter.playlistKey(plugin,"b".repeat(64),raw));
        JSONObject original=new JSONObject().put("id","track:opaque").put("sourceContext",new JSONObject());
        JSONObject bookmark=PlaylistProgress.bookmark(PluginTrackAdapter.track(plugin,original,account),12345,30000,1);
        assertEquals("track:opaque",bookmark.getString("pluginTrackId"));
        assertEquals(plugin,bookmark.getString("pluginId"));
        assertEquals(12345,bookmark.getLong("position"));
    }
}
