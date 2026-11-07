package io.github.vutronmusic.personal;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import static org.junit.Assert.*;

public class PluginSourceMatchingTest {
    @Rule public TemporaryFolder temporary=new TemporaryFolder();
    private JSONObject track(String id) throws Exception {return new JSONObject().put("id",id).put("name","Song").put("duration",180000)
            .put("album",new JSONObject().put("name","Album")).put("artists",new JSONArray().put(new JSONObject().put("name","Artist")))
            .put("sourceContext",new JSONObject().put("opaque",id));}
    private JSONObject plugin(String id,String type,String mode) throws Exception {return new JSONObject().put("id",id).put("type",type).put("enabled",true)
            .put("accountScope",id+"-account").put("methods",new JSONArray().put("matchTrack").put("getTrackDetail"))
            .put("capabilities",new JSONObject().put("matchTrack",mode));}
    private JSONArray installed() throws Exception{return new JSONArray().put(plugin("local","local",""))
            .put(plugin("netease","library","official")).put(plugin("kugou","library","search"));}
    private static class Fake implements PluginSourceMatching.Calls {
        boolean online=true;final Map<String,String> scopes=new HashMap<>();final Map<String,JSONObject> responses=new HashMap<>();
        final List<JSONObject> calls=new ArrayList<>();final List<String> failures=new ArrayList<>();Runnable duringCall;
        Fake(){for(String id:new String[]{"local","netease","kugou"})scopes.put(id,id+"-account");}
        @Override public JSONObject call(String id,String method,JSONObject params) throws Exception {
            calls.add(new JSONObject().put("pluginId",id).put("method",method).put("params",new JSONObject(params.toString())));
            if(duringCall!=null)duringCall.run();JSONObject response=responses.get(id+":"+method);
            if(response==null)throw new java.io.IOException("synthetic provider failure");return new JSONObject(response.toString());
        }
        @Override public String accountScope(String id){return scopes.get(id);}
        @Override public boolean networkAllowed(){return online;}
        @Override public void failure(String id,Exception error){failures.add(id);}
    }
    private JSONObject match(String id,double confidence) throws Exception{return new JSONObject().put("code",200).put("data",track(id).put("confidence",confidence));}

    @Test public void matchesOnlyEligibleLibrariesAndPersistsOfficialAndSearchThresholds() throws Exception {
        PluginSourceRegistry registry=new PluginSourceRegistry(temporary.newFolder());Fake api=new Fake();
        api.responses.put("netease:matchTrack",match("n1",1));api.responses.put("kugou:matchTrack",match("k1",65));
        PluginSourceMatching matcher=new PluginSourceMatching(registry,api);JSONObject original=track("local1");String before=original.toString();
        JSONArray result=matcher.match("local","local-account",original,installed());
        assertEquals(2,result.length());assertEquals(1,result.getJSONObject(0).getInt("matched"));assertEquals(0,result.getJSONObject(1).getInt("matched"));
        assertEquals(3,registry.sources("local","local-account",original).length());assertEquals(before,original.toString());
        assertEquals("Artist",api.calls.get(0).getJSONObject("params").getJSONArray("artists").getString(0));
        assertEquals("Album",api.calls.get(0).getJSONObject("params").getString("album"));
    }
    @Test public void existingAssociationsSkipRequestsOnLaterMatchesAndLowConfidenceIsNotPersisted() throws Exception {
        PluginSourceRegistry registry=new PluginSourceRegistry(temporary.newFolder());Fake api=new Fake();
        api.responses.put("netease:matchTrack",match("n1",100));api.responses.put("kugou:matchTrack",match("k1",49));
        PluginSourceMatching matcher=new PluginSourceMatching(registry,api);matcher.match("local","local-account",track("local1"),installed());
        assertEquals(2,registry.sources("local","local-account",track("local1")).length());
        api.calls.clear();matcher.match("local","local-account",track("local1"),installed());
        assertEquals(1,api.calls.size());assertEquals("kugou",api.calls.get(0).getString("pluginId"));
    }
    @Test public void offlineDisabledUnsupportedAndLibraryOriginsDoNotStartMatching() throws Exception {
        PluginSourceRegistry registry=new PluginSourceRegistry(temporary.newFolder());Fake api=new Fake();PluginSourceMatching matcher=new PluginSourceMatching(registry,api);
        api.online=false;assertEquals(0,matcher.match("local","local-account",track("local1"),installed()).length());
        api.online=true;assertEquals(0,matcher.match("netease","netease-account",track("n1"),installed()).length());
        JSONArray plugins=installed();plugins.getJSONObject(1).put("enabled",false);plugins.getJSONObject(2).put("unsupportedMethods",new JSONArray().put("matchTrack"));
        assertEquals(0,matcher.match("local","local-account",track("local1"),plugins).length());assertEquals(0,api.calls.size());
        JSONArray disabledOwner=installed();disabledOwner.getJSONObject(0).put("enabled",false);
        assertEquals(0,matcher.match("local","local-account",track("local1"),disabledOwner).length());assertEquals(0,api.calls.size());
    }
    @Test public void failuresKeepEarlierSourcesAndDoNotStopTheNextProvider() throws Exception {
        PluginSourceRegistry registry=new PluginSourceRegistry(temporary.newFolder());Fake api=new Fake();api.responses.put("kugou:matchTrack",match("k1",90));
        JSONArray result=new PluginSourceMatching(registry,api).match("local","local-account",track("local1"),installed());
        assertEquals(1,result.length());assertEquals("kugou",result.getJSONObject(0).getString("pluginId"));assertEquals("netease",api.failures.get(0));
        assertEquals(2,registry.sources("local","local-account",track("local1")).length());
    }
    @Test public void accountChangesDuringRequestsCannotPersistResultsUnderOldAccounts() throws Exception {
        PluginSourceRegistry registry=new PluginSourceRegistry(temporary.newFolder());Fake api=new Fake();api.responses.put("netease:matchTrack",match("n1",100));
        api.duringCall=()->api.scopes.put("netease","changed-account");
        new PluginSourceMatching(registry,api).match("local","local-account",track("local1"),installed());
        assertEquals(1,registry.sources("local","local-account",track("local1")).length());
        api.duringCall=null;api.scopes.put("local","changed-local");
        try{new PluginSourceMatching(registry,api).match("local","local-account",track("local1"),installed());fail();}catch(java.io.IOException expected){}
    }
    @Test public void opaqueContextIsSpreadExactlyAsDesktopAndDoesNotNeedAnIdField() throws Exception {
        JSONObject source=track("local1"),context=source.getJSONObject("sourceContext");
        context.put("md5","synthetic-hash").put("name","Provider-owned title").put("nested",new JSONObject().put("keep",true));
        JSONObject params=PluginSourceMatching.parameters(source);
        assertEquals("Provider-owned title",params.getString("name"));assertEquals("synthetic-hash",params.getString("md5"));
        assertEquals(context.getJSONObject("nested").toString(),params.getJSONObject("nested").toString());assertFalse(context.has("id"));
    }
    @Test public void missingPublicIdsUseGetTrackDetailWithoutReadingOpaqueIdFields() throws Exception {
        PluginSourceRegistry registry=new PluginSourceRegistry(temporary.newFolder());Fake api=new Fake();
        JSONObject opaque=new JSONObject().put("id","not-a-public-track-id").put("any","opaque");
        api.responses.put("netease:matchTrack",new JSONObject().put("code",200).put("data",new JSONObject().put("confidence",100).put("sourceContext",opaque)));
        api.responses.put("netease:getTrackDetail",new JSONObject().put("code",200).put("data",new JSONArray().put(track("public-track-id"))));
        JSONArray result=new PluginSourceMatching(registry,api).match("local","local-account",track("local1"),installed());
        assertEquals("public-track-id",result.getJSONObject(0).getString("trackId"));
        assertEquals(opaque.toString(),api.calls.get(1).getJSONObject("params").getJSONArray("tracks").getJSONObject(0).toString());
    }
    @Test public void simultaneousFrontendAndOverlayRequestsReuseTheFirstSuccessfulAssociation() throws Exception {
        PluginSourceRegistry registry=new PluginSourceRegistry(temporary.newFolder());Fake api=new Fake();api.responses.put("netease:matchTrack",match("n1",100));
        JSONArray plugins=installed();plugins.getJSONObject(2).put("enabled",false);
        java.util.concurrent.CountDownLatch entered=new java.util.concurrent.CountDownLatch(1),release=new java.util.concurrent.CountDownLatch(1),secondStarted=new java.util.concurrent.CountDownLatch(1);
        api.duringCall=()->{entered.countDown();try{if(!release.await(3,java.util.concurrent.TimeUnit.SECONDS))throw new IllegalStateException("test timed out");}catch(InterruptedException error){Thread.currentThread().interrupt();throw new IllegalStateException(error);}};
        java.util.concurrent.ExecutorService executor=java.util.concurrent.Executors.newFixedThreadPool(2);PluginSourceMatching matcher=new PluginSourceMatching(registry,api);
        try {
            java.util.concurrent.Future<JSONArray> first=executor.submit(()->matcher.match("local","local-account",track("local1"),plugins));
            assertTrue(entered.await(2,java.util.concurrent.TimeUnit.SECONDS));
            java.util.concurrent.Future<JSONArray> second=executor.submit(()->{secondStarted.countDown();return matcher.match("local","local-account",track("local1"),plugins);});
            assertTrue(secondStarted.await(2,java.util.concurrent.TimeUnit.SECONDS));
            // Give the second caller a scheduling opportunity while the provider is blocked.
            Thread.sleep(75);assertEquals(1,api.calls.size());release.countDown();
            assertEquals(1,first.get(3,java.util.concurrent.TimeUnit.SECONDS).length());assertEquals(0,second.get(3,java.util.concurrent.TimeUnit.SECONDS).length());
            assertEquals(1,api.calls.size());
        } finally {release.countDown();executor.shutdownNow();}
    }
}
