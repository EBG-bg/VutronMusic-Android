package io.github.vutronmusic.personal;

import org.json.JSONObject;
import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

public class TrackSourceOverridesTest {
    @Test public void backupKeepsOnlyPositiveTrackIdsAndSupportedProviders() throws Exception {
        JSONObject source = new JSONObject().put("format", 1).put("overrides", new JSONObject()
                .put("42", "kugou")
                .put("0", "kuwo")
                .put("-1", "qq")
                .put("not-an-id", "migu")
                .put("43", "unknown")
                .put("44", ""));

        JSONObject safe = TrackSourceOverrides.sanitize(source);
        JSONObject overrides = safe.getJSONObject("overrides");
        assertEquals(1, overrides.length());
        assertEquals("kugou", overrides.getString("42"));
        assertFalse(safe.toString().contains("unknown"));
    }

    @Test public void rejectsUnknownBackupFormat() throws Exception {
        try {
            TrackSourceOverrides.sanitize(new JSONObject().put("format", 2).put("overrides", new JSONObject()));
        } catch (java.io.IOException expected) {
            return;
        }
        throw new AssertionError("Unknown source-choice backup format must be rejected");
    }
}
