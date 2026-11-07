package io.github.vutronmusic.personal;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.util.Collections;
import static org.junit.Assert.*;

public class PluginNeteaseSessionTest {
    private static final String HASH="b54e6441873bbff27c947d717611ef92842ed1712955be1cf8bd77e79a82dfb1";
    private static JSONObject registry() throws Exception {
        JSONArray definitions=new JSONArray().put(new JSONObject().put("id","netease").put("type","library").put("name","NetEase"));
        JSONObject result=AndroidPluginManager.reconcileRegistry(new JSONObject().put("format",3).put("plugins",new JSONObject()),definitions,Collections.emptySet());
        result.getJSONObject("plugins").getJSONObject("netease").put("enabled",true);return result;
    }
    private static JSONObject state(Object cookie) throws Exception { return new JSONObject().put("store",new JSONObject().put("baseUrl","http://localhost:41830/netease")).put("db",new JSONObject().put("PluginData",new JSONObject().put("userId",7).put("cookie",cookie))); }
    private static String scope(String id,JSONObject state) throws Exception { return AndroidPluginManager.accountFingerprint(id,false,state.getJSONObject("store").getString("baseUrl"),state.getJSONObject("db").getJSONObject("PluginData"),state.optLong("accountGeneration")); }
    @Test public void verifiedBuiltinReturnsOnlyItsOwnExactStringCookie() throws Exception {
        JSONObject state=state("MUSIC_U=plugin-only; __csrf=opaque%3D");String expected=scope("netease",state);
        AndroidPluginManager.NeteasePlaybackSession value=AndroidPluginManager.neteasePlaybackSession(registry(),"netease",expected,state,HASH);
        assertEquals("MUSIC_U=plugin-only; __csrf=opaque%3D",value.cookie);assertEquals(expected,value.scope);
    }
    @Test public void aClosedBaseDoesNotBlockItsEnabledIndependentInstance() throws Exception {
        JSONObject registry=registry(),state=state("MUSIC_U=instance-only");registry.getJSONObject("plugins").getJSONObject("netease").put("enabled",false);
        registry.getJSONObject("plugins").put("netease:other",new JSONObject().put("id","netease:other").put("baseId","netease").put("builtIn",false).put("enabled",true));
        assertEquals("MUSIC_U=instance-only",AndroidPluginManager.neteasePlaybackSession(registry,"netease:other",scope("netease:other",state),state,HASH).cookie);
    }
    @Test public void closedSourceChangedAccountAndModifiedSourceAreRejected() throws Exception {
        JSONObject state=state("private"),registry=registry();String expected=scope("netease",state);
        for(String hash:new String[]{"different-source",HASH}) {
            registry.getJSONObject("plugins").getJSONObject("netease").put("enabled",HASH.equals(hash)?false:true);
            try{AndroidPluginManager.neteasePlaybackSession(registry,"netease",expected,state,hash);fail();}catch(AndroidPluginManager.PluginFailure error){assertEquals(HASH.equals(hash)?"PLUGIN_DISABLED":"PLUGIN_SESSION_SOURCE",error.code);}
        }
        registry.getJSONObject("plugins").getJSONObject("netease").put("enabled",true);
        for(String invalid:new String[]{"","other-account"})try{AndroidPluginManager.neteasePlaybackSession(registry,"netease",invalid,state,HASH);fail();}catch(AndroidPluginManager.PluginFailure error){assertEquals("PLUGIN_ACCOUNT_CHANGED",error.code);}
        registry.getJSONObject("plugins").put("user_imported",new JSONObject().put("id","user_imported").put("baseId","netease").put("enabled",true));
        try{AndroidPluginManager.neteasePlaybackSession(registry,"user_imported",scope("user_imported",state),state,HASH);fail();}catch(AndroidPluginManager.PluginFailure error){assertEquals("PLUGIN_SESSION_SOURCE",error.code);}
    }
    @Test public void missingAndEmptyCookiesRemainPluginAnonymousWithoutBorrowingAnotherSession() throws Exception {
        JSONObject empty=state("");assertEquals("",AndroidPluginManager.neteasePlaybackSession(registry(),"netease",scope("netease",empty),empty,HASH).cookie);
        empty.getJSONObject("db").getJSONObject("PluginData").remove("cookie");assertEquals("",AndroidPluginManager.neteasePlaybackSession(registry(),"netease",scope("netease",empty),empty,HASH).cookie);
    }
    @Test public void malformedCookieValuesAndHeaderInjectionNeverReachTheNativeTransport() throws Exception {
        for(Object cookie:new Object[]{new JSONArray().put("MUSIC_U=bad"),new JSONObject().put("cookie","bad"),JSONObject.NULL,"MUSIC_U=bad\r\nHeader: value"}) {
            JSONObject state=state(cookie);try{AndroidPluginManager.neteasePlaybackSession(registry(),"netease",scope("netease",state),state,HASH);fail();}catch(AndroidPluginManager.PluginFailure error){assertEquals("PLUGIN_SESSION",error.code);}
        }
    }
}
