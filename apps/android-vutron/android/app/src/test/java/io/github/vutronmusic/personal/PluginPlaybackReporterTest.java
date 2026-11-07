package io.github.vutronmusic.personal;

import org.json.JSONObject;
import org.json.JSONArray;
import org.junit.Test;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import static org.junit.Assert.*;

public class PluginPlaybackReporterTest {
    private static JSONObject song() throws Exception {
        return new JSONObject().put("pluginId","emby:home").put("pluginAccountScope","scope-self").put("pluginTrackId","track")
                .put("pluginSourceContext",new JSONObject().put("id","track").put("sourceId","opaque-source"))
                .put("pluginPlaylistContext",new JSONObject().put("id","playlist"));
    }
    @Test public void reportFailureDoesNotSuppressQualifiedScrobble() throws Exception {
        JSONObject original=song();String before=original.toString();
        List<String> calls=new ArrayList<>(),failures=new ArrayList<>();
        PluginPlaybackReporter.dispatch(original,"end",31500,120000,false,(method,params) -> {
            calls.add(method);
            assertEquals("opaque-source",params.getString("sourceId"));
            if (method.equals("reportPlayback")) {
                assertEquals(31.5,params.getDouble("position"),0.0001);assertEquals(120,params.getDouble("duration"),0.0001);
                throw new IOException("Synthetic report failure");
            }
            assertEquals(31500,params.getLong("time"));
            assertEquals("playlist",params.getJSONObject("sourceCtx").getJSONObject("sourceContext").getString("id"));
        },(method,error) -> failures.add(method));
        assertEquals(java.util.Arrays.asList("reportPlayback","scrobble"),calls);
        assertEquals(java.util.Collections.singletonList("reportPlayback"),failures);
        assertEquals(before,original.toString());
    }
    @Test public void failuresAreIndependentAndShortOrActivePlaybackIsNotScrobbled() throws Exception {
        List<String> calls=new ArrayList<>(),failures=new ArrayList<>();
        PluginPlaybackReporter.dispatch(song(),"end",70000,120000,false,(method,params) -> {
            calls.add(method);throw new IOException("Synthetic failure");
        },(method,error) -> failures.add(method));
        assertEquals(java.util.Arrays.asList("reportPlayback","scrobble"),failures);
        calls.clear();
        PluginPlaybackReporter.dispatch(song(),"end",1000,120000,false,(method,params) -> calls.add(method),(method,error) -> fail());
        PluginPlaybackReporter.dispatch(song(),"progress",60000,120000,true,(method,params) -> calls.add(method),(method,error) -> fail());
        assertEquals(java.util.Arrays.asList("reportPlayback","reportPlayback"),calls);
        assertFalse(PluginPlaybackReporter.shouldScrobble(30000,0));
        assertTrue(PluginPlaybackReporter.shouldScrobble(5000,10000));
    }
    @Test public void linkedSourcesReceiveTheirOpaqueContextOnceAndKeepThePlaybackPlaylist() throws Exception {
        JSONObject original=song();String before=original.toString();
        JSONArray linked=new JSONArray()
                .put(new JSONObject().put("pluginId","emby:home").put("accountScope","scope-self").put("sourceContext",new JSONObject().put("id","duplicate-self")))
                .put(new JSONObject().put("pluginId","netease").put("accountScope","scope-linked").put("sourceContext",new JSONObject().put("id","linked-id").put("opaque",42)));
        List<String> calls=new ArrayList<>(),failures=new ArrayList<>();
        PluginPlaybackReporter.broadcast(original,linked,"end",70000,120000,false,(target,method,params)->{
            String id=target.getString("pluginId");calls.add(id+":"+method);
            assertEquals(id.equals("netease")?"linked-id":"track",params.getString("id"));
            if(method.equals("scrobble")) {
                assertEquals("emby:home",params.getJSONObject("sourceCtx").getString("plugin"));
                assertEquals("playlist",params.getJSONObject("sourceCtx").getJSONObject("sourceContext").getString("id"));
                assertEquals(70000,params.getLong("time"));
            }
            if(id.equals("emby:home")&&method.equals("reportPlayback"))throw new IOException("Self report failed");
        },(method,error)->failures.add(method));
        assertEquals(java.util.Arrays.asList("emby:home:reportPlayback","emby:home:scrobble","netease:reportPlayback","netease:scrobble"),calls);
        assertEquals(java.util.Collections.singletonList("reportPlayback"),failures);
        assertEquals(before,original.toString());
    }
    @Test public void eachMethodRequiresAnEnabledCurrentAccountAndSupportedCapability() throws Exception {
        JSONObject target=new JSONObject().put("pluginId","emby:home").put("accountScope","scope-self");
        JSONObject plugin=new JSONObject().put("id","emby:home").put("accountScope","scope-self").put("type","stream").put("enabled",true)
                .put("methods",new JSONArray().put("reportPlayback").put("scrobble")).put("unsupportedMethods",new JSONArray().put("scrobble"));
        assertTrue(PluginPlaybackReporter.eligible(target,plugin,"reportPlayback",true));
        assertFalse(PluginPlaybackReporter.eligible(target,plugin,"scrobble",true));
        assertFalse(PluginPlaybackReporter.eligible(target,plugin,"reportPlayback",false));
        plugin.put("type","local");assertTrue(PluginPlaybackReporter.eligible(target,plugin,"reportPlayback",false));
        plugin.put("enabled",false);assertFalse(PluginPlaybackReporter.eligible(target,plugin,"reportPlayback",true));
        plugin.put("enabled",true).put("accountScope","another-account");assertFalse(PluginPlaybackReporter.eligible(target,plugin,"reportPlayback",true));
        assertFalse(PluginPlaybackReporter.eligible(target,null,"reportPlayback",true));
    }
}
