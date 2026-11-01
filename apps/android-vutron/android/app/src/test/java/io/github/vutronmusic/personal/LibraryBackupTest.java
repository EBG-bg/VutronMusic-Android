package io.github.vutronmusic.personal;
import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;

public class LibraryBackupTest {
    @Test public void localPlaylistOrderRemapsToRestoredIdsAndKeepsOtherAccountScopes() throws Exception {
        JSONObject source=backup(new JSONArray().put(song()));
        source.getJSONArray("collections").getJSONObject(0).put("collectionKey","bundle:old").put("createTime",1234L);
        JSONObject ordering=new JSONObject().put("local:device",new JSONObject().put("mode","custom").put("keys",new JSONArray().put("bundle:old"))
                .put("recent",new JSONObject().put("bundle:old",2345)))
                .put("netease:7",new JSONObject().put("mode","recent").put("keys",new JSONArray()).put("recent",new JSONObject().put("7:99",3456)));
        source.put("frontend",new JSONObject().put("vutron:playlist-orders:v1",ordering.toString()));
        LibraryBackup.RestorePlan plan=LibraryBackup.planRestore(new JSONObject().put("collections",new JSONArray()),source);
        String id=plan.added.get(0).getString("id");
        JSONObject restored=new JSONObject(plan.safe.getJSONObject("frontend").getString("vutron:playlist-orders:v1"));
        assertEquals(id,restored.getJSONObject("local:device").getJSONArray("keys").getString(0));
        assertEquals(2345,restored.getJSONObject("local:device").getJSONObject("recent").getLong(id));
        assertEquals(3456,restored.getJSONObject("netease:7").getJSONObject("recent").getLong("7:99"));
        assertEquals(1234,plan.added.get(0).getLong("createTime"));
        LibraryBackup.RestorePlan repeated=LibraryBackup.planRestore(plan.document,source);
        assertEquals(0,repeated.added.size());
        assertEquals(id,new JSONObject(repeated.safe.getJSONObject("frontend").getString("vutron:playlist-orders:v1")).getJSONObject("local:device").getJSONArray("keys").getString(0));
    }
    @Test public void interfacePreferencesAndOwnerOrdersRoundTripWithoutAccountSecrets() throws Exception {
        JSONObject orders = new JSONObject().put("netease:123",new JSONObject().put("mode","custom")
                .put("keys",new JSONArray().put("123:8").put("123:8").put("/private/audio"))
                .put("recent",new JSONObject().put("123:8",12345).put("123:9",-10)))
                .put("cookie",new JSONObject().put("mode","recent"));
        JSONObject frontend = new JSONObject().put("vutron:font-scale","150").put("vutron:player-lyrics","true")
                .put("vutron:timer-preset","75").put("vutron:playlist-orders:v1",orders.toString()).put("vutron_user","private");
        JSONObject safe = LibraryBackup.safeFrontend(frontend);
        assertEquals("150",safe.getString("vutron:font-scale"));assertEquals("75",safe.getString("vutron:timer-preset"));
        JSONObject restored = new JSONObject(safe.getString("vutron:playlist-orders:v1"));
        assertEquals(1,restored.length());assertEquals(1,restored.getJSONObject("netease:123").getJSONArray("keys").length());
        assertEquals(12345,restored.getJSONObject("netease:123").getJSONObject("recent").getLong("123:8"));
        assertFalse(restored.toString().contains("private"));assertFalse(safe.has("vutron_user"));
        assertEquals(safe.toString(),LibraryBackup.safeFrontend(safe).toString());
        JSONObject invalid=LibraryBackup.safeFrontend(new JSONObject().put("vutron:font-scale","151").put("vutron:timer-preset","18001").put("vutron:player-lyrics","anything"));
        assertEquals(0,invalid.length());
    }
    @Test public void cueFingerprintAndTuningStayPortable() throws Exception {
        JSONObject one=song().put("cueTrackNo",1).put("cueOffsetMs",10000).put("cueDurationMs",1000).put("cueUri","content://private/cue");
        JSONObject two=new JSONObject(one.toString()).put("cueTrackNo",2).put("cueOffsetMs",11000);
        JSONObject portable=LibraryBackup.portableTrack(one);
        assertFalse(portable.has("cueUri"));assertEquals(10000,portable.getLong("cueOffsetMs"));
        assertEquals(LibraryBackup.fingerprint(one),LibraryBackup.fingerprint(portable));
        assertNotEquals(LibraryBackup.fingerprint(one),LibraryBackup.fingerprint(two));
        JSONObject safe=LibraryBackup.safePreferences(new JSONObject().put("playback_tuning",new JSONObject()
                .put("speed",1.5).put("pitch",1.25).put("prefetchWifi",true).put("url","secret")));
        assertEquals(1.5,safe.getJSONObject("playback_tuning").getDouble("speed"),.001);
        assertTrue(safe.getJSONObject("playback_tuning").getBoolean("prefetchWifi"));assertFalse(safe.toString().contains("secret"));
    }
    private JSONObject song() throws Exception { return new JSONObject().put("id", 1).put("name", "Song").put("artists", new JSONArray().put("Artist")).put("album", "Album").put("duration", 1000).put("localUri", "content://private/folder/audio").put("localFileName", "song.flac").put("cookie", "secret"); }
    @Test public void portableTracksExcludePathsCredentialsAndLocalNumericIdentity() throws Exception {
        JSONObject portable = LibraryBackup.portableTrack(song());
        assertFalse(portable.has("id")); assertFalse(portable.has("localUri")); assertFalse(portable.has("cookie"));
        assertFalse(portable.toString().contains("private/folder")); assertEquals("song.flac", portable.getString("fileName"));
        assertEquals(LibraryBackup.fingerprint(song()), LibraryBackup.fingerprint(portable));
    }
    @Test public void preferenceWhitelistRejectsSessionsPathsAndOutOfRangeValues() throws Exception {
        JSONObject source = new JSONObject().put("session", new JSONObject().put("cookie", "secret"))
                .put("audio_cache_settings", new JSONObject().put("enabled", true).put("capacity_mib", 1024).put("index", "private"))
                .put("lyric_overlay", new JSONObject().put("font_size", 999).put("translation", true).put("windowPath", "private"));
        JSONObject safe = LibraryBackup.safePreferences(source);
        assertFalse(safe.has("session")); assertFalse(safe.toString().contains("private")); assertFalse(safe.toString().contains("secret"));
        assertFalse(safe.getJSONObject("lyric_overlay").has("font_size")); assertTrue(safe.getJSONObject("lyric_overlay").getBoolean("translation"));
    }
    private JSONObject backup(JSONArray rows) throws Exception { return new JSONObject().put("format", 1).put("generator", LibraryBackup.GENERATOR)
            .put("collections", new JSONArray().put(new JSONObject().put("name", "List").put("tracks", rows))); }
    @Test public void duplicateSongEntriesKeepIndependentRestorableKeys() throws Exception {
        JSONArray rows = LibraryBackup.validate(backup(new JSONArray().put(song()).put(song()))).getJSONArray("collections").getJSONObject(0).getJSONArray("tracks");
        assertNotEquals(rows.getJSONObject(0).getString("key"), rows.getJSONObject(1).getString("key"));
        assertEquals(LibraryBackup.fingerprint(rows.getJSONObject(0)), LibraryBackup.fingerprint(rows.getJSONObject(1)));
    }
    @Test public void frontendWhitelistCannotImportSessionOrDirectoryValues() throws Exception {
        JSONObject safe = LibraryBackup.safeFrontend(new JSONObject().put("vutron:appearance", "dark").put("vutron:playlist-view", "cards")
                .put("vutron_user", "secret").put("vutron:language", "../../secret").put("vutron:playlist-columns", "999"));
        assertEquals(2, safe.length()); assertFalse(safe.toString().contains("secret"));
    }
    @Test public void wrongBackupSourceIsRejected() throws Exception {
        try { LibraryBackup.validate(backup(new JSONArray()).put("generator", "other")); fail(); } catch (java.io.IOException expected) { }
        try { LibraryBackup.validate(backup(new JSONArray()).put("format", "1")); fail(); } catch (java.io.IOException expected) { }
    }
    @Test public void restoredKeysRemainStableWhenFolderPermissionIsRegranted() throws Exception {
        JSONObject unavailable = song().put("localPlaylistId", "restored:one").put("localEntryKey", "key"); unavailable.remove("localUri");
        JSONObject available = new JSONObject(unavailable.toString()).put("localUri", "content://new-permission/file");
        assertEquals(LocalLibraryIds.key(unavailable), LocalLibraryIds.key(available)); assertTrue(LocalLibraryIds.same(unavailable, available));
    }
}
