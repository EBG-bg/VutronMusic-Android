package io.github.vutronmusic.personal;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.io.IOException;
import static org.junit.Assert.*;

public class PortableAccountsTest {
    private JSONObject row(String base) throws Exception {
        return new JSONObject().put("id", base + ":home").put("baseId", base).put("name", "Home").put("enabled", true)
            .put("baseUrl", "https://music.example/library").put("account", new JSONObject().put("userId", "test-user").put("userName", "Test")
            .put("token", "test-token").put("cookie", "MUSIC_U=fixture").put("nativeToken", "test-native-token").put("pwd", "test-password").put("clientId", "fixture-client"));
    }
    private JSONObject document(JSONArray plugins) throws Exception { return new JSONObject().put("version", 1).put("plugins", plugins); }

    @Test public void onlyRequiredCredentialsTravelWithEachPlugin() throws Exception {
        for (String base : new String[]{"netease", "kugou", "emby", "jellyfin", "navidrome"}) {
            JSONObject raw = row(base).put("sourceCode", "never").put("resources", new JSONObject());
            raw.getJSONObject("account").put("privatePath", "never");
            JSONObject safe = PortableAccounts.prepare(null, document(new JSONArray().put(raw))).plugins.getJSONObject(0);
            assertFalse(safe.toString().contains("never"));
            JSONObject auth = safe.getJSONObject("account");
            assertEquals(base.equals("navidrome"), auth.has("pwd"));
            assertEquals(base.equals("navidrome"), auth.has("nativeToken"));
            assertEquals(base.equals("netease"), auth.has("cookie"));
            assertEquals(!(base.equals("navidrome") || base.equals("netease")), auth.has("token"));
        }
    }
    @Test public void invalidPayloadNeverEchoesPrivateValuesAndUnknownPluginsAreSkipped() throws Exception {
        JSONObject unknown = new JSONObject().put("id", "other").put("baseId", "thirdparty");
        assertEquals(1, PortableAccounts.prepare(null, document(new JSONArray().put(unknown))).skipped);
        JSONObject malformed = row("emby").put("account", "test-password");
        try { PortableAccounts.prepare(null, document(new JSONArray().put(malformed))); fail(); }
        catch (IOException expected) { assertFalse(expected.toString().contains("test-password")); }
        JSONObject expired = row("navidrome"); expired.getJSONObject("account").put("nativeToken", "");
        try { PortableAccounts.prepare(null, document(new JSONArray().put(expired))); fail(); } catch(IOException expected) { }
        JSONObject forged = row("kugou").put("id", "another:home");
        try { PortableAccounts.prepare(null, document(new JSONArray().put(forged))); fail(); } catch(IOException expected) { }
        JSONObject duplicate = row("emby");
        try { PortableAccounts.prepare(null, document(new JSONArray().put(duplicate).put(duplicate))); fail(); } catch(IOException expected) { }
    }
    @Test public void sessionIsBoundToOriginalServerAndLocalDataSurvivesOnlyForSameOwner() throws Exception {
        JSONObject row = PortableAccounts.pluginRow(row("emby"));
        JSONObject old = new JSONObject().put("store", new JSONObject().put("baseUrl", row.getString("baseUrl")))
            .put("db", new JSONObject().put("PluginData", new JSONObject().put("userId", "test-user").put("token", "old")).put("Track", new JSONArray().put("old-private-track")));
        JSONObject same = PortableAccounts.restoredState(row, new JSONObject(old.toString()));
        assertTrue(same.getJSONObject("db").has("Track"));
        assertEquals("test-token", same.getJSONObject("db").getJSONObject("PluginData").getString("token"));
        row.put("baseUrl", "https://other.example");
        assertFalse(PortableAccounts.restoredState(row, old).toString().contains("old-private-track"));
        JSONObject device = row("kugou").put("kugouDevice", new JSONObject().put("dfid", "test-id").put("unrelated", "omit"));
        assertEquals(1, PortableAccounts.pluginRow(device).getJSONObject("kugouDevice").length());
    }
    @Test public void validatedMainSessionDropsExtraProfileAndNeverCreatesLoggedOutAccounts() throws Exception {
        JSONObject doc = document(new JSONArray());
        assertFalse(PortableAccounts.hasAccounts(doc));
        assertNull(PortableAccounts.prepare(null, doc).main);
        JSONObject profile = new JSONObject().put("userId", 42).put("nickname", "Test").put("private", "omit");
        doc.put("netease", new JSONObject().put("profile", profile).put("cookie", "MUSIC_U=fixture"));
        assertTrue(PortableAccounts.hasAccounts(doc));
        assertFalse(PortableAccounts.prepare(null, doc).main.toString().contains("omit"));
        doc.getJSONObject("netease").put("cookie", "line\r\nbreak");
        try { PortableAccounts.prepare(null, doc); fail(); } catch(IOException expected) { }
    }
}
