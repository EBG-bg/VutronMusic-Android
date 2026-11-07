package io.github.vutronmusic.personal;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.util.Iterator;

/** Desktop trackMatch policy; runs only on an explicit background library operation. */
final class PluginSourceMatching {
    private static final Object[] TRACK_LOCKS=new Object[32];
    static {for(int i=0;i<TRACK_LOCKS.length;i++)TRACK_LOCKS[i]=new Object();}
    interface Calls {
        JSONObject call(String pluginId, String method, JSONObject params) throws Exception;
        String accountScope(String pluginId) throws Exception;
        boolean networkAllowed();
        default void failure(String pluginId, Exception error) { }
    }
    private final PluginSourceRegistry registry;
    private final Calls calls;
    PluginSourceMatching(PluginSourceRegistry registry, Calls calls) { this.registry=registry;this.calls=calls; }

    static JSONArray match(Context context, String sourcePlugin, String sourceScope, JSONObject track, JSONArray installed) throws Exception {
        return new PluginSourceMatching(new PluginSourceRegistry(new File(context.getFilesDir(),"plugin-sources-v1")),new Calls() {
            @Override public JSONObject call(String id,String method,JSONObject params) throws Exception { return AndroidPluginManager.call(context,id,method,params); }
            @Override public String accountScope(String id) throws Exception { return AndroidPluginManager.accountScope(context,id); }
            @Override public boolean networkAllowed() { return AndroidPluginManager.networkAllowed(context); }
            @Override public void failure(String id,Exception error) { android.util.Log.w("VutronPluginMatch",id+": "+error.getClass().getSimpleName()); }
        }).match(sourcePlugin,sourceScope,track,installed);
    }

    JSONArray match(String sourcePlugin, String sourceScope, JSONObject track, JSONArray installed) throws Exception {
        String identity=sourcePlugin+"\0"+sourceScope+"\0"+(track==null?"":String.valueOf(track.opt("id")));
        synchronized(TRACK_LOCKS[Math.floorMod(identity.hashCode(),TRACK_LOCKS.length)]) {
            cancelled();
            return matchLocked(sourcePlugin,sourceScope,track,installed);
        }
    }
    private JSONArray matchLocked(String sourcePlugin, String sourceScope, JSONObject track, JSONArray installed) throws Exception {
        AndroidPluginManager.identity(sourcePlugin);
        if(track==null||track.optJSONObject("sourceContext")==null)throw new IOException("匹配歌曲缺少原始来源");
        JSONArray results=new JSONArray(); JSONObject owner=metadata(installed,sourcePlugin);
        if(owner==null||!owner.optBoolean("enabled",true)||"library".equals(owner.optString("type"))||!calls.networkAllowed())return results;
        requireOwner(sourcePlugin,sourceScope);
        JSONArray linked=registry.sources(sourcePlugin,sourceScope,track);
        for(int i=0;installed!=null&&i<installed.length();i++) {
            cancelled(); if(!calls.networkAllowed())break; requireOwner(sourcePlugin,sourceScope);
            JSONObject plugin=installed.optJSONObject(i); if(plugin==null)continue;
            String id=plugin.optString("id"),scope=plugin.optString("accountScope");
            JSONObject capabilities=plugin.optJSONObject("capabilities");String mode=capabilities==null?"":capabilities.optString("matchTrack");
            if(!plugin.optBoolean("enabled",true)||!"library".equals(plugin.optString("type"))
                    ||!(mode.equals("official")||mode.equals("search"))||!method(plugin,"matchTrack")||contains(linked,id,scope))continue;
            try {
                if(!scope.equals(calls.accountScope(id)))continue;
                JSONObject params=parameters(track),response=calls.call(id,"matchTrack",params);
                cancelled(); if(!calls.networkAllowed())break; requireOwner(sourcePlugin,sourceScope);
                if(!scope.equals(calls.accountScope(id))||response.optInt("code")!=200||response.optJSONObject("data")==null)continue;
                JSONObject matched=response.getJSONObject("data");double confidence=matched.optDouble("confidence",100);
                int status=PluginSourceRegistry.automaticMatch(mode,confidence); if(status<0)continue;
                if(!publicId(matched)) {
                    if(!method(plugin,"getTrackDetail")||matched.optJSONObject("sourceContext")==null)continue;
                    JSONObject details=calls.call(id,"getTrackDetail",new JSONObject().put("tracks",new JSONArray().put(matched.getJSONObject("sourceContext"))));
                    JSONArray rows=details.optJSONArray("data");
                    if(details.optInt("code")!=200||rows==null||rows.length()==0||!publicId(rows.optJSONObject(0)))continue;
                    matched=rows.getJSONObject(0);
                }
                cancelled(); if(!calls.networkAllowed())break; requireOwner(sourcePlugin,sourceScope);
                if(!scope.equals(calls.accountScope(id)))continue;
                registry.link(sourcePlugin,sourceScope,track,id,scope,matched,status);
                linked=registry.sources(sourcePlugin,sourceScope,track);
                results.put(new JSONObject().put("pluginId",id).put("accountScope",scope).put("trackId",String.valueOf(matched.get("id")))
                        .put("matched",status).put("confidence",confidence).put("picUrl",matched.optString("picUrl")));
            }catch(InterruptedIOException interrupted){throw interrupted;}
            catch(Exception error){calls.failure(id,error);}
        }
        return results;
    }

    static JSONObject parameters(JSONObject track) throws Exception {
        JSONArray artists=new JSONArray(),rawArtists=track.optJSONArray("artists");
        for(int i=0;rawArtists!=null&&i<rawArtists.length();i++) {
            JSONObject artist=rawArtists.optJSONObject(i);String name=artist==null?rawArtists.optString(i):artist.optString("name");if(!name.isEmpty())artists.put(name);
        }
        JSONObject album=track.optJSONObject("album");
        JSONObject result=new JSONObject().put("name",track.optString("name")).put("album",album==null?track.optString("album"):album.optString("name"))
                .put("artists",artists).put("duration",track.optLong("duration"));
        JSONObject context=track.getJSONObject("sourceContext");
        for(Iterator<String> keys=context.keys();keys.hasNext();) {String key=keys.next();result.put(key,context.get(key));}
        return result;
    }
    private void requireOwner(String id,String scope) throws Exception { if(!scope.equals(calls.accountScope(id)))throw new IOException("匹配歌曲所属账号已变化"); }
    private static void cancelled() throws InterruptedIOException { if(Thread.currentThread().isInterrupted())throw new InterruptedIOException("Plugin source matching cancelled"); }
    private static boolean publicId(JSONObject track) { if(track==null)return false;Object id=track.opt("id");return (id instanceof String||id instanceof Number)&&!String.valueOf(id).isEmpty(); }
    private static boolean method(JSONObject plugin,String method) {return has(plugin.optJSONArray("methods"),method)&&!has(plugin.optJSONArray("unsupportedMethods"),method);}
    private static boolean has(JSONArray values,String value) {for(int i=0;values!=null&&i<values.length();i++)if(value.equals(values.optString(i)))return true;return false;}
    private static boolean contains(JSONArray rows,String id,String scope) {for(int i=0;i<rows.length();i++){JSONObject row=rows.optJSONObject(i);if(row!=null&&id.equals(row.optString("pluginId"))&&scope.equals(row.optString("accountScope")))return true;}return false;}
    private static JSONObject metadata(JSONArray rows,String id) {for(int i=0;rows!=null&&i<rows.length();i++){JSONObject row=rows.optJSONObject(i);if(row!=null&&id.equals(row.optString("id")))return row;}return null;}
}
