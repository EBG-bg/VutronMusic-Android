package io.github.vutronmusic.personal;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.io.IOException;
import java.util.HashMap;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import static org.junit.Assert.*;

public class CollectionOrderHistoryBackupTest {
    private JSONObject entry(String id,long time,String mode,String... keys) throws Exception {
        JSONArray values=new JSONArray();for(String key:keys)values.put(key);
        return new JSONObject().put("id",id).put("createdAt",time).put("mode",mode).put("keys",values);
    }
    private JSONObject history(int limit,JSONObject... entries) throws Exception {
        JSONArray values=new JSONArray();for(JSONObject entry:entries)values.put(entry);
        return new JSONObject().put("limit",limit).put("entries",values).put("legacyMigrated",true);
    }
    private JSONObject document() throws Exception {
        return new JSONObject().put("format",1).put("generator",LibraryBackup.GENERATOR).put("collections",new JSONArray());
    }
    @Test public void onlineHistoryKeepsAccountScopesAndNamedPermanentMetadataWithoutSecrets() throws Exception {
        String pluginScope=new JSONArray().put("plugin").put("kugou").put("account-a").put("playlist-1").toString();
        String pluginKey=new JSONArray().put("kugou").put("hash-1").toString();
        JSONObject source=new JSONObject()
                .put("netease:7:playlist:42",history(3,entry("n1",200,"custom","netease:2","netease:1").put("name","Quiet evening").put("pinned",true).put("cookie","private-marker")))
                .put("netease:8:playlist:42",history(5,entry("n2",300,"title","netease:1","netease:2")))
                .put(pluginScope,history(2,entry("p1",400,"custom",pluginKey)))
                .put("cookie",history(2,entry("x1",500,"custom","content://private-marker/audio")));
        JSONObject safe=LibraryBackup.safeFrontend(new JSONObject().put(CollectionOrderHistoryBackup.KEY,source.toString()));
        JSONObject restored=new JSONObject(safe.getString(CollectionOrderHistoryBackup.KEY));assertEquals(3,restored.length());
        JSONObject scope=restored.getJSONObject("netease:7:playlist:42"),item=scope.getJSONArray("entries").getJSONObject(0);
        assertEquals(3,scope.getInt("limit"));assertTrue(scope.getBoolean("legacyMigrated"));
        assertEquals("Quiet evening",item.getString("name"));assertTrue(item.getBoolean("pinned"));assertEquals(200,item.getLong("customAt"));
        assertEquals(pluginKey,restored.getJSONObject(pluginScope).getJSONArray("entries").getJSONObject(0).getJSONArray("keys").getString(0));
        assertFalse(safe.toString().contains("private-marker"));assertFalse(item.has("cookie"));
        assertEquals(safe.toString(),LibraryBackup.safeFrontend(safe).toString());
    }
    @Test public void invalidMediaReferencesAndNonDateTimesCannotProduceInvalidSnapshots() throws Exception {
        long invalidDate=8_900_000_000_000_000L,maxDate=8_640_000_000_000_000L;
        JSONObject scope=history(10,entry("bad",200,"custom","netease:1","file:///private/audio"),entry("ok",100,"custom","netease:1"),
                entry("invalid-time",invalidDate,"original","netease:2"),entry("invalid-custom",300,"custom","netease:3").put("customAt",invalidDate),
                entry("date-edge",maxDate,"original","netease:4").put("customAt",maxDate));
        JSONObject result=CollectionOrderHistoryBackup.online(new JSONObject().put("netease:7:playlist:42",scope));
        JSONArray kept=result.getJSONObject("netease:7:playlist:42").getJSONArray("entries");
        assertEquals(3,kept.length());assertEquals("date-edge",kept.getJSONObject(0).getString("id"));
        assertEquals(maxDate,kept.getJSONObject(0).getLong("createdAt"));assertEquals(maxDate,kept.getJSONObject(0).getLong("customAt"));
        assertEquals("invalid-custom",kept.getJSONObject(1).getString("id"));assertEquals(300,kept.getJSONObject(1).getLong("customAt"));
        assertEquals("ok",kept.getJSONObject(2).getString("id"));assertFalse(kept.toString().contains("invalid-time"));
        assertFalse(result.toString().contains("private"));
    }
    @Test public void duplicateSequencesKeepNewestModeAndAllNamedPermanentCustomMetadata() throws Exception {
        JSONObject raw=history(1,entry("old",100,"custom","netease:2","netease:1").put("name","My order").put("pinned",true).put("customAt",150),
                entry("new",200,"original","netease:2","netease:1"),entry("other",300,"title","netease:1","netease:2"));
        JSONObject result=CollectionOrderHistoryBackup.online(new JSONObject().put("netease:7:playlist:42",raw));
        JSONArray entries=result.getJSONObject("netease:7:playlist:42").getJSONArray("entries");assertEquals(2,entries.length());
        JSONObject duplicate=entries.getJSONObject(1);assertEquals("new",duplicate.getString("id"));assertEquals("original",duplicate.getString("mode"));
        assertEquals("My order",duplicate.getString("name"));assertTrue(duplicate.getBoolean("pinned"));assertEquals(150,duplicate.getLong("customAt"));
    }
    @Test public void permanentSnapshotsDoNotConsumeOrGetTrimmedByTheAutomaticLimit() throws Exception {
        JSONArray entries=new JSONArray();
        for(int n=1;n<=70;n++)entries.put(entry("pin-"+n,n,"custom","netease:"+n).put("pinned",true));
        for(int n=1;n<=3;n++)entries.put(entry("auto-"+n,100+n,"title","netease:"+(100+n)));
        JSONObject result=CollectionOrderHistoryBackup.online(new JSONObject().put("netease:7:playlist:42",new JSONObject().put("limit",2).put("entries",entries)));
        JSONArray kept=result.getJSONObject("netease:7:playlist:42").getJSONArray("entries");assertEquals(72,kept.length());
        assertEquals("auto-3",kept.getJSONObject(0).getString("id"));assertEquals("auto-2",kept.getJSONObject(1).getString("id"));
        int permanent=0;for(int n=0;n<kept.length();n++)if(kept.getJSONObject(n).optBoolean("pinned"))permanent++;
        assertEquals(70,permanent);
    }
    @Test public void portableHistoryMapsPresentRecordingsAndKeepsMissingReferencesAsOpaquePlaceholders() throws Exception {
        Map<String,String> keys=new HashMap<>();keys.put("file:///private/a","a".repeat(64));keys.put("content://private/b","b".repeat(64));
        JSONObject result=CollectionOrderHistoryBackup.remap(history(4,entry("s1",123,"custom","content://private/b","missing","file:///private/a").put("name","Imported").put("pinned",true)),keys);
        JSONArray restored=result.getJSONArray("entries").getJSONObject(0).getJSONArray("keys");assertEquals(3,restored.length());
        assertEquals("b".repeat(64),restored.getString(0));assertEquals("missing:"+LibraryBackup.digest("missing"),restored.getString(1));assertEquals("a".repeat(64),restored.getString(2));assertFalse(result.toString().contains("private"));
        assertEquals("Imported",result.getJSONArray("entries").getJSONObject(0).getString("name"));assertTrue(result.getBoolean("legacyMigrated"));
    }
    @Test public void allMissingPermanentHistoryRetainsItsNameAndStableOrderAcrossValidationAndRestore() throws Exception {
        JSONObject portable=CollectionOrderHistoryBackup.remap(history(2,entry("absent",123,"custom","file:///private/a","content://private/b").put("name","Keep this").put("pinned",true)),new HashMap<>());
        JSONArray expected=portable.getJSONArray("entries").getJSONObject(0).getJSONArray("keys");assertEquals(2,expected.length());
        assertTrue(expected.getString(0).matches("missing:[a-f0-9]{64}"));assertFalse(portable.toString().contains("private"));
        JSONObject source=document().put("collections",new JSONArray().put(new JSONObject().put("name","Empty local list").put("tracks",new JSONArray()).put("orderHistory",portable)));
        LibraryBackup.RestorePlan plan=LibraryBackup.planRestore(new JSONObject().put("collections",new JSONArray()),source);
        String id=plan.added.get(0).getString("id");JSONObject kept=new JSONObject(plan.safe.getJSONObject("frontend").getString(CollectionOrderHistoryBackup.KEY)).getJSONObject(id).getJSONArray("entries").getJSONObject(0);
        assertEquals(expected.toString(),kept.getJSONArray("keys").toString());assertEquals("Keep this",kept.getString("name"));assertTrue(kept.getBoolean("pinned"));
        assertEquals(portable.toString(),CollectionOrderHistoryBackup.remap(portable,new HashMap<>()).toString());
    }
    @Test public void numericAndStringPluginPlaylistScopesRemainDistinct() throws Exception {
        String numeric=new JSONArray().put("plugin").put("kugou").put("account-a").put(42).toString();
        String text=new JSONArray().put("plugin").put("kugou").put("account-a").put("42").toString();
        String key=new JSONArray().put("kugou").put("hash-1").toString();
        JSONObject safe=CollectionOrderHistoryBackup.online(new JSONObject().put(numeric,history(2,entry("n1",100,"custom",key).put("name","Number")))
                .put(text,history(3,entry("s1",200,"custom",key).put("name","Text"))));
        assertEquals(2,safe.length());assertEquals("Number",safe.getJSONObject(numeric).getJSONArray("entries").getJSONObject(0).getString("name"));
        assertEquals("Text",safe.getJSONObject(text).getJSONArray("entries").getJSONObject(0).getString("name"));
    }
    @Test public void aggregateHistoryExportsTheActualLocalIndexOnlyWhenRequestedAndRestoresEveryOrderReference() throws Exception {
        JSONObject a=new JSONObject().put("id",1).put("name","A").put("artists",new JSONArray()).put("album","Album").put("duration",1000)
                .put("localFolderId","folder:one").put("localUri","content://private/a").put("localFileName","a.flac");
        JSONObject b=new JSONObject(a.toString()).put("id",2).put("name","B").put("localUri","content://private/b").put("localFileName","b.flac");
        JSONObject c=new JSONObject(a.toString()).put("id",3).put("name","C").put("localUri","content://private/c").put("localFileName","c.flac");c.remove("localFolderId");
        JSONArray folders=new JSONArray().put(a).put(b),selected=new JSONArray().put(new JSONObject(a.toString()).put("name","Duplicate A")).put(c);
        assertSame(selected,LibraryBackup.aggregateBackupRows(folders,selected,false));
        JSONArray aggregate=LibraryBackup.aggregateBackupRows(folders,selected,true);assertEquals(3,aggregate.length());
        List<JSONObject> source=new ArrayList<>();JSONArray portable=new JSONArray();
        for(int n=0;n<aggregate.length();n++){source.add(aggregate.getJSONObject(n));portable.put(LibraryBackup.portableTrack(aggregate.getJSONObject(n)));}
        JSONObject collection=new JSONObject().put("name","Local music").put("collectionKey","local:folder").put("sortMode","original").put("tracks",portable);
        LibraryBackup.attachOrderHistory(collection,history(3,entry("aggregate",123,"custom",LocalLibraryIds.key(c),LocalLibraryIds.key(a),LocalLibraryIds.key(b)).put("name","All local").put("pinned",true)),source);
        assertFalse(collection.getJSONObject("orderHistory").toString().contains("missing:"));assertFalse(collection.toString().contains("content://"));
        LibraryBackup.RestorePlan plan=LibraryBackup.planRestore(new JSONObject().put("collections",new JSONArray()),document().put("collections",new JSONArray().put(collection)));
        JSONObject restored=plan.added.get(0);String id=restored.getString("id");assertEquals(3,restored.getJSONArray("tracks").length());
        assertEquals("A",restored.getJSONArray("tracks").getJSONObject(0).getString("name"));assertEquals("B",restored.getJSONArray("tracks").getJSONObject(1).getString("name"));assertEquals("C",restored.getJSONArray("tracks").getJSONObject(2).getString("name"));
        JSONArray order=plan.orders.getJSONObject(id).getJSONArray("keys"),loaded=new JSONObject(plan.safe.getJSONObject("frontend").getString(CollectionOrderHistoryBackup.KEY)).getJSONObject(id).getJSONArray("entries").getJSONObject(0).getJSONArray("keys");
        assertEquals(order.getString(2),loaded.getString(0));assertEquals(order.getString(0),loaded.getString(1));assertEquals(order.getString(1),loaded.getString(2));
        assertFalse(loaded.toString().contains("missing:"));
    }
    @Test public void localHistoryRestoresToTheNewCollectionAndCueKeysAndRepeatedImportUsesTheSameScope() throws Exception {
        JSONObject track=new JSONObject().put("name","Cue song").put("artists",new JSONArray().put("Artist")).put("album","Album")
                .put("duration",1000).put("fileName","song.flac").put("cueTrackNo",2).put("cueOffsetMs",10000).put("cueDurationMs",1000);
        track.put("key",LibraryBackup.digest(LibraryBackup.fingerprint(track)+":0"));String portable=track.getString("key");
        JSONObject item=new JSONObject().put("name","Local list").put("collectionKey","bundle:old").put("tracks",new JSONArray().put(track))
                .put("orderHistory",history(2,entry("local-1",123,"custom",portable).put("name","Practice").put("pinned",true)));
        JSONObject source=document().put("collections",new JSONArray().put(item));
        LibraryBackup.RestorePlan plan=LibraryBackup.planRestore(new JSONObject().put("collections",new JSONArray()),source);
        String id=plan.added.get(0).getString("id"),expected=LocalLibraryIds.key(new JSONObject(track.toString()).put("localPlaylistId",id).put("localEntryKey",portable));
        JSONObject all=new JSONObject(plan.safe.getJSONObject("frontend").getString(CollectionOrderHistoryBackup.KEY));
        JSONObject entry=all.getJSONObject(id).getJSONArray("entries").getJSONObject(0);assertEquals(expected,entry.getJSONArray("keys").getString(0));
        assertEquals("Practice",entry.getString("name"));assertTrue(entry.getBoolean("pinned"));assertFalse(all.has("bundle:old"));
        assertEquals(expected,plan.orders.getJSONObject(id).getJSONArray("keys").getString(0));
        LibraryBackup.RestorePlan repeated=LibraryBackup.planRestore(plan.document,source);assertEquals(0,repeated.added.size());
        assertTrue(new JSONObject(repeated.safe.getJSONObject("frontend").getString(CollectionOrderHistoryBackup.KEY)).has(id));
    }
    @Test public void validHistoryLargerThanTheOldOneMegabyteThresholdIsPreservedInFull() throws Exception {
        JSONArray snapshots=new JSONArray();
        for(int n=0;n<80;n++) {
            JSONArray keys=new JSONArray();for(int k=0;k<1000;k++)keys.put("netease:"+(100000+(k+n)%1000));
            snapshots.put(new JSONObject().put("id","large-"+n).put("createdAt",1000+n).put("mode","custom").put("keys",keys).put("pinned",true));
        }
        JSONObject raw=new JSONObject().put("netease:7:playlist:42",new JSONObject().put("limit",1).put("entries",snapshots));
        assertTrue(raw.toString().length()>1_000_000);
        JSONObject safe=LibraryBackup.safeFrontend(new JSONObject().put(CollectionOrderHistoryBackup.KEY,raw.toString()));
        JSONArray restored=new JSONObject(safe.getString(CollectionOrderHistoryBackup.KEY)).getJSONObject("netease:7:playlist:42").getJSONArray("entries");
        assertEquals(80,restored.length());for(int n=0;n<restored.length();n++)assertEquals(1000,restored.getJSONObject(n).getJSONArray("keys").length());
    }
    @Test public void oversizedOutputFailsBeforeWritingAndNeverSilentlyDropsSortHistory() throws Exception {
        JSONObject source=document().put("padding","x".repeat(LibraryBackup.MAX_BYTES));
        try {LibraryBackup.exportBytes(source);fail();}catch(IOException expected){assertTrue(expected.getMessage().contains("8 MiB"));}
        try {LibraryBackup.safeFrontend(new JSONObject().put(CollectionOrderHistoryBackup.KEY,"x".repeat(LibraryBackup.MAX_BYTES+1)));fail();}
        catch(IOException expected){assertTrue(expected.getMessage().contains("排序历史"));}
    }
}
