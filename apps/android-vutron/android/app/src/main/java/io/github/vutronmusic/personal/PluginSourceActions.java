package io.github.vutronmusic.personal;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;

/** Native source mappings and preferences; opaque provider contexts stay private. */
final class PluginSourceActions {
    private PluginSourceActions() { }

    static JSONObject manage(Context context, JSONObject request) throws Exception {
        String action=request.optString("action");
        if (action.equals("sourcePriorities")) return PluginSourceRegistry.priorities(context);
        if (action.equals("setSourcePriorities")) return PluginSourceRegistry.setPriorities(context,request);
        if (action.equals("sourceLink")) {
            String from=request.getString("fromPluginId"), to=request.getString("toPluginId");
            String fromScope=scope(context,from,request.optString("fromAccountScope"));
            String toScope=scope(context,to,request.optString("toAccountScope"));
            return PluginSourceRegistry.link(context,from,fromScope,request.getJSONObject("fromTrack"),to,toScope,
                    request.getJSONObject("toTrack"),request.optInt("matched",1));
        }
        if (action.equals("sourceCandidates") || action.equals("sourceRows") || action.equals("sourceUnlink")) {
            String id=request.getString("pluginId"), account=scope(context,id,request.optString("accountScope"));
            JSONObject track=request.getJSONObject("track");
            if (action.equals("sourceRows")) return new JSONObject().put("sources",PluginSourceRegistry.sources(context,id,account,track));
            if (action.equals("sourceUnlink")) {
                PluginSourceRegistry.unlink(context,id,account,track,request.getString("targetPluginId"),request.getString("targetAccountScope"));
                return new JSONObject().put("sources",PluginSourceRegistry.sources(context,id,account,track));
            }
            JSONArray plugins=AndroidPluginManager.list(context).getJSONArray("plugins");
            PluginSourceMatching.match(context,id,account,track,plugins);
            JSONArray candidates=PluginSourceRegistry.candidates(context,id,account,String.valueOf(track.get("id")),
                    track.getJSONObject("sourceContext"),request.getString("kind"),plugins);
            return new JSONObject().put("candidates",candidates);
        }
        return null;
    }

    private static String scope(Context context,String id,String supplied) throws Exception {
        String current=AndroidPluginManager.accountScope(context,id);
        if (!supplied.isEmpty() && !supplied.equals(current)) throw new IOException("插件账号或服务器已变化，请重新打开来源");
        return current;
    }
}
