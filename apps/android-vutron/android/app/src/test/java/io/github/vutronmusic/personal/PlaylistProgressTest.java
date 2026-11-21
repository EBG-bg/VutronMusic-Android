package io.github.vutronmusic.personal;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class PlaylistProgressTest {
    @Test public void accountsAndLocalCollectionsHaveSeparateBookmarks() {
        assertNotEquals(PlaylistProgress.key("netease:7", "netease:8"), PlaylistProgress.key("netease:9", "netease:8"));
        assertNotEquals(PlaylistProgress.key("local:device", "folder:1"), PlaylistProgress.key("local:device", "folder:2"));
        assertEquals("", PlaylistProgress.key("netease:0", "netease:8"));
        assertEquals("", PlaylistProgress.key("local:device", ""));
    }
    @Test public void matchedAudioRetainsOnlineSongIdentityAndNoPaths() throws Exception {
        JSONObject track = new JSONObject().put("id", 123).put("neteaseId", 456)
                .put("localUri", "content://private/audio").put("cookie", "private");
        JSONObject saved = PlaylistProgress.bookmark(track, 12000, 60000, 9);
        assertEquals(456, saved.getLong("trackId"));
        assertEquals(12000, saved.getLong("position"));
        assertFalse(saved.has("localUri")); assertFalse(saved.has("cookie"));
    }
    @Test public void offlinePluginBookmarksKeepOnlyTheGeneratedRowIdentity() throws Exception {
        String hash = "1".repeat(64);
        JSONObject track = new JSONObject().put("id", 123).put("source", "plugin-snapshot");
        for (int row : new int[]{0, 2}) {
            String key = PluginPlaylistCache.rowKey(hash, row);
            track.put("localEntryKey", key);
            JSONObject point = PlaylistProgress.bookmark(track, 32000, 60000, 9);
            assertEquals(123, point.getLong("trackId"));
            assertEquals(key, point.getString("localEntryKey"));
        }
        track.put("localEntryKey", "content://private/audio");
        assertFalse(PlaylistProgress.bookmark(track, 12000, 60000, 9).has("localEntryKey"));
        track.put("source", "local").put("localEntryKey", PluginPlaylistCache.rowKey(hash, 2));
        assertFalse(PlaylistProgress.bookmark(track, 12000, 60000, 9).has("localEntryKey"));
    }

    @Test public void cueTracksRetainSegmentIdentityAndClampPosition() throws Exception {
        JSONObject track = new JSONObject().put("id", 123).put("cueTrackNo", 2);
        JSONObject saved = PlaylistProgress.bookmark(track, 90000, 60000, 9);
        assertEquals(2, saved.getInt("cueTrackNo"));
        assertEquals(59999, saved.getLong("position"));
        assertEquals(0, PlaylistProgress.bookmark(track, -1, 60000, 9).length());
        assertEquals(0, PlaylistProgress.bookmark(track, 12, 0, 9).length());
        track.put("neteaseId", 0);
        assertEquals(123, PlaylistProgress.bookmark(track, 12, 60000, 9).getLong("trackId"));
    }
}
