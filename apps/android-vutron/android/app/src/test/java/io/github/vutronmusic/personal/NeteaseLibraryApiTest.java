package io.github.vutronmusic.personal;
import org.json.*;
import org.junit.Test;
import java.io.IOException;
import java.util.*;
import static org.junit.Assert.*;

public class NeteaseLibraryApiTest {
    private static JSONObject value(String text) { try { return new JSONObject(text); } catch (JSONException error) { throw new AssertionError(error); } }
    private static JSONObject ok() { return value("{\"code\":200}"); }
    private static JSONObject owned() { return value("{\"code\":200,\"playlist\":{\"id\":42,\"creator\":{\"userId\":7},\"tracks\":[],\"trackIds\":[]}}"); }
    private static JSONObject profile() { return value("{\"code\":200,\"profile\":{\"userId\":7}}"); }
    @Test public void likedStateComesFromLikeListAndLikeUsesWeapi() throws Exception {
        List<String> calls = new ArrayList<>();
        NeteaseApi api = new NeteaseApi("", () -> true, (path, data, weapi) -> {
            calls.add(path);
            if (path.equals("/api/song/like/get")) { assertFalse(weapi); assertEquals(7, data.optLong("uid")); return value("{\"code\":200,\"ids\":[2,3,3],\"liked\":true}"); }
            assertEquals("/api/radio/like", path); assertTrue(weapi); assertEquals(2, data.optLong("trackId")); assertFalse(data.optBoolean("like")); return ok();
        });
        assertEquals(new LinkedHashSet<>(Arrays.asList(2L,3L)), api.likedTracks(7)); api.likeTrack(2,false);
        assertEquals(Arrays.asList("/api/song/like/get","/api/radio/like"),calls);
    }
    @Test public void createUsesPrivacyAndReturnsServerPlaylist() throws Exception {
        NeteaseApi api = new NeteaseApi("", () -> true, (path, data, weapi) -> {
            assertEquals("/api/playlist/create",path); assertTrue(weapi); assertEquals("10",data.optString("privacy")); assertEquals("NORMAL",data.optString("type"));
            assertEquals("A \"quoted\" name",data.optString("name")); return owned();
        });
        assertEquals(42,api.createPlaylist("A \"quoted\" name",10).getLong("id"));
    }
    @Test public void anotherOwnersPlaylistCannotBeMutated() throws Exception {
        List<String> paths = new ArrayList<>();
        NeteaseApi api = new NeteaseApi("", () -> true, (path,data,weapi) -> {
            paths.add(path); if(path.equals("/api/w/nuser/account/get"))return profile();
            return value("{\"code\":200,\"playlist\":{\"id\":42,\"creator\":{\"userId\":8}}}");
        });
        try { api.deletePlaylist(42); fail(); } catch(IOException expected) { assertTrue(expected.getMessage().contains("自己的歌单")); }
        assertEquals(2,paths.size()); assertFalse(paths.contains("/api/playlist/remove"));
    }
    @Test public void excessiveNameIsRejectedBeforeNetworkInsteadOfKnownServer400() throws Exception {
        NeteaseApi api = new NeteaseApi("", () -> true, (path,data,weapi) -> { fail("No request for invalid name"); return ok(); });
        try { api.createPlaylist(new String(new char[41]).replace('\0','x'), 10); fail(); }
        catch(IOException expected) { assertTrue(expected.getMessage().contains("40")); }
    }
    @Test public void deleteUsesOnlyConfirmedOwnedPlaylistId() throws Exception {
        NeteaseApi api = new NeteaseApi("", () -> true, (path,data,weapi) -> {
            if(path.equals("/api/w/nuser/account/get"))return profile(); if(path.equals("/api/v6/playlist/detail"))return owned();
            assertEquals("/api/playlist/remove",path); assertTrue(weapi); assertEquals("[42]",data.optString("ids")); return ok();
        }); api.deletePlaylist(42);
    }
    @Test public void editBatchEscapesStringsAndRequiresEveryFieldToSucceed() throws Exception {
        List<JSONObject> writes = new ArrayList<>();
        NeteaseApi api = new NeteaseApi("", () -> true, (path,data,weapi) -> {
            if(path.equals("/api/w/nuser/account/get"))return profile(); if(path.equals("/api/v6/playlist/detail"))return owned();
            assertEquals("/api/batch",path); assertFalse(weapi); writes.add(data);
            return value("{\"code\":200,\"/api/playlist/desc/update\":{\"code\":200},\"/api/playlist/tags/update\":{\"code\":200},\"/api/playlist/update/name\":{\"code\":403}}");
        });
        try { api.editPlaylist(42,"quoted \"name\"","line1\nline2",new JSONArray().put("流行").put("华语")); fail(); }
        catch(IOException expected) { assertTrue(expected.getMessage().contains("部分字段")); }
        assertEquals("quoted \"name\"",new JSONObject(writes.get(0).getString("/api/playlist/update/name")).getString("name"));
        assertEquals("line1\nline2",new JSONObject(writes.get(0).getString("/api/playlist/desc/update")).getString("desc"));
        assertEquals("流行;华语",new JSONObject(writes.get(0).getString("/api/playlist/tags/update")).getString("tags"));
    }
    @Test public void membershipRetriesOnlyTheKnown512PathOnce() throws Exception {
        List<JSONObject> writes = new ArrayList<>();
        NeteaseApi api = new NeteaseApi("", () -> true, (path,data,weapi) -> {
            if(path.equals("/api/w/nuser/account/get"))return profile(); if(path.equals("/api/v6/playlist/detail"))return owned();
            assertEquals("/api/playlist/manipulate/tracks",path); assertFalse(weapi); writes.add(data); return writes.size()==1?value("{\"code\":512}"):ok();
        }); api.changePlaylistTrack(42,3,true);
        assertEquals(2,writes.size()); assertEquals("[\"3\"]",writes.get(0).getString("trackIds")); assertEquals("[\"3\",\"3\"]",writes.get(1).getString("trackIds"));
    }
    @Test public void reorderUsesTheCompleteOwnedPlaylistAndOriginalUpdateContract() throws Exception {
        List<JSONObject> writes = new ArrayList<>();
        NeteaseApi api = new NeteaseApi("", () -> true, (path,data,weapi) -> {
            if(path.equals("/api/w/nuser/account/get"))return profile();
            if(path.equals("/api/v6/playlist/detail"))return value("{\"code\":200,\"playlist\":{\"id\":42,\"creator\":{\"userId\":7},\"trackIds\":[{\"id\":2},{\"id\":3}]}}");
            assertEquals("/api/playlist/manipulate/tracks",path);assertFalse(weapi);assertEquals("update",data.optString("op"));assertEquals(42,data.optLong("pid"));writes.add(data);return ok();
        });
        api.reorderPlaylistTracks(42,new JSONArray().put(3).put(2));assertEquals(1,writes.size());assertEquals("[3,2]",writes.get(0).getString("trackIds"));
        for(JSONArray invalid:new JSONArray[]{new JSONArray().put(2),new JSONArray().put(2).put(4),new JSONArray().put(2).put(2),new JSONArray().put(2.5).put(3)}) {
            try{api.reorderPlaylistTracks(42,invalid);fail("Invalid or stale full order accepted");}catch(IOException expected){}
        }
        assertEquals(1,writes.size());
    }
    @Test public void localModeRejectsWritesBeforeAnyTransportCall() throws Exception {
        NeteaseApi api = new NeteaseApi("", () -> false, (path,data,weapi) -> { fail("No network in local mode"); return ok(); });
        try { api.likeTrack(3,true); fail(); } catch(IOException expected) { }
        try { api.createPlaylist("Test",0); fail(); } catch(IOException expected) { }
        try { api.changePlaylistTrack(42,3,false); fail(); } catch(IOException expected) { }
    }
    @Test public void defaultLikedPlaylistRejectsEditDeleteAddAndRemoveBeforeAnyWrite() throws Exception {
        for (int operation=0; operation<4; operation++) {
            List<String> paths = new ArrayList<>();
            NeteaseApi api = new NeteaseApi("", () -> true, (path,data,weapi) -> {
                paths.add(path);
                if(path.equals("/api/w/nuser/account/get")) return profile();
                assertEquals("/api/v6/playlist/detail",path);
                return value("{\"code\":200,\"playlist\":{\"id\":42,\"specialType\":5,\"creator\":{\"userId\":7}}}");
            });
            try {
                if(operation==0) api.editPlaylist(42,"Name","",new JSONArray());
                else if(operation==1) api.deletePlaylist(42);
                else api.changePlaylistTrack(42,3,operation==2);
                fail();
            } catch(IOException expected) { assertTrue(expected.getMessage().contains("喜欢")); }
            assertEquals(Arrays.asList("/api/w/nuser/account/get","/api/v6/playlist/detail"),paths);
        }
    }
    @Test public void batchMembershipKeepsSelectionOrderAndSkipsExistingOrAbsentTracks() throws Exception {
        List<JSONObject> writes = new ArrayList<>();
        NeteaseApi api = new NeteaseApi("", () -> true, (path,data,weapi) -> {
            if(path.equals("/api/w/nuser/account/get")) return profile();
            if(path.equals("/api/v6/playlist/detail")) return value("{\"code\":200,\"playlist\":{\"id\":42,\"creator\":{\"userId\":7},\"trackIds\":[{\"id\":2},{\"id\":3}]}}");
            assertEquals("/api/playlist/manipulate/tracks",path); writes.add(data); return ok();
        });
        api.changePlaylistTracks(42,new JSONArray().put(2).put(4).put(4).put(5),true);
        api.changePlaylistTracks(42,new JSONArray().put(9).put(3).put(2).put(2),false);
        assertEquals(2,writes.size());
        assertEquals("[\"4\",\"5\"]",writes.get(0).getString("trackIds")); assertEquals("add",writes.get(0).getString("op"));
        assertEquals("[\"3\",\"2\"]",writes.get(1).getString("trackIds")); assertEquals("del",writes.get(1).getString("op"));
        api.changePlaylistTracks(42,new JSONArray().put(2).put(3),true);
        api.changePlaylistTracks(42,new JSONArray().put(9),false);
        api.reorderPlaylistTracks(42,new JSONArray().put(2).put(3));
        assertEquals("Unchanged membership and complete order must not send writes",2,writes.size());
    }
    @Test public void batchMembershipRetriesTheWholeKnown512PayloadOnlyOnce() throws Exception {
        List<JSONObject> writes = new ArrayList<>();
        NeteaseApi api = new NeteaseApi("", () -> true, (path,data,weapi) -> {
            if(path.equals("/api/w/nuser/account/get")) return profile();
            if(path.equals("/api/v6/playlist/detail")) return owned();
            writes.add(data); return value("{\"code\":512}");
        });
        try { api.changePlaylistTracks(42,new JSONArray().put(3).put(4),true); fail(); } catch(IOException expected) { }
        assertEquals(2,writes.size()); assertEquals("[\"3\",\"4\"]",writes.get(0).getString("trackIds"));
        assertEquals("[\"3\",\"4\",\"3\",\"4\"]",writes.get(1).getString("trackIds"));
    }
    @Test public void invalidBatchMembershipIsRejectedBeforeTransport() throws Exception {
        NeteaseApi api = new NeteaseApi("", () -> true, (path,data,weapi) -> { fail("No network for invalid IDs"); return ok(); });
        for(JSONArray ids:new JSONArray[]{null,new JSONArray(),new JSONArray().put(2.5),new JSONArray().put("3"),new JSONArray().put(-1)}) {
            try { api.changePlaylistTracks(42,ids,true); fail(); } catch(IOException expected) { }
        }
    }
    @Test public void editSkipsUnchangedNormalizedFieldsAndSendsOnlyTheChangedDescription() throws Exception {
        List<JSONObject> writes = new ArrayList<>();
        NeteaseApi api = new NeteaseApi("", () -> true, (path,data,weapi) -> {
            if(path.equals("/api/w/nuser/account/get")) return profile();
            if(path.equals("/api/v6/playlist/detail")) return value("{\"code\":200,\"playlist\":{\"id\":42,\"creator\":{\"userId\":7},\"name\":\"Own\",\"description\":\"line 1\\r\\nline 2\",\"tags\":[\"Pop\",\"Rock\"]}}");
            assertEquals("/api/batch",path); writes.add(data); assertEquals(1,data.length()); assertTrue(data.has("/api/playlist/desc/update"));
            return value("{\"code\":200,\"/api/playlist/desc/update\":{\"code\":200}}");
        });
        api.editPlaylist(42,"  Own  "," line 1\nline 2 ",new JSONArray().put("Rock").put("Pop").put("Pop"));
        assertEquals(0,writes.size());
        api.editPlaylist(42,"Own","Changed",new JSONArray().put("Pop").put("Rock"));
        assertEquals(1,writes.size());
        assertEquals("Changed",new JSONObject(writes.get(0).getString("/api/playlist/desc/update")).getString("desc"));
    }
    @Test public void editingANameDoesNotRewriteTheNormalNullDescription() throws Exception {
        List<JSONObject> writes = new ArrayList<>();
        NeteaseApi api = new NeteaseApi("", () -> true, (path,data,weapi) -> {
            if(path.equals("/api/w/nuser/account/get")) return profile();
            if(path.equals("/api/v6/playlist/detail")) return value("{\"code\":200,\"playlist\":{\"id\":42,\"creator\":{\"userId\":7},\"name\":\"Own\",\"description\":null,\"tags\":[]}}");
            writes.add(data); assertEquals(1,data.length()); assertTrue(data.has("/api/playlist/update/name"));
            return value("{\"code\":200,\"/api/playlist/update/name\":{\"code\":200}}");
        });
        api.editPlaylist(42,"Renamed","",new JSONArray()); assertEquals(1,writes.size());
    }
}
