package io.github.vutronmusic.personal;
import org.json.*;
import org.junit.Test;
import java.io.IOException;
import java.util.*;
import static org.junit.Assert.*;

public class NeteaseTrackProgressTest {
    private JSONObject song(long id) throws Exception { return new JSONObject().put("id",id).put("name","Song "+id); }
    private JSONObject playlist(int count) throws Exception {
        JSONArray ids=new JSONArray(); for(int i=1;i<=count;i++)ids.put(new JSONObject().put("id",i));
        return new JSONObject().put("tracks",new JSONArray().put(song(1)).put(song(2))).put("trackIds",ids);
    }
    @Test public void publishesAnOrderedPrefixBeforeEachExisting500TrackRequestWithoutRepeatedRows() throws Exception {
        List<Integer> sizes=new ArrayList<>(),requests=new ArrayList<>(); List<Long> published=new ArrayList<>();
        NeteaseApi api=new NeteaseApi("",()->true,(path,data,weapi)->{
            try {
            assertEquals("/api/v3/song/detail",path); assertTrue(weapi);
            JSONArray ids=new JSONArray(data.getString("c"));requests.add(ids.length());
            assertEquals(2+(requests.size()-1)*500,published.size());
            JSONArray songs=new JSONArray();for(int i=ids.length()-1;i>=0;i--)songs.put(new JSONObject().put("id",ids.getJSONObject(i).getLong("id")).put("name","Fetched"));
            return new JSONObject().put("code",200).put("songs",songs);
            } catch (JSONException error) { throw new AssertionError(error); }
        });
        List<JSONObject> result=api.tracks(playlist(1003),(rows,total)->{assertEquals(1003,total);sizes.add(rows.size());for(JSONObject row:rows)published.add(row.optLong("id"));});
        assertEquals(Arrays.asList(2,500,500,1),sizes);assertEquals(Arrays.asList(500,500,1),requests);assertEquals(1003,result.size());assertEquals(1003,new HashSet<>(published).size());
        for(int i=0;i<result.size();i++)assertEquals(i+1,result.get(i).getLong("id"));
    }
    @Test public void aLaterRequestFailureLeavesOnlyTheAlreadyPublishedPrefixAndNeverPublishesMissingHoles() throws Exception {
        List<Long> published=new ArrayList<>();int[] calls={0};
        NeteaseApi api=new NeteaseApi("",()->true,(path,data,weapi)->{
            if(++calls[0]==2)throw new IOException("network interrupted");
            try {
            JSONArray ids=new JSONArray(data.getString("c")),songs=new JSONArray();for(int i=0;i<ids.length();i++)songs.put(ids.getJSONObject(i));
            return new JSONObject().put("code",200).put("songs",songs);
            } catch (JSONException error) { throw new AssertionError(error); }
        });
        try{api.tracks(playlist(1003),(rows,total)->{for(JSONObject row:rows)published.add(row.optLong("id"));});fail("Failure must remain visible to the cache-owning caller");}catch(IOException expected){assertEquals("network interrupted",expected.getMessage());}
        assertEquals(502,published.size());assertEquals(502L,(long)published.get(501));
    }
    @Test public void backgroundAdmissionIsRecheckedBeforeTheFirstAndLaterTrackRequests() throws Exception {
        JSONObject detail = playlist(1003);
        for (int allowedPages : new int[]{0, 1}) {
            var admitted = new java.util.concurrent.atomic.AtomicBoolean(true);
            List<String> requests = new ArrayList<>();
            NeteaseApi api = new NeteaseApi("", admitted::get, (path, data, weapi) -> {
                requests.add(path);
                try {
                    if (path.equals("/api/v6/playlist/detail")) {
                        if (allowedPages == 0) admitted.set(false);
                        return new JSONObject().put("code", 200).put("playlist", detail);
                    }
                    assertEquals("/api/v3/song/detail", path);
                    if (requests.size() == allowedPages + 1) admitted.set(false);
                    return new JSONObject().put("code", 200).put("songs", new JSONArray(data.getString("c")));
                } catch (JSONException error) { throw new AssertionError(error); }
            });
            JSONObject fetchedDetail = api.playlistDetail(1);
            assertThrows(IOException.class, () -> api.tracks(fetchedDetail));
            assertEquals(1 + allowedPages, requests.size());
        }
    }
    @Test public void missingUnavailableSongsAndRepeatedTrackIdsKeepTheExistingPlayableOrderWithNoDuplicatePublication() throws Exception {
        JSONObject data=playlist(6);data.getJSONArray("trackIds").put(new JSONObject().put("id",2));List<Long> published=new ArrayList<>();
        NeteaseApi api=new NeteaseApi("",()->true,(path,payload,weapi)->{
            try { return new JSONObject().put("code",200).put("songs",new JSONArray().put(new JSONObject().put("id",6)).put(new JSONObject().put("id",4))); }
            catch (JSONException error) { throw new AssertionError(error); }
        });
        List<JSONObject> result=api.tracks(data,(rows,total)->{assertEquals(6,total);for(JSONObject row:rows)published.add(row.optLong("id"));});
        assertEquals(Arrays.asList(1L,2L,4L,6L),published);assertEquals(4,result.size());
    }
}
