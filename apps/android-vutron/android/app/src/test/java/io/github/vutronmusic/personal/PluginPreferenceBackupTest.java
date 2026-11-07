package io.github.vutronmusic.personal;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class PluginPreferenceBackupTest {
    private JSONObject backup() throws Exception {
        return new JSONObject().put("format",1).put("generator",LibraryBackup.GENERATOR).put("collections",new JSONArray());
    }
    @Test public void backupRetainsOnlyPortablePrioritiesAndNeverExportsSourceContexts() throws Exception {
        JSONObject raw=backup().put("pluginSourcePriorities",new JSONObject()
                .put("lyric",new JSONArray().put("self").put("emby:home").put("self"))
                .put("comment",new JSONArray().put("netease"))
                .put("groups",new JSONArray().put(new JSONObject().put("authorization","private"))));
        JSONObject priorities=LibraryBackup.validate(raw).getJSONObject("pluginSourcePriorities");
        assertEquals(2,priorities.getJSONArray("lyric").length());
        assertEquals("emby:home",priorities.getJSONArray("lyric").getString(1));
        assertFalse(priorities.has("groups"));
        assertFalse(priorities.toString().contains("private"));
    }
    @Test public void olderBackupsDoNotResetExistingSourcePriorities() throws Exception {
        assertEquals(0,LibraryBackup.validate(backup()).getJSONObject("pluginSourcePriorities").length());
    }
    @Test public void dismissingPlaylistSortHintsIsPortableAndTypeChecked() throws Exception {
        JSONObject value=LibraryBackup.safeFrontend(new JSONObject().put("vutron:playlist-sort-hints","false"));
        assertEquals("false",value.getString("vutron:playlist-sort-hints"));
        assertFalse(LibraryBackup.safeFrontend(new JSONObject().put("vutron:playlist-sort-hints","sometimes")).has("vutron:playlist-sort-hints"));
    }
    @Test public void sourceTrackVolumeBacksUpByOpaqueNumericIdentityWithoutAccountData() throws Exception {
        JSONObject settings=new JSONObject().put("playback_volume",new JSONObject().put("plugin:4503599627370999",73).put("cookie","private"));
        JSONObject saved=LibraryBackup.safePreferences(settings).getJSONObject("playback_volume");
        assertEquals(73,saved.getInt("plugin:4503599627370999"));
        assertFalse(saved.has("cookie"));
    }
    @Test(expected=java.io.IOException.class) public void invalidPriorityIsRejectedBeforeRestoringAnyFiles() throws Exception {
        LibraryBackup.validate(backup().put("pluginSourcePriorities",new JSONObject().put("lyric",new JSONArray().put("../account.json"))));
    }
}
