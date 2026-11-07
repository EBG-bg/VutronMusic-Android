package io.github.vutronmusic.personal;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import static org.junit.Assert.*;

public class PluginSourceRegistryTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private JSONObject track(String id) throws Exception {
        return new JSONObject().put("id",id).put("sourceContext",new JSONObject().put("opaque",id).put("nested",new JSONObject().put("cursor","untouched")));
    }
    private JSONObject plugin(String id,String type,String scope) throws Exception {
        return new JSONObject().put("id",id).put("type",type).put("enabled",true).put("accountScope",scope)
                .put("methods",new JSONArray().put("getLyric").put("getComments"))
                .put("capabilities",new JSONObject().put("getLyric",true).put("getComments",true));
    }
    private JSONArray installed(String ownerType) throws Exception {
        return new JSONArray().put(plugin("local",ownerType,"local-account")).put(plugin("netease","library","online-account"))
                .put(plugin("kugou","library","other-account"));
    }
    private JSONArray candidates(PluginSourceRegistry registry,String kind,String ownerType) throws Exception {
        return registry.candidates("local","local-account","local-track",track("local-track").getJSONObject("sourceContext"),kind,installed(ownerType));
    }
    @Test public void explicitLinksSurviveRestartAndPreserveOpaqueObjectsWithoutChangingInputs() throws Exception {
        java.io.File folder=temporary.newFolder(); PluginSourceRegistry registry=new PluginSourceRegistry(folder);
        JSONObject own=track("local-track"),remote=track("online-track"); String before=remote.toString();
        registry.link("local","local-account",own,"netease","online-account",remote,1);
        JSONArray rows=new PluginSourceRegistry(folder).sources("local","local-account",own);
        assertEquals(2,rows.length()); assertEquals(before,remote.toString());
        assertEquals(remote.getJSONObject("sourceContext").toString(),rows.getJSONObject(1).getJSONObject("sourceContext").toString());
        rows.getJSONObject(1).getJSONObject("sourceContext").put("opaque","changed-by-caller");
        assertEquals("online-track",registry.sources("local","local-account",own).getJSONObject(1).getJSONObject("sourceContext").getString("opaque"));
    }
    @Test public void linkingAlreadyAssociatedSourcesMergesCanonicalGroupsAndUpsertsOncePerInstanceAccount() throws Exception {
        PluginSourceRegistry registry=new PluginSourceRegistry(temporary.newFolder());
        registry.link("local","local-account",track("local-track"),"netease","online-account",track("online-track"),1);
        registry.link("netease","online-account",track("online-track"),"kugou","other-account",track("other-track"),0);
        assertEquals(3,registry.sources("local","local-account",track("local-track")).length());
        registry.link("local","local-account",track("local-track"),"netease","online-account",track("online-track"),1);
        assertEquals(3,registry.sources("kugou","other-account",track("other-track")).length());
    }
    @Test public void confidenceRanksBeforeUserPriorityAndPrioritySurvivesRestart() throws Exception {
        java.io.File folder=temporary.newFolder();PluginSourceRegistry registry=new PluginSourceRegistry(folder);
        registry.link("local","local-account",track("local-track"),"netease","online-account",track("online-track"),0);
        registry.link("local","local-account",track("local-track"),"kugou","other-account",track("other-track"),1);
        registry.setPriorities(new JSONObject().put("lyric",new JSONArray().put("netease").put("kugou").put("self")));
        JSONArray result=candidates(new PluginSourceRegistry(folder),"lyric","local");
        assertEquals("kugou",result.getJSONObject(0).getString("pluginId"));
        assertEquals("local",result.getJSONObject(1).getString("pluginId"));
        assertEquals("netease",result.getJSONObject(2).getString("pluginId"));
        assertEquals("self",registry.priorities().getJSONArray("comment").getString(0));
    }
    @Test public void libraryLyricsIgnoreTheSelfPriorityTokenButKeepTheSelfFallbackCandidate() throws Exception {
        PluginSourceRegistry registry=new PluginSourceRegistry(temporary.newFolder());
        registry.link("local","local-account",track("local-track"),"netease","online-account",track("online-track"),1);
        JSONArray local=candidates(registry,"lyric","local"),library=candidates(registry,"lyric","library"),comments=candidates(registry,"comment","library");
        assertEquals("local",local.getJSONObject(0).getString("pluginId"));
        assertEquals("netease",library.getJSONObject(0).getString("pluginId"));
        assertEquals("local",library.getJSONObject(1).getString("pluginId"));
        assertEquals("local",comments.getJSONObject(0).getString("pluginId"));
    }
    @Test public void disabledChangedAccountAndUnsupportedSourcesCannotBeAutomaticCandidates() throws Exception {
        PluginSourceRegistry registry=new PluginSourceRegistry(temporary.newFolder());
        registry.link("local","local-account",track("local-track"),"netease","online-account",track("online-track"),1);
        registry.link("local","local-account",track("local-track"),"kugou","other-account",track("other-track"),1);
        JSONArray plugins=installed("local");plugins.getJSONObject(1).put("accountScope","different-account");
        plugins.getJSONObject(2).put("unsupportedMethods",new JSONArray().put("getLyric"));
        JSONArray result=registry.candidates("local","local-account","local-track",track("local-track").getJSONObject("sourceContext"),"lyric",plugins);
        assertEquals(1,result.length());assertEquals("local",result.getJSONObject(0).getString("pluginId"));
        plugins.getJSONObject(0).put("enabled",false);
        assertEquals(0,registry.candidates("local","local-account","local-track",new JSONObject(),"lyric",plugins).length());
        assertEquals(1,registry.candidates("local","changed-account","local-track",new JSONObject(),"comment",new JSONArray().put(plugin("local","local","changed-account"))).length());
    }
    @Test public void contextLookupComparesWholeJsonWithoutInferringProviderIdentifiers() throws Exception {
        PluginSourceRegistry registry=new PluginSourceRegistry(temporary.newFolder());
        JSONObject own=track("local-track"),raw=own.getJSONObject("sourceContext");raw.put("id","not-the-public-id");
        registry.link("local","local-account",own,"netease","online-account",track("online-track"),1);
        JSONObject reordered=new JSONObject().put("id","not-the-public-id").put("nested",raw.getJSONObject("nested")).put("opaque","local-track");
        assertEquals(2,registry.candidates("local","local-account","",reordered,"lyric",installed("local")).length());
        assertEquals(1,registry.candidates("local","local-account","different-public-id",reordered,"lyric",installed("local")).length());
        JSONObject empty=new JSONObject().put("id","first").put("sourceContext",new JSONObject());
        registry.link("local","local-account",empty,"kugou","other-account",track("second"),1);
        assertEquals(1,registry.sources("local","local-account",new JSONObject().put("id","unrelated").put("sourceContext",new JSONObject())).length());
    }
    @Test public void invalidPriorityUpdatesDoNotErasePreviouslySavedOrderAndDuplicatesCollapse() throws Exception {
        PluginSourceRegistry registry=new PluginSourceRegistry(temporary.newFolder());
        registry.setPriorities(new JSONObject().put("comment",new JSONArray().put("kugou").put("kugou").put("self")));
        assertEquals(2,registry.priorities().getJSONArray("comment").length());
        try { registry.setPriorities(new JSONObject().put("comment",new JSONArray().put("../private")));fail(); }catch(java.io.IOException expected) { }
        assertEquals("kugou",registry.priorities().getJSONArray("comment").getString(0));
    }
    @Test public void removingOneMappingPreservesOtherSourcesAndCannotRemoveTheOrigin() throws Exception {
        PluginSourceRegistry registry=new PluginSourceRegistry(temporary.newFolder());
        registry.link("local","local-account",track("local-track"),"netease","online-account",track("online-track"),1);
        registry.link("local","local-account",track("local-track"),"kugou","other-account",track("other-track"),1);
        registry.unlink("local","local-account",track("local-track"),"netease","online-account");
        JSONArray result=registry.sources("local","local-account",track("local-track"));
        assertEquals(2,result.length());assertEquals("kugou",result.getJSONObject(1).getString("pluginId"));
        try {registry.unlink("local","local-account",track("local-track"),"local","local-account");fail();}catch(java.io.IOException expected) { }
    }
    @Test public void automaticConfidenceThresholdsMatchTheDesktopContract() {
        assertEquals(1,PluginSourceRegistry.automaticMatch("official",0));
        assertEquals(1,PluginSourceRegistry.automaticMatch("search",80));
        assertEquals(0,PluginSourceRegistry.automaticMatch("search",50));
        assertEquals(-1,PluginSourceRegistry.automaticMatch("search",49.9));
        assertEquals(-1,PluginSourceRegistry.automaticMatch("search",Double.NaN));
        assertEquals(-1,PluginSourceRegistry.automaticMatch("",100));
    }
    @Test public void backupSanitizerReturnsOnlyKnownPrioritiesAndRejectsInvalidInputsBeforeWriting() throws Exception {
        JSONObject input=new JSONObject().put("lyric",new JSONArray().put("self").put("netease").put("self"))
                .put("groups",new JSONArray().put(new JSONObject().put("private","excluded")));
        JSONObject result=PluginSourceRegistry.sanitizePriorities(input);
        assertEquals(1,result.length());assertFalse(result.has("groups"));assertEquals(2,result.getJSONArray("lyric").length());
        assertEquals(0,PluginSourceRegistry.sanitizePriorities(new JSONObject()).length());
        try {PluginSourceRegistry.sanitizePriorities(new JSONObject().put("lyric",new JSONArray().put("self").put(12)));fail();}
        catch(java.io.IOException expected) { }
        assertEquals(3,input.getJSONArray("lyric").length());
    }
}
