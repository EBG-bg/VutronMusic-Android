package io.github.vutronmusic.personal;

import android.content.Context;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Iterator;
import java.util.Set;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Android ownership, offline policy and private storage for the upstream plugin host. */
final class AndroidPluginManager {
    private static final int MAX_BYTES = 32 * 1024 * 1024;
    private static final String DIRECTORY = "music-plugins-v1";
    private static final String NETEASE_SOURCE_SHA256 = "b54e6441873bbff27c947d717611ef92842ed1712955be1cf8bd77e79a82dfb1";
    private static volatile String verifiedNeteaseSourceHash;
    private AndroidPluginManager() { }

    static final class PluginFailure extends IOException {
        final String code;
        PluginFailure(String code, String message) { super("[" + code + "] " + message); this.code = code; }
    }

    static boolean networkAllowed(Context context) { return !LocalOnlyMode.manual(context) && MusicConnectivity.available(context); }
    static boolean installed(Context context,String id) throws Exception { identity(id);return registry(context).getJSONObject("plugins").optJSONObject(id)!=null; }
    static JSONObject requireInstalled(Context context,String id) throws Exception { return requireInstalled(registry(context),id); }
    static JSONObject requireEnabled(Context context,String id) throws Exception { return requireEnabled(registry(context),id); }
    static boolean local(Context context, String id) throws Exception {
        JSONObject value = registry(context).getJSONObject("plugins").optJSONObject(identity(id));
        return value != null && "local".equals(value.optString("type"));
    }
    static long artworkRevision(Context context, String id) { return context.getSharedPreferences("plugin_artwork_revisions", Context.MODE_PRIVATE).getLong(id, 0); }
    static String accountScope(Context context, String id) throws Exception {
        identity(id);
        JSONObject installed = registry(context).getJSONObject("plugins").optJSONObject(id);
        JSONObject state = readJson(new File(root(context), id + ".state.json"), new JSONObject());
        JSONObject store = state.optJSONObject("store"), db = state.optJSONObject("db");
        return accountFingerprint(id, installed!=null&&"local".equals(installed.optString("type")), store == null ? "" : store.optString("baseUrl"),
                db == null || db.optJSONObject("PluginData") == null ? new JSONObject() : db.getJSONObject("PluginData"), state.optLong("accountGeneration", 0));
    }
    static final class NeteasePlaybackSession {
        final String cookie, scope;
        NeteasePlaybackSession(String cookie, String scope) { this.cookie=cookie;this.scope=scope; }
    }
    /** Native-only snapshot of the verified compatibility plugin's own account. */
    static NeteasePlaybackSession neteasePlaybackSession(Context context,String id,String expectedScope) throws Exception {
        JSONObject document=registry(context);String hash=neteaseSourceHash(context);verifiedNeteaseDefinition(document,id,hash);
        JSONObject state=readJson(new File(root(context),identity(id)+".state.json"),new JSONObject());
        return neteasePlaybackSession(document,id,expectedScope,state,hash);
    }
    static void requireNeteasePlaybackScope(Context context,String id,String expectedScope) throws Exception {
        JSONObject document=registry(context);String hash=neteaseSourceHash(context);verifiedNeteaseDefinition(document,id,hash);
        JSONObject state=readJson(new File(root(context),identity(id)+".state.json"),new JSONObject());
        verifiedNeteaseScope(document,id,expectedScope,state,hash);
    }
    static NeteasePlaybackSession neteasePlaybackSession(JSONObject document,String id,String expectedScope,JSONObject state,String sourceHash) throws Exception {
        String scope=verifiedNeteaseScope(document,id,expectedScope,state,sourceHash);
        JSONObject db=state.optJSONObject("db"),account=db==null?null:db.optJSONObject("PluginData");
        Object cookie=account==null||!account.has("cookie")?"":account.opt("cookie");
        if(!(cookie instanceof String))throw new PluginFailure("PLUGIN_SESSION","插件登录资料格式无效");
        if(((String)cookie).indexOf('\r')>=0||((String)cookie).indexOf('\n')>=0)throw new PluginFailure("PLUGIN_SESSION","插件登录资料格式无效");
        return new NeteasePlaybackSession((String)cookie,scope);
    }
    private static String verifiedNeteaseScope(JSONObject document,String id,String expectedScope,JSONObject state,String sourceHash) throws Exception {
        verifiedNeteaseDefinition(document,id,sourceHash);
        JSONObject store=state.optJSONObject("store"),db=state.optJSONObject("db");
        String scope=accountFingerprint(id,false,store==null?"":store.optString("baseUrl"),db==null||db.optJSONObject("PluginData")==null?new JSONObject():db.getJSONObject("PluginData"),state.optLong("accountGeneration",0));
        if(expectedScope==null||expectedScope.isEmpty()||!expectedScope.equals(scope))throw new PluginFailure("PLUGIN_ACCOUNT_CHANGED","插件账号或服务器已变化，请重新打开来源");
        return scope;
    }
    private static void verifiedNeteaseDefinition(JSONObject document,String id,String sourceHash) throws Exception {
        JSONObject selected=requireEnabled(document,id);String baseId=selected.optString("baseId",id);JSONObject base=requireInstalled(document,baseId);
        boolean ownId="netease".equals(id)||id.startsWith("netease:")&&!selected.optBoolean("builtIn");
        if(!ownId||!id.equals(selected.optString("id"))||!"netease".equals(baseId)||!base.optBoolean("builtIn")||!"netease".equals(base.optString("id"))||!NETEASE_SOURCE_SHA256.equals(sourceHash))
            throw new PluginFailure("PLUGIN_SESSION_SOURCE","仅原版内置网易云来源可使用原生播放策略");
    }
    private static String neteaseSourceHash(Context context) throws Exception {
        if(verifiedNeteaseSourceHash!=null)return verifiedNeteaseSourceHash;
        synchronized(AndroidPluginManager.class) {
            if(verifiedNeteaseSourceHash==null)try(InputStream input=context.getAssets().open("sources-runtime/plugins/netease.js")) {
                MessageDigest hash=MessageDigest.getInstance("SHA-256");byte[] buffer=new byte[8192];int count;
                while((count=input.read(buffer))!=-1)hash.update(buffer,0,count);
                StringBuilder value=new StringBuilder();for(byte item:hash.digest())value.append(String.format(java.util.Locale.ROOT,"%02x",item&255));
                verifiedNeteaseSourceHash=value.toString();
            }
            return verifiedNeteaseSourceHash;
        }
    }
    static String accountFingerprint(String id, boolean local, String baseUrl, JSONObject account, long unknownAccountGeneration) throws Exception {
        if (local) return digest("plugin-account-v1\n" + id + "\nlocal");
        String server = baseUrl;
        try {
            java.net.URI address = new java.net.URI(baseUrl);
            if (address.getHost() != null) {
                String scheme = address.getScheme().toLowerCase(java.util.Locale.ROOT);
                int port = address.getPort() < 0 ? ("https".equals(scheme) ? 443 : 80) : address.getPort();
                String resource = address.getRawPath() == null ? "" : address.getRawPath().replaceAll("/+$", "");
                server = scheme + "://" + address.getHost().toLowerCase(java.util.Locale.ROOT) + ":" + port + resource;
            }
        } catch (java.net.URISyntaxException ignored) { }
        String identity = "";
        for (String key : new String[]{"userId", "user_id", "userid", "UserId", "userName", "username", "account", "email"}) {
            Object value = account.opt(key);
            if (!(value instanceof Number || value instanceof String)) continue;
            String text = String.valueOf(value).trim();
            if (!text.isEmpty() && !text.equals("0")) { identity = key.toLowerCase(java.util.Locale.ROOT) + ":" + text; break; }
        }
        if (identity.isEmpty()) identity = "private-account-generation:" + unknownAccountGeneration;
        return digest("plugin-account-v1\n" + id + "\n" + server + "\n" + identity);
    }
    private static synchronized void invalidateArtwork(Context context, String id) {
        android.content.SharedPreferences prefs = context.getSharedPreferences("plugin_artwork_revisions", Context.MODE_PRIVATE);
        prefs.edit().putLong(id, prefs.getLong(id, 0) + 1).apply();
    }

    static synchronized JSONObject list(Context context) throws Exception {
        JSONObject document = registry(context), entries = document.getJSONObject("plugins");
        JSONArray result = new JSONArray();
        for (Iterator<String> i = entries.keys(); i.hasNext();) {
            String id = identity(i.next()); JSONObject source = entries.getJSONObject(id);
            JSONObject item = new JSONObject();
            for (String name : new String[]{"id", "baseId", "name", "type", "icon", "enabled", "builtIn", "capabilities", "methods", "unsupportedMethods", "status"}) if (source.has(name)) item.put(name, source.get(name));
            item.put("installed", true);
            JSONObject state = readJson(new File(root(context), id + ".state.json"), new JSONObject());
            item.put("baseUrl", state.optJSONObject("store") == null ? "" : state.getJSONObject("store").optString("baseUrl", ""));
            item.put("accountScope", accountFingerprint(id, "local".equals(source.optString("type")), item.optString("baseUrl"),
                    state.optJSONObject("db") == null || state.getJSONObject("db").optJSONObject("PluginData") == null ? new JSONObject() : state.getJSONObject("db").getJSONObject("PluginData"), state.optLong("accountGeneration", 0)));
            result.put(item);
        }
        return new JSONObject().put("format",3).put("plugins", result).put("catalog", catalogProjection(catalog(context),entries));
    }

    static synchronized JSONObject manage(Context context, JSONObject request) throws Exception {
        String action = request.optString("action");
        if (action.equals("list")) return list(context);
        if (action.equals("import") || action.equals("inspect")) {
            String source = request.optString("source");
            if (source.trim().isEmpty() || source.getBytes(StandardCharsets.UTF_8).length > 1024 * 1024) throw new PluginFailure("PLUGIN_SOURCE_LIMIT", "请选择不超过 1 MiB 的 JavaScript 插件");
            request = new JSONObject(request.toString()).put("allowNetwork", false);
            return checked(EmbeddedSources.pluginRequest(context, request));
        }
        String id = identity(request.optString("id"));
        // Once the Node host exists it owns mutation ordering and terminates the
        // corresponding Worker before deleting a plugin or changing its server.
        if (EmbeddedSources.runtimeStarted()) {
            JSONObject result = checked(EmbeddedSources.pluginRequest(context, new JSONObject(request.toString()).put("allowNetwork", networkAllowed(context))));
            if (action.equals("configure") || action.equals("remove") || action.equals("reset")) invalidateArtwork(context, id);
            return result;
        }
        JSONObject document = registry(context), entries = document.getJSONObject("plugins"), selected = entries.optJSONObject(id);
        if (action.equals("install")) {
            boolean alreadyInstalled = selected != null;
            installRegistry(document, catalog(context), id);
            LibraryFiles.writeJson(new File(root(context), "registry.json"), document);
            JSONObject result=list(context).put("installed",!alreadyInstalled);
            JSONArray rows=result.getJSONArray("plugins");for(int i=0;i<rows.length();i++)if(id.equals(rows.getJSONObject(i).optString("id")))result.put("plugin",rows.getJSONObject(i));
            return result;
        }
        selected = requireInstalled(document, id);
        if (action.equals("logs")) return new JSONObject().put("logs", new JSONArray());
        if (action.equals("enable") || action.equals("disable")) selected.put("enabled", action.equals("enable"));
        else if (action.equals("configure")) {
            File file = new File(root(context), id + ".state.json");
            JSONObject state = readJson(file, new JSONObject()), store = state.optJSONObject("store");
            if (store == null) { store = new JSONObject(); state.put("store", store); }
            if (request.has("baseUrl")) {
                String base = request.optString("baseUrl").trim();
                if (!base.isEmpty()) {
                    java.net.URI url = new java.net.URI(base);
                    if (!("http".equalsIgnoreCase(url.getScheme()) || "https".equalsIgnoreCase(url.getScheme())) || url.getHost() == null || url.getUserInfo() != null || url.getFragment() != null) throw new PluginFailure("PLUGIN_URL", "服务器地址必须是无内嵌凭据的 HTTP 或 HTTPS 地址");
                }
                store.put("baseUrl", base.replaceAll("/$", ""));
            }
            state.put("accountGeneration", state.optLong("accountGeneration", 0) + 1);
            LibraryFiles.writeJson(file, state);
        } else if (action.equals("instance")) {
            requireInstanceBase(document, id);
            if (entries.length() >= 64) throw new PluginFailure("PLUGIN_LIMIT", "最多可安装 64 个插件及实例");
            String baseId = selected.optString("baseId", id), instanceId = identity(baseId.split(":")[0] + ":" + UUID.randomUUID().toString().replace("-", "").substring(0, 12));
            JSONObject instance = new JSONObject(selected.toString()).put("id", instanceId).put("baseId", baseId).put("builtIn", false)
                    .put("enabled", true).put("status", "logout").put("createdAt", System.currentTimeMillis());
            String name = request.optString("name", selected.optString("name")).trim();
            instance.put("name", name.substring(0, Math.min(120, name.length()))); entries.put(instanceId, instance);
        } else if (action.equals("remove") || action.equals("reset")) {
            if(action.equals("reset"))resetRegistry(root(context),document,id);else uninstallRegistry(root(context),document,id);
            invalidateArtwork(context,id);
            return list(context).put(action.equals("reset")?"reset":"removed",true);
        } else throw new PluginFailure("PLUGIN_ACTION", "不支持的插件管理操作");
        LibraryFiles.writeJson(new File(root(context), "registry.json"), document);
        if (action.equals("configure") || action.equals("remove")) invalidateArtwork(context, id);
        return list(context);
    }

    static JSONObject call(Context context, String id, String method, JSONObject params) throws Exception {
        Object result = invoke(context, id, method, params);
        if (!(result instanceof JSONObject)) throw new PluginFailure("PLUGIN_RESULT", "此插件方法返回非对象结果，请使用通用调用入口");
        return (JSONObject) result;
    }
    static JSONObject callScoped(Context context, String id, String method, JSONObject params, String expectedScope) throws Exception {
        Object result = invoke(context, id, method, params, expectedScope);
        if (!(result instanceof JSONObject)) throw new PluginFailure("PLUGIN_RESULT", "插件上报未返回符合原版协议的对象结果");
        return (JSONObject) result;
    }

    static Object invoke(Context context, String id, String method, JSONObject params) throws Exception {
        return invoke(context, id, method, params, "");
    }
    static Object invoke(Context context, String id, String method, JSONObject params, String expectedScope) throws Exception {
        identity(id);
        JSONObject installed = requireEnabled(registry(context), id);
        if ("getLyric".equals(method)) prepareLocalLyrics(context, id, params);
        JSONObject request = new JSONObject().put("action", "call").put("id", id).put("method", method)
                .put("params", params == null ? new JSONObject() : params).put("allowNetwork", networkAllowed(context)).put("allowMatchSources", SourceSettings.autoMatch(context));
        if (expectedScope != null && !expectedScope.isEmpty()) request.put("expectedAccountScope", expectedScope);
        JSONObject response = checked(EmbeddedSources.pluginRequest(context, request));
        Object result = response.opt("result");
        if (result == null || result == JSONObject.NULL) throw new PluginFailure("PLUGIN_RESULT", "插件未返回符合原版协议的结果");
        if (result instanceof JSONObject) {
            JSONObject value = (JSONObject) result;
            if ((value.optInt("code") == 200 && (method.equals("doLogin") || method.equals("doLogout") || method.equals("updateBaseUrl")))
                    || method.equals("loginQrCodeCheck") && value.optInt("code") == 803) invalidateArtwork(context, id);
        }
        return result;
    }

    static JSONObject resolveMedia(Context context, String id, String url, JSONObject headers) throws Exception {
        JSONObject installed = requireEnabled(registry(context), id);
        return checkedMedia(EmbeddedSources.pluginMedia(context, identity(id), url, headers, networkAllowed(context)));
    }

    static void onNetworkPolicyChanged(Context context) {
        if (!EmbeddedSources.runtimeStarted()) return;
        Thread update = new Thread(() -> {
            try { EmbeddedSources.pluginRequest(context, new JSONObject().put("action", "policy").put("allowNetwork", networkAllowed(context))); }
            catch (Exception failure) { Log.w("VutronPlugins", "Plugin network policy update failed: " + failure.getClass().getSimpleName()); }
        }, "vutron-plugin-policy");
        update.setDaemon(true); update.start();
    }

    static void syncLocalLibrary(Context context, JSONArray rawTracks) throws Exception {
        JSONObject installed = registry(context).getJSONObject("plugins"); JSONArray targets = new JSONArray();
        targets=enabledLocalIds(installed);
        if(targets.length()==0)return;
        File indexFile = new File(root(context), "native-local-index.json");
        JSONArray folders = LocalFolderStore.list(context);
        String fingerprint = digest(rawTracks.toString() + "|" + folders.toString());
        JSONArray pending = new JSONArray();
        for(int i=0;i<targets.length();i++) { String id=targets.getString(i);JSONObject state=readJson(new File(root(context),id+".state.json"),new JSONObject());if(!fingerprint.equals(state.optString("localLibraryFingerprint")))pending.put(id); }
        if(pending.length()==0)return;
        JSONArray tracks = new JSONArray(), albums = new JSONArray(), artists = new JSONArray();
        JSONObject knownAlbums = new JSONObject(), knownArtists = new JSONObject(), resources = new JSONObject();
        for (int i = 0; i < rawTracks.length(); i++) {
            JSONObject row = rawTracks.optJSONObject(i); if (row == null) continue;
            String uri = row.optString("localUri", row.optString("localPath", ""));
            String albumName = row.optString("album", ""), albumId = digest("album:" + albumName);
            JSONArray names = row.optJSONArray("artists"), people = new JSONArray();
            if (names != null) for (int n = 0; n < names.length(); n++) {
                String name = names.optJSONObject(n) == null ? names.optString(n) : names.optJSONObject(n).optString("name");
                if (name.trim().isEmpty()) continue;
                String personId = digest("artist:" + name); JSONObject person = new JSONObject().put("id", personId).put("name", name);
                people.put(person); if (!knownArtists.has(personId)) { knownArtists.put(personId, true); artists.put(person); }
            }
            JSONObject track = new JSONObject().put("id", String.valueOf(row.optLong("id"))).put("name", row.optString("name"))
                    .put("duration", row.optLong("duration")).put("albumId", albumId).put("albumName", albumName)
                    .put("artists", people).put("albumArtists", people).put("filePath", uri).put("size", row.optLong("bytes"))
                    .put("md5", row.optString("md5")).put("cueOffset", row.optLong("cueOffsetMs")).put("cueDuration", row.optLong("cueDurationMs"))
                    .put("no", row.optInt("cueTrackNo")).put("createTime", row.optLong("createTime", System.currentTimeMillis()));
            tracks.put(track);
            if (!knownAlbums.has(albumId)) { knownAlbums.put(albumId, true); albums.put(new JSONObject().put("id", albumId).put("name", albumName).put("artists", people)); }
            if (!uri.isEmpty()) resources.put(uri, new JSONObject().put("exists", true));
        }
        for (int i = 0; i < folders.length(); i++) { JSONObject folder = folders.optJSONObject(i); if (folder != null && !folder.optString("uri").isEmpty()) resources.put(folder.optString("uri"), new JSONObject().put("exists", folder.optBoolean("permissionGranted", false))); }
        for(int i=0;i<pending.length();i++) {
            String id=pending.getString(i);requireEnabled(context,id);
            checked(EmbeddedSources.pluginRequest(context, new JSONObject().put("action", "syncLocalLibrary").put("id", id)
                .put("fingerprint", fingerprint).put("tables", new JSONObject().put("Track", tracks).put("Album", albums).put("Artist", artists)).put("resources", resources)));
        }
        LibraryFiles.writeJson(indexFile, new JSONObject().put("tracks", rawTracks).put("fingerprint", fingerprint));
    }

    private static void prepareLocalLyrics(Context context, String id, JSONObject params) throws Exception {
        if (params == null) return;
        JSONObject metadata = registry(context).getJSONObject("plugins").optJSONObject(id);
        if (metadata == null || !"local".equals(metadata.optString("type"))) return;
        String wanted = params.optString("filePath", "");
        if (wanted.isEmpty()) return;
        JSONObject index = readJson(new File(root(context), "native-local-index.json"), new JSONObject());
        JSONArray rows = index.optJSONArray("tracks");
        JSONObject authorized = new JSONObject();
        if (rows != null) for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row == null || !wanted.equals(LocalLibraryIds.uri(row))) continue;
            LyricRepository.Lyrics path = LocalLyricSource.loadPath(context, row), embedded = LocalLyricSource.loadEmbedded(context, row);
            JSONObject resources = lyricResources(wanted, path, embedded);
            for (Iterator<String> keys = resources.keys(); keys.hasNext();) { String key = keys.next(); authorized.put(key, resources.get(key)); }
            break;
        }
        checked(EmbeddedSources.pluginRequest(context, new JSONObject().put("action", "resources").put("id", id).put("resources", authorized)));
    }

    static JSONObject lyricResources(String filePath, LyricRepository.Lyrics path, LyricRepository.Lyrics embedded) throws Exception {
        JSONArray pathLyrics = pluginLyrics(path), embeddedLyrics = pluginLyrics(embedded);
        JSONObject resources = new JSONObject().put(filePath, new JSONObject().put("exists", true).put("embeddedLyrics", embeddedLyrics));
        for (String extension : new String[]{".lrc", ".eslrc"}) resources.put(filePath.replaceFirst("\\.[^/.]+$", extension),
                new JSONObject().put("exists", path != null).put("pathLyrics", pathLyrics));
        return resources;
    }

    private static JSONArray pluginLyrics(LyricRepository.Lyrics family) throws Exception {
        JSONArray resources = new JSONArray();
        if (family != null) for (int n = 0; n < family.original.lines.size(); n++) {
                LyricTimeline.Line line = family.original.lines.get(n);
                long end = line.duration > 0 ? line.time + line.duration : n + 1 < family.original.lines.size() ? family.original.lines.get(n + 1).time : line.time + 4000;
                JSONObject lyric = new JSONObject().put("text", line.text); JSONArray words = new JSONArray();
                for (LyricTimeline.Word word : line.words) words.put(new JSONObject().put("start", word.start).put("end", word.start + word.duration)
                        .put("word", line.text.substring(Math.max(0, word.first), Math.min(line.text.length(), word.end))));
                if (words.length() > 0) lyric.put("info", words);
                JSONObject parsed = new JSONObject().put("start", line.time / 1000d).put("end", end / 1000d).put("lyric", lyric);
                if (!family.translationAt(n).isEmpty()) parsed.put("tlyric", new JSONObject().put("text", family.translationAt(n)));
                resources.put(parsed);
        }
        return resources;
    }

    private static JSONObject checkedMedia(JSONObject result) throws IOException {
        if (result.optString("url").isEmpty()) return checked(result);
        return result;
    }
    private static JSONObject checked(JSONObject result) throws IOException {
        if (result.optInt("code") != 200) throw new PluginFailure(result.optString("errorCode", "PLUGIN_ERROR"), result.optString("message", "插件操作失败"));
        return result;
    }
    static String identity(String value) throws IOException {
        if (value == null || !value.matches("[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}(?::[a-zA-Z0-9_-]{1,48})?")) throw new PluginFailure("PLUGIN_ID", "插件标识无效");
        return value;
    }
    private static File root(Context context) throws IOException {
        File directory = new File(context.getFilesDir(), DIRECTORY);
        if (!directory.isDirectory() && !directory.mkdirs() && !directory.isDirectory()) throw new IOException("无法创建插件私有目录");
        return directory;
    }
    private static synchronized JSONObject registry(Context context) throws Exception {
        File directory=root(context),file = new File(directory, "registry.json");
        JSONObject previous = readJson(file, new JSONObject().put("format", 3).put("plugins", new JSONObject()));
        JSONArray catalog = catalog(context);
        JSONObject result = reconcileRegistry(previous,catalog,java.util.Collections.emptySet());
        quarantineOrphans(directory,previous,catalog);
        if(!file.isFile()||!previous.toString().equals(result.toString()))LibraryFiles.writeJson(file,result);
        return result;
    }
    private static JSONArray catalog(Context context) throws Exception {
        try (InputStream input = context.getAssets().open("sources-runtime/plugins/builtin-index.json")) {
            return new JSONArray(readText(input));
        }
    }
    static JSONObject reconcileRegistry(JSONObject previous, JSONArray catalog, Set<String> legacyStates) throws Exception {
        if((previous.optInt("format")!=1 && previous.optInt("format")!=2 && previous.optInt("format")!=3) || previous.optJSONObject("plugins")==null)throw new PluginFailure("PLUGIN_STORAGE","插件索引格式无效");
        JSONObject result=new JSONObject(previous.toString()),plugins=result.getJSONObject("plugins");
        for(int i=0;i<catalog.length();i++) {
            JSONObject item=catalog.getJSONObject(i);String id=identity(item.getString("id"));JSONObject installed=plugins.optJSONObject(id);
            plugins.put(id,installedDefinition(item,installed));
        }
        result.put("format",3);
        return result;
    }
    private static JSONObject installedDefinition(JSONObject item,JSONObject previous) throws Exception {
        boolean enabled=previous!=null&&previous.optBoolean("enabled",true);if(previous==null)previous=new JSONObject();
        String id=identity(item.getString("id"));return new JSONObject(item.toString()).put("baseId",id).put("builtIn",true)
                .put("enabled",enabled).put("name",previous.optString("name",item.optString("name")))
                .put("status",previous.optString("status","logout")).put("createdAt",previous.optLong("createdAt",System.currentTimeMillis()));
    }
    static JSONObject installRegistry(JSONObject document,JSONArray catalog,String id) throws Exception {
        identity(id);JSONObject entries=document.getJSONObject("plugins");
        JSONObject definition=null;for(int i=0;i<catalog.length();i++)if(id.equals(catalog.getJSONObject(i).optString("id"))){definition=catalog.getJSONObject(i);break;}
        if(definition==null)throw new PluginFailure("PLUGIN_CATALOG","此插件不在应用内安装目录中");
        if(entries.optJSONObject(id)!=null)return entries.getJSONObject(id);
        if(entries.length()>=64)throw new PluginFailure("PLUGIN_LIMIT","最多可安装64个插件及实例");
        JSONObject installed=installedDefinition(definition,null);entries.put(id,installed);return installed;
    }
    static JSONObject requireInstalled(JSONObject document,String id) throws Exception {
        identity(id);JSONObject installed=document.getJSONObject("plugins").optJSONObject(id);
        if(installed==null)throw new PluginFailure("PLUGIN_NOT_FOUND","插件未安装");return installed;
    }
    static JSONObject requireInstanceBase(JSONObject document,String id) throws Exception {
        JSONObject installed=requireInstalled(document,id);return requireInstalled(document,installed.optString("baseId",id));
    }
    static void requireRemovable(JSONObject document,String id) throws Exception {
        JSONObject selected=requireInstalled(document,id);JSONObject entries=document.getJSONObject("plugins");
        if(selected.optBoolean("builtIn")&&id.equals(selected.optString("baseId",id)))throw new PluginFailure("PLUGIN_BUILTIN_PROVIDED","内置来源始终提供，请关闭或明确清除插件数据");
        for(Iterator<String> ids=entries.keys();ids.hasNext();) {String other=ids.next();if(!other.equals(id)&&id.equals(entries.getJSONObject(other).optString("baseId")))throw new PluginFailure("PLUGIN_INSTANCES","请先删除该插件的其他实例");}
    }
    static JSONArray catalogProjection(JSONArray catalog,JSONObject entries) throws Exception {
        JSONArray result=new JSONArray();for(int i=0;i<catalog.length();i++) {JSONObject item=new JSONObject(catalog.getJSONObject(i).toString());String id=identity(item.getString("id"));result.put(item.put("baseId",id).put("builtIn",true).put("installed",entries.has(id)));}return result;
    }
    static JSONObject requireEnabled(JSONObject document,String id) throws Exception {
        JSONObject selected=requireInstalled(document,id);if(!selected.optBoolean("enabled",true))throw new PluginFailure("PLUGIN_DISABLED","插件已关闭");return selected;
    }
    static JSONArray enabledLocalIds(JSONObject entries) throws Exception {
        JSONArray targets=new JSONArray();for(Iterator<String> ids=entries.keys();ids.hasNext();) {String id=ids.next();JSONObject item=entries.getJSONObject(id);if(item.optBoolean("enabled",true)&&"local".equals(item.optString("type")))targets.put(id);}return targets;
    }
    static void quarantineOrphans(File directory,JSONObject previous,JSONArray catalog) throws Exception {
        JSONObject entries=previous.getJSONObject("plugins");
        for(int i=0;i<catalog.length();i++) {
            String id=identity(catalog.getJSONObject(i).getString("id"));if(entries.optJSONObject(id)!=null)continue;
            File source=new File(directory,id+".state.json");if(!source.exists())continue;
            File isolated=new File(directory,"inactive-orphans");if(!isolated.isDirectory()&&!isolated.mkdirs()&&!isolated.isDirectory())throw new IOException("无法隔离旧插件资料");
            Files.move(source.toPath(),new File(isolated,id+"."+UUID.randomUUID().toString()+".state.json").toPath());
        }
    }
    static void removePrivateFiles(File directory,String id) throws Exception {
        identity(id);for(File file:new File[]{new File(directory,id+".js"),new File(directory,id+".state.json")})if(file.isFile()&&!file.delete())throw new IOException("无法删除插件私有文件");
    }
    static void uninstallRegistry(File directory,JSONObject document,String id) throws Exception {
        requireRemovable(document,id);clearRegistry(directory,document,id,false);
    }
    static void resetRegistry(File directory,JSONObject document,String id) throws Exception {
        JSONObject selected=requireInstalled(document,id);
        if(!selected.optBoolean("builtIn")||!id.equals(selected.optString("baseId",id)))throw new PluginFailure("PLUGIN_NOT_BUILTIN","仅默认内置来源可清除插件数据，其他来源请移除");
        clearRegistry(directory,document,id,true);
    }
    private static void clearRegistry(File directory,JSONObject document,String id,boolean reset) throws Exception {
        JSONObject entries=document.getJSONObject("plugins"),previous=entries.getJSONObject(id);
        Map<File,byte[]> originals=new LinkedHashMap<>();
        for(File file:new File[]{new File(directory,id+".state.json"),new File(directory,id+".js")})if(file.isFile()) {
            if(file.length()>MAX_BYTES)throw new PluginFailure("PLUGIN_STORAGE_LIMIT","插件私有资料超过容量限制");
            originals.put(file,Files.readAllBytes(file.toPath()));
        }
        try {
            removePrivateFiles(directory,id);if(reset)entries.put(id,new JSONObject(previous.toString()).put("enabled",false).put("status","logout"));else entries.remove(id);LibraryFiles.writeJson(new File(directory,"registry.json"),document);
        }catch(Exception failure) {
            entries.put(id,previous);
            for(Map.Entry<File,byte[]> value:originals.entrySet())if(!value.getKey().exists()) {
                File temporary=new File(value.getKey().getAbsolutePath()+".restore");
                try {
                    try(FileOutputStream output=new FileOutputStream(temporary)){output.write(value.getValue());output.getFD().sync();}
                    if(!temporary.renameTo(value.getKey()))throw new IOException("无法恢复未完成卸载的私有资料");
                }catch(Exception restore){failure.addSuppressed(restore);throw failure;}
            }
            throw failure;
        }
    }
    private static JSONObject readJson(File file, JSONObject fallback) throws Exception {
        if (!file.isFile()) return fallback;
        if (file.length() > MAX_BYTES) throw new IOException("插件私有资料超过容量限制");
        return new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
    }
    private static String readText(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int count;
        while ((count = input.read(buffer)) != -1) { if (output.size() + count > MAX_BYTES) throw new IOException("插件元数据过大"); output.write(buffer, 0, count); }
        return output.toString(StandardCharsets.UTF_8.name());
    }
    static String digest(String value) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)); StringBuilder result = new StringBuilder();
        for (byte item : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", item & 255)); return result.toString();
    }
}
