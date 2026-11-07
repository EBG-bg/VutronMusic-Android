package io.github.vutronmusic.personal;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Exports local plugin playlists as existing portable, rebindable restored collections. */
final class PluginLocalBackup {
    interface Settings {
        int trackVolume(String plugin, String account, JSONObject track) throws Exception;
        long lyricOffset(String plugin, String account, JSONObject track) throws Exception;
        int playlistVolume(String plugin, String account, String playlist) throws Exception;
    }
    private static final Settings DEFAULTS = new Settings() {
        @Override public int trackVolume(String plugin,String account,JSONObject track) { return 100; }
        @Override public long lyricOffset(String plugin,String account,JSONObject track) { return 0; }
        @Override public int playlistVolume(String plugin,String account,String playlist) { return 100; }
    };
    private PluginLocalBackup() { }
    static JSONArray collections(Context context) throws Exception {
        JSONArray plugins=AndroidPluginManager.list(context).getJSONArray("plugins");
        return collections(new File(context.getFilesDir(),"music-plugins-v1"),plugins,PluginLocalLibrary.tracks(context),new Settings() {
            private JSONObject identity(String plugin,String account,JSONObject raw) throws Exception {
                return PluginTrackAdapter.track(plugin,new JSONObject(raw.toString()).put("sourceContext",new JSONObject()),account);
            }
            @Override public int trackVolume(String plugin,String account,JSONObject track) throws Exception { return PlaybackVolume.trackPercent(context,identity(plugin,account,track)); }
            @Override public long lyricOffset(String plugin,String account,JSONObject track) throws Exception { return LyricOverlaySettings.lyricOffsetMs(context,identity(plugin,account,track)); }
            @Override public int playlistVolume(String plugin,String account,String playlist) throws Exception { return PlaybackVolume.playlistPercent(context,PluginTrackAdapter.playlistKey(plugin,account,playlist)); }
        });
    }
    static JSONArray collections(File root,JSONArray plugins) throws Exception { return collections(root,plugins,new JSONArray(),DEFAULTS); }
    static JSONArray collections(File root,JSONArray plugins,JSONArray authorized,Settings settings) throws Exception {
        JSONArray result=new JSONArray();Map<String,JSONObject> nativeRows=new HashMap<>();
        for(int i=0;authorized!=null&&i<authorized.length();i++) {JSONObject row=authorized.optJSONObject(i);if(row!=null)nativeRows.put(String.valueOf(row.opt("id")),row);}
        for(int i=0;plugins!=null&&i<plugins.length();i++) {
            JSONObject plugin=plugins.optJSONObject(i);if(plugin==null||!"local".equals(plugin.optString("type")))continue;
            String id=AndroidPluginManager.identity(plugin.getString("id")),scope=plugin.optString("accountScope"),name=plugin.optString("name","本地音乐");
            File stateFile=new File(root,id+".state.json");if(!stateFile.isFile())continue;
            if(stateFile.length()>32L*1024*1024)throw new IOException("本地插件资料超过备份读取上限");
            JSONObject state=new JSONObject(new String(Files.readAllBytes(stateFile.toPath()),StandardCharsets.UTF_8)),db=state.optJSONObject("db");if(db==null)continue;
            Map<String,JSONObject> recordings=new HashMap<>();JSONArray tracks=db.optJSONArray("Track"),liked=new JSONArray();
            for(int n=0;tracks!=null&&n<tracks.length();n++) {
                JSONObject track=tracks.optJSONObject(n);if(track==null)continue;String trackId=String.valueOf(track.get("id"));recordings.put(trackId,track);
                if(track.optBoolean("liked")||track.optInt("liked")==1)liked.put(track);
            }
            if(liked.length()>0)result.put(collection(id,scope,name+" · 我喜欢的音乐","-1", "",0,liked,nativeRows,settings));
            JSONArray playlists=db.optJSONArray("Playlist"),entries=db.optJSONArray("PlaylistEntry");
            for(int n=0;playlists!=null&&n<playlists.length();n++) {
                JSONObject playlist=playlists.getJSONObject(n);String playlistId=String.valueOf(playlist.get("id"));List<JSONObject> ordered=new ArrayList<>();
                for(int e=0;entries!=null&&e<entries.length();e++) {JSONObject entry=entries.optJSONObject(e);if(entry!=null&&playlistId.equals(String.valueOf(entry.opt("playlistId"))))ordered.add(entry);}
                ordered.sort(Comparator.comparingLong(entry->entry.optLong("position")));
                JSONArray rows=new JSONArray();
                for(JSONObject entry:ordered) {
                    String provider=entry.optString("pluginId","local");
                    if(!(provider.equals(id)||provider.equals("local")||provider.equals(plugin.optString("baseId"))))
                        throw new IOException("本地插件歌单含未保存曲目资料的其它来源条目，请先在原歌单确认资料后备份");
                    // This is the original local plugin's documented PlaylistEntry table,
                    // not generic source routing: its sourceContext.id references Track.id.
                    Object raw=entry.opt("sourceContext");JSONObject context=raw instanceof JSONObject?(JSONObject)raw:raw instanceof String?new JSONObject((String)raw):null;
                    JSONObject track=context==null?null:recordings.get(String.valueOf(context.opt("id")));
                    if(track==null)throw new IOException("本地插件歌单有已失效且缺少曲目资料的条目，原资料已保留，请重新扫描后备份");
                    rows.put(track);
                }
                result.put(collection(id,scope,name+" · "+playlist.optString("name","歌单"),playlistId,playlist.optString("description"),playlist.optLong("createTime"),rows,nativeRows,settings));
            }
        }
        return result;
    }
    private static JSONObject collection(String plugin,String scope,String name,String playlist,String description,long created,JSONArray rows,
                                         Map<String,JSONObject> nativeRows,Settings settings) throws Exception {
        JSONArray tracks=new JSONArray();
        for(int i=0;i<rows.length();i++) {
            JSONObject raw=rows.getJSONObject(i),portable=portableTrack(raw,nativeRows.get(String.valueOf(raw.opt("id"))));
            portable.put("volume",settings.trackVolume(plugin,scope,raw)).put("lyricOffsetMs",settings.lyricOffset(plugin,scope,raw));
            portable.put("key",LibraryBackup.digest(LibraryBackup.fingerprint(portable)+":"+i));tracks.put(portable);
        }
        return new JSONObject().put("name",name).put("description",description).put("sortMode","custom").put("tracks",tracks)
                .put("volume",settings.playlistVolume(plugin,scope,playlist)).put("createTime",created)
                .put("collectionKey","pluginlocal:"+LibraryBackup.digest(plugin+"\0"+playlist));
    }
    static JSONObject portableTrack(JSONObject raw,JSONObject authorized) throws Exception {
        JSONArray artists=new JSONArray(),rawArtists=raw.optJSONArray("artists");
        for(int i=0;rawArtists!=null&&i<rawArtists.length();i++) {
            Object value=rawArtists.opt(i);String name=value instanceof String?(String)value:value instanceof JSONObject?text((JSONObject)value,"name"):"";
            if(!name.isEmpty())artists.put(name);
        }
        String album=text(raw,"albumName");if(album.isEmpty())album=raw.optJSONObject("album")==null?text(raw,"album"):text(raw.getJSONObject("album"),"name");
        JSONObject clean=new JSONObject().put("name",text(raw,"name")).put("artists",artists)
                .put("album",album).put("duration",Math.max(0,raw.optLong("duration")));
        JSONObject filenameSource=authorized==null?raw:authorized;
        String filename=text(filenameSource,"localFileName");if(filename.isEmpty())filename=text(filenameSource,"fileName");
        if(filename.isEmpty()) {
            String path=raw.optString("filePath");
            try {java.net.URI uri=new java.net.URI(path);if(uri.getScheme()!=null&&uri.getPath()!=null)path=uri.getPath();}catch(java.net.URISyntaxException ignored){}
            path=path.replace('\\','/');filename=path.substring(path.lastIndexOf('/')+1);
        }
        clean.put("localFileName",filename);
        if(raw.optLong("cueDuration")>0)clean.put("cueTrackNo",Math.max(1,raw.optLong("no"))).put("cueOffsetMs",raw.optLong("cueOffset")).put("cueDurationMs",raw.getLong("cueDuration"));
        return LibraryBackup.portableTrack(clean);
    }
    private static String text(JSONObject value,String key) {return value.opt(key) instanceof String?value.optString(key):"";}
}
