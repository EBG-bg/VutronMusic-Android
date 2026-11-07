package io.github.vutronmusic.personal;

import org.junit.Test;
import java.io.IOException;
import org.json.JSONObject;
import static org.junit.Assert.*;

public class AndroidPluginManagerTest {
    @Test public void pluginAndInstanceIdentitiesRemainOwnedFileNames() throws Exception {
        assertEquals("navidrome", AndroidPluginManager.identity("navidrome"));
        assertEquals("navidrome:home_1", AndroidPluginManager.identity("navidrome:home_1"));
        for (String invalid : new String[]{"../session", "/data/private", "a/b", "C:\\private", "a:b:c", "", "a?query"}) {
            try { AndroidPluginManager.identity(invalid); fail(invalid); }
            catch (IOException expected) { assertTrue(expected.getMessage().contains("PLUGIN_ID")); }
        }
    }
    @Test public void accountScopesSeparateServersAndUsersButIgnorePasswordsAndRotatedTokens() throws Exception {
        JSONObject first = new JSONObject().put("userId", "7").put("pwd", "secret-one").put("token", "token-one");
        JSONObject renewed = new JSONObject().put("userId", "7").put("pwd", "secret-two").put("token", "token-two");
        String same = AndroidPluginManager.accountFingerprint("emby", false, "https://host/library", first, 1);
        assertEquals(same, AndroidPluginManager.accountFingerprint("emby", false, "https://host:443/library/", renewed, 9));
        assertNotEquals(same, AndroidPluginManager.accountFingerprint("emby", false, "https://other/library", first, 1));
        assertNotEquals(same, AndroidPluginManager.accountFingerprint("emby", false, "https://host/library", new JSONObject().put("userId", "8"), 1));
        assertNotEquals(same, AndroidPluginManager.accountFingerprint("emby:other", false, "https://host/library", first, 1));
        assertEquals(64, same.length()); assertFalse(same.contains("secret"));
        assertEquals(AndroidPluginManager.accountFingerprint("emby", false, "https://host", first, 1), AndroidPluginManager.accountFingerprint("emby", false, "https://host/", renewed, 2));
    }
    @Test public void localScopeIsConstantAndUnknownAccountsCannotReuseAnOldLoginGeneration() throws Exception {
        assertEquals(AndroidPluginManager.accountFingerprint("local", true, "", new JSONObject(), 1), AndroidPluginManager.accountFingerprint("local", true, "https://unused", new JSONObject().put("userId", 9), 2));
        assertNotEquals(AndroidPluginManager.accountFingerprint("custom", false, "https://host", new JSONObject(), 1), AndroidPluginManager.accountFingerprint("custom", false, "https://host", new JSONObject(), 2));
    }
    @Test public void embeddedAndPathLyricResourcesNeverAliasOneAnother() throws Exception {
        LyricRepository.Lyrics path = new LyricRepository.Lyrics(new JSONObject().put("lrc","[00:01.00]Sidecar"),true);
        LyricRepository.Lyrics embedded = new LyricRepository.Lyrics(new JSONObject().put("lrc","[00:02.00]Embedded"),true);
        JSONObject values=AndroidPluginManager.lyricResources("content://authorized/Song.mp3",path,embedded);
        JSONObject audio=values.getJSONObject("content://authorized/Song.mp3"),sidecar=values.getJSONObject("content://authorized/Song.lrc");
        assertFalse(audio.has("pathLyrics"));assertFalse(sidecar.has("embeddedLyrics"));
        assertEquals("Embedded",audio.getJSONArray("embeddedLyrics").getJSONObject(0).getJSONObject("lyric").getString("text"));
        assertEquals("Sidecar",sidecar.getJSONArray("pathLyrics").getJSONObject(0).getJSONObject("lyric").getString("text"));
        assertEquals(2,audio.getJSONArray("embeddedLyrics").getJSONObject(0).getDouble("start"),0.0001);
        JSONObject noEmbedded=AndroidPluginManager.lyricResources("content://authorized/Song.mp3",path,null);
        assertEquals(0,noEmbedded.getJSONObject("content://authorized/Song.mp3").getJSONArray("embeddedLyrics").length());
    }
}
