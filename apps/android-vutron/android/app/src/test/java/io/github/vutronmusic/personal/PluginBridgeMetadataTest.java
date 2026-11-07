package io.github.vutronmusic.personal;

import org.json.JSONObject;
import org.junit.Test;
import java.lang.reflect.Method;
import static org.junit.Assert.*;

public class PluginBridgeMetadataTest {
    @Test public void nativePlaybackAndCacheRowsRetainAuthenticatedVirtualArtwork() throws Exception {
        String cover="vutron://get-plugin-asset?plugin=emby&type=pic&id=album%3A7";
        JSONObject original=new JSONObject().put("id","song:1").put("name","Song").put("picUrl",cover)
                .put("sourceContext",new JSONObject().put("opaque","server-value"));
        JSONObject track=PluginTrackAdapter.track("emby",original,"account-a");
        Method serialize=VutronMusicPlugin.class.getDeclaredMethod("track",JSONObject.class);serialize.setAccessible(true);
        JSONObject row=(JSONObject)serialize.invoke(null,track);
        assertEquals(cover,row.getString("picUrl"));
        assertEquals("account-a",row.getString("pluginAccountScope"));
        assertEquals(original.toString(),row.getJSONObject("pluginTrack").toString());
        assertEquals("server-value",row.getJSONObject("pluginSourceContext").getString("opaque"));
    }
}
