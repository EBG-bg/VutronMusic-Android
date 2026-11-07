package io.github.vutronmusic.personal;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import static org.junit.Assert.*;

public class PluginLocalBackupTest {
    @Rule public TemporaryFolder temporary=new TemporaryFolder();
    private JSONObject song(String id,String name) throws Exception {return new JSONObject().put("id",id).put("name",name).put("duration",180000)
            .put("albumName","Album").put("artists",new JSONArray().put(new JSONObject().put("name","Artist").put("sourceContext",new JSONObject().put("token","private-marker"))))
            .put("filePath","file:///private-marker/recordings/"+name+".flac").put("cookie","private-marker");}
    private JSONObject entry(String id,int position) throws Exception {return new JSONObject().put("playlistId","p1").put("position",position).put("pluginId","local")
            .put("sourceContext",new JSONObject().put("id",id).put("filePath","/private-marker/audio").put("token","private-marker").toString());}
    private JSONObject state() throws Exception {return new JSONObject().put("store",new JSONObject().put("baseUrl","https://private-marker")).put("resources",new JSONObject().put("/private-marker/path",new JSONObject()))
            .put("db",new JSONObject().put("PluginData",new JSONObject().put("cookie","private-marker").put("pwd","private-marker"))
                    .put("Track",new JSONArray().put(song("a","First")).put(song("b","Second").put("liked",1)))
                    .put("Playlist",new JSONArray().put(new JSONObject().put("id","p1").put("name","Custom list").put("description","My description").put("createTime",1234)))
                    .put("PlaylistEntry",new JSONArray().put(entry("a",1)).put(entry("b",0))));}
    private JSONArray plugins() throws Exception {return new JSONArray().put(new JSONObject().put("id","local").put("baseId","local").put("type","local").put("name","Library").put("accountScope","local-account"));}
    private void write(File root,String id,JSONObject state) throws Exception {LibraryFiles.writeJson(new File(root,id+".state.json"),state);}
    private JSONObject document(JSONArray collections) throws Exception {return new JSONObject().put("format",1).put("generator",LibraryBackup.GENERATOR).put("collections",collections);}

    @Test public void exportedPlaylistsAndFavoritesContainOnlyPortableMetadataWithoutPathsOrCredentials() throws Exception {
        File folder=temporary.newFolder();write(folder,"local",state());JSONArray result=PluginLocalBackup.collections(folder,plugins());
        assertEquals(2,result.length());String json=result.toString();
        for(String privateField:new String[]{"private-marker","sourceContext","filePath","PluginData","cookie","baseUrl","pwd","local-account"})assertFalse(privateField,json.contains(privateField));
        assertEquals(1,result.getJSONObject(0).getJSONArray("tracks").length());
        JSONObject track=result.getJSONObject(1).getJSONArray("tracks").getJSONObject(0);assertEquals("Second.flac",track.getString("fileName"));
        assertEquals("Artist",track.getJSONArray("artists").getString(0));assertFalse(track.has("id"));
    }
    @Test public void customEntryOrderDescriptionAndCreationDateSurviveTheExistingRestorePlan() throws Exception {
        File folder=temporary.newFolder();write(folder,"local",state());JSONArray exported=PluginLocalBackup.collections(folder,plugins());
        LibraryBackup.RestorePlan plan=LibraryBackup.planRestore(new JSONObject().put("collections",new JSONArray()),document(exported));
        assertEquals(2,plan.added.size());JSONObject list=plan.added.get(1);
        assertEquals("Second",list.getJSONArray("tracks").getJSONObject(0).getString("name"));assertEquals("First",list.getJSONArray("tracks").getJSONObject(1).getString("name"));
        assertEquals("My description",list.getString("description"));assertEquals(1234,list.getLong("createTime"));
        assertEquals("custom",plan.orders.getJSONObject(list.getString("id")).getString("mode"));
        assertEquals(0,LibraryBackup.planRestore(plan.document,document(exported)).added.size());
    }
    @Test public void perTrackVolumeDelayAndPlaylistVolumeArePortableInsteadOfKeepingPluginIdentities() throws Exception {
        File folder=temporary.newFolder();write(folder,"local",state());
        JSONArray exported=PluginLocalBackup.collections(folder,plugins(),new JSONArray(),new PluginLocalBackup.Settings(){
            @Override public int trackVolume(String plugin,String scope,JSONObject track){assertEquals("local-account",scope);return 47;}
            @Override public long lyricOffset(String plugin,String scope,JSONObject track){return 1750;}
            @Override public int playlistVolume(String plugin,String scope,String playlist){return 64;}
        });
        JSONArray safe=LibraryBackup.validate(document(exported)).getJSONArray("collections");
        assertEquals(64,safe.getJSONObject(1).getInt("volume"));JSONObject track=safe.getJSONObject(1).getJSONArray("tracks").getJSONObject(0);
        assertEquals(47,track.getInt("volume"));assertEquals(1750,track.getLong("lyricOffsetMs"));assertFalse(track.has("pluginId"));
    }
    @Test public void localInstancesRemainDistinctAndOnlineAccountStateIsNeverRead() throws Exception {
        File folder=temporary.newFolder();write(folder,"local",state());write(folder,"local_second",state());
        JSONArray plugins=plugins().put(new JSONObject(plugins().getJSONObject(0).toString()).put("id","local_second").put("name","Other library"))
                .put(new JSONObject().put("id","netease").put("type","library"));
        // Online state is deliberately invalid: a portable local backup must not open it.
        Files.write(new File(folder,"netease.state.json").toPath(),"not-json-private-marker".getBytes(StandardCharsets.UTF_8));
        JSONArray exported=PluginLocalBackup.collections(folder,plugins);assertEquals(4,exported.length());
        assertNotEquals(exported.getJSONObject(0).getString("collectionKey"),exported.getJSONObject(2).getString("collectionKey"));
        assertTrue(exported.getJSONObject(2).getString("name").startsWith("Other library"));
    }
    @Test public void missingTrackMetadataFailsExplicitlyAndPreservesTheOnlySourceState() throws Exception {
        File folder=temporary.newFolder();JSONObject state=state();state.getJSONObject("db").getJSONArray("PlaylistEntry").put(entry("missing",2));write(folder,"local",state);
        byte[] before=Files.readAllBytes(new File(folder,"local.state.json").toPath());
        try{PluginLocalBackup.collections(folder,plugins());fail();}catch(java.io.IOException expected){assertTrue(expected.getMessage().contains("失效"));}
        assertArrayEquals(before,Files.readAllBytes(new File(folder,"local.state.json").toPath()));
    }
    @Test public void nativeFileNamesAndCueMetadataRebindByTheExistingPortableFingerprint() throws Exception {
        JSONObject raw=song("a","First").put("filePath","content://provider/document/opaque-id").put("cueOffset",180000).put("cueDuration",150000).put("no",2).put("duration",150000);
        raw.remove("albumName");raw.put("album",new JSONObject().put("name","Album").put("sourceContext",new JSONObject().put("token","private-marker")));
        JSONObject authorized=new JSONObject().put("id",1).put("name","First").put("artists",new JSONArray().put("Artist")).put("album","Album").put("duration",150000)
                .put("localUri","content://provider/document/opaque-id").put("localFileName","Actual.flac").put("cueTrackNo",2).put("cueOffsetMs",180000).put("cueDurationMs",150000);
        JSONObject portable=PluginLocalBackup.portableTrack(raw,authorized);
        assertEquals("Actual.flac",portable.getString("fileName"));assertEquals(2,portable.getInt("cueTrackNo"));assertEquals(180000,portable.getLong("cueOffsetMs"));
        assertEquals(LibraryBackup.fingerprint(authorized),LibraryBackup.fingerprint(portable));
        assertFalse(portable.toString().contains("private-marker"));assertFalse(portable.toString().contains("sourceContext"));
    }
}
