package io.github.vutronmusic.personal;

import android.content.Context;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Original plugin playback/scrobble contract, independent of the WebView. */
final class PluginPlaybackReporter {
    private static final ThreadPoolExecutor IO = new ThreadPoolExecutor(1,1,30,TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(64), task -> { Thread thread=new Thread(task,"vutron-plugin-reports");thread.setDaemon(true);return thread; });
    private PluginPlaybackReporter() { }
    interface Invocation { void call(String method, JSONObject params) throws Exception; }
    interface SourceInvocation { void call(JSONObject source, String method, JSONObject params) throws Exception; }
    interface Failure { void failed(String method, Exception failure); }
    static boolean shouldScrobble(long position, long duration) { return duration>0 && (position>=duration/2 || position>=30000); }
    static void dispatch(JSONObject song, String type, long position, long duration, boolean playing, Invocation invocation, Failure failure) {
        JSONObject source = song.optJSONObject("pluginSourceContext");
        dispatchSource(song,source,type,position,duration,playing,invocation,failure);
    }
    private static void dispatchSource(JSONObject song, JSONObject source, String type, long position, long duration, boolean playing, Invocation invocation, Failure failure) {
        if (source == null) return;
        try {
            invocation.call("reportPlayback", new JSONObject(source.toString()).put("type",type).put("playing",playing)
                    .put("position",position/1000d).put("duration",duration/1000d));
        } catch (Exception error) { failure.failed("reportPlayback", error); }
        if (!"end".equals(type) || !shouldScrobble(position,duration)) return;
        try {
            JSONObject playlist = song.optJSONObject("pluginPlaylistContext");
            JSONObject context = new JSONObject().put("plugin",song.optString("pluginPlaylistOwner",song.optString("pluginId")))
                    .put("sourceContext",playlist == null ? new JSONObject() : new JSONObject(playlist.toString()));
            invocation.call("scrobble",new JSONObject(source.toString()).put("time",position).put("sourceCtx",context));
        } catch (Exception error) { failure.failed("scrobble", error); }
    }
    static JSONArray targets(JSONObject song, JSONArray linked) throws Exception {
        JSONArray values=new JSONArray(); Set<String> seen=new HashSet<>();
        JSONObject own=new JSONObject().put("pluginId",song.optString("pluginId")).put("accountScope",song.optString("pluginAccountScope"))
                .put("trackId",song.optString("pluginTrackId")).put("sourceContext",song.optJSONObject("pluginSourceContext"));
        for(int i=-1;i<(linked==null?0:linked.length());i++) {
            JSONObject value=i<0?own:linked.optJSONObject(i);
            if(value==null || value.optJSONObject("sourceContext")==null || value.optString("pluginId").isEmpty())continue;
            String key=value.optString("pluginId")+"\n"+value.optString("accountScope");
            if(seen.add(key))values.put(new JSONObject(value.toString()));
        }
        return values;
    }
    static boolean eligible(JSONObject source, JSONObject plugin, String method, boolean networkAllowed) {
        if(plugin==null || !source.optString("pluginId").equals(plugin.optString("id")) || !plugin.optBoolean("enabled",true))return false;
        String scope=source.optString("accountScope");
        if(scope.isEmpty() || !scope.equals(plugin.optString("accountScope")))return false;
        if(!networkAllowed && !"local".equals(plugin.optString("type")))return false;
        return contains(plugin.optJSONArray("methods"),method) && !contains(plugin.optJSONArray("unsupportedMethods"),method);
    }
    private static boolean contains(JSONArray values,String wanted) {
        for(int i=0;values!=null&&i<values.length();i++)if(wanted.equals(values.optString(i)))return true;
        return false;
    }
    static void broadcast(JSONObject song, JSONArray sources, String type, long position, long duration, boolean playing, SourceInvocation invocation, Failure failure) throws Exception {
        JSONArray targets=targets(song,sources);
        for(int i=0;i<targets.length();i++) {
            JSONObject target=targets.getJSONObject(i);
            dispatchSource(song,target.getJSONObject("sourceContext"),type,position,duration,playing,
                    (method,args)->invocation.call(target,method,args),failure);
        }
    }
    static void report(Context context, JSONObject song, String type, long position, long duration, boolean playing) {
        if (!PluginMedia.isPlugin(song)) return;
        try {
            final JSONObject snapshot=new JSONObject(song.toString()); final Context app=context.getApplicationContext();
            IO.execute(() -> {
                Failure failure=(method,error)->Log.w("VutronPluginPlayback","Plugin "+method+" failed: "+error.getClass().getSimpleName());
                try { if(!AndroidPluginManager.installed(app,snapshot.optString("pluginId")))return; }
                catch(Exception unavailable){failure.failed("installed",unavailable);return;}
                JSONArray linked=new JSONArray();
                try {
                    JSONObject original=snapshot.optJSONObject("pluginTrack");
                    if(original!=null)linked=PluginSourceRegistry.sources(app,snapshot.optString("pluginId"),snapshot.optString("pluginAccountScope"),original);
                }catch(Exception error){failure.failed("sources",error);}
                try {
                    broadcast(snapshot,linked,type,position,duration,playing,(source,method,args) -> {
                        String id=source.optString("pluginId"); JSONArray installed=AndroidPluginManager.list(app).getJSONArray("plugins"); JSONObject metadata=null;
                        for(int i=0;i<installed.length();i++)if(id.equals(installed.getJSONObject(i).optString("id"))){metadata=installed.getJSONObject(i);break;}
                        if(!eligible(source,metadata,method,AndroidPluginManager.networkAllowed(app)))return;
                        AndroidPluginManager.callScoped(app,id,method,args,source.optString("accountScope"));
                    },failure);
                }catch(Exception error){failure.failed("sources",error);}
            });
        } catch (Exception failure) { Log.w("VutronPluginPlayback","Plugin playback report queue unavailable: "+failure.getClass().getSimpleName()); }
    }
}
