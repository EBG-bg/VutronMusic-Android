package io.github.vutronmusic.personal;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;

/** Original TrackSource links and provider priorities, scoped to each plugin account. */
final class PluginSourceRegistry {
    private static final Object LOCK = new Object();
    private static final int MAX_BYTES = 16 * 1024 * 1024, MAX_GROUPS = 5000;
    private final File file;

    PluginSourceRegistry(File directory) throws IOException {
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法创建插件来源目录");
        file = new File(directory, "index.json");
    }
    private static PluginSourceRegistry open(Context context) throws IOException {
        return new PluginSourceRegistry(new File(context.getFilesDir(), "plugin-sources-v1"));
    }
    static JSONObject priorities(Context context) throws Exception { return open(context).priorities(); }
    static JSONObject setPriorities(Context context, JSONObject value) throws Exception { return open(context).setPriorities(value); }
    static JSONObject link(Context context, String fromPlugin, String fromScope, JSONObject fromTrack,
                           String toPlugin, String toScope, JSONObject toTrack, int matched) throws Exception {
        return open(context).link(fromPlugin, fromScope, fromTrack, toPlugin, toScope, toTrack, matched);
    }
    static JSONArray candidates(Context context, String pluginId, String scope, String trackId, JSONObject rawContext,
                                String kind, JSONArray installed) throws Exception {
        return open(context).candidates(pluginId, scope, trackId, rawContext, kind, installed);
    }
    static JSONArray sources(Context context, String pluginId, String scope, JSONObject track) throws Exception {
        return open(context).sources(pluginId, scope, track);
    }
    static void unlink(Context context, String pluginId, String scope, JSONObject track, String targetPlugin, String targetScope) throws Exception {
        open(context).unlink(pluginId, scope, track, targetPlugin, targetScope);
    }

    JSONObject priorities() throws Exception { synchronized (LOCK) { return priorities(read()); } }
    JSONObject setPriorities(JSONObject value) throws Exception {
        JSONObject validated = sanitizePriorities(value);
        synchronized (LOCK) {
            JSONObject document = read(), priority = priorities(document);
            for (String kind : new String[]{"lyric", "comment"}) if (validated.has(kind)) priority.put(kind, validated.getJSONArray(kind));
            document.put("priority", priority); write(document);
            return cloneObject(priority);
        }
    }
    /** Validate before a multi-domain backup restore writes any preferences. */
    static JSONObject sanitizePriorities(JSONObject value) throws Exception {
        if (value == null) throw new IOException("来源优先级格式无效");
        JSONObject result = new JSONObject();
        for (String kind : new String[]{"lyric", "comment"}) if (value.has(kind)) {
            JSONArray values = value.optJSONArray(kind);
            if (values == null || values.length() > 64) throw new IOException("来源优先级格式无效");
            JSONArray checked = new JSONArray(); List<String> seen = new ArrayList<>();
            for (int i=0;i<values.length();i++) {
                Object raw = values.get(i);
                if (!(raw instanceof String)) throw new IOException("来源优先级必须是插件标识");
                String id = (String) raw;
                if (!id.equals("self")) AndroidPluginManager.identity(id);
                if (!seen.contains(id)) { checked.put(id); seen.add(id); }
            }
            result.put(kind, checked);
        }
        return result;
    }

    /** Links are explicit; neither provider IDs nor credentials are inferred from opaque context fields. */
    JSONObject link(String fromPlugin, String fromScope, JSONObject fromTrack,
                    String toPlugin, String toScope, JSONObject toTrack, int matched) throws Exception {
        JSONObject from = source(fromPlugin, fromScope, fromTrack, 1), to = source(toPlugin, toScope, toTrack, matched);
        synchronized (LOCK) {
            JSONObject document = read(); JSONArray groups = document.getJSONArray("groups");
            int first = findGroup(groups, fromPlugin, fromScope, from.getString("trackId"), from.getJSONObject("sourceContext"));
            int second = findGroup(groups, toPlugin, toScope, to.getString("trackId"), to.getJSONObject("sourceContext"));
            JSONArray combined = new JSONArray();
            if (first >= 0) appendSources(combined, groups.getJSONArray(first));
            if (second >= 0 && second != first) appendSources(combined, groups.getJSONArray(second));
            upsert(combined, from); upsert(combined, to);
            JSONArray next = new JSONArray();
            for (int i=0;i<groups.length();i++) if (i != first && i != second) next.put(groups.get(i));
            if (next.length() >= MAX_GROUPS) throw new IOException("插件来源关联数量已达上限");
            next.put(combined); document.put("groups", next); write(document);
            return new JSONObject().put("sources", cloneArray(combined));
        }
    }

    JSONArray sources(String pluginId, String scope, JSONObject track) throws Exception {
        JSONObject own = source(pluginId, scope, track, 1);
        synchronized (LOCK) {
            JSONArray groups = read().getJSONArray("groups");
            int group = findGroup(groups, pluginId, scope, own.getString("trackId"), own.getJSONObject("sourceContext"));
            return group < 0 ? new JSONArray().put(own) : cloneArray(groups.getJSONArray(group));
        }
    }
    void unlink(String pluginId, String scope, JSONObject track, String targetPlugin, String targetScope) throws Exception {
        JSONObject own = source(pluginId, scope, track, 1); AndroidPluginManager.identity(targetPlugin);
        if (pluginId.equals(targetPlugin) && scope.equals(targetScope)) throw new IOException("不能移除歌曲自身来源");
        synchronized (LOCK) {
            JSONObject document=read(); JSONArray groups=document.getJSONArray("groups");
            int group=findGroup(groups, pluginId, scope, own.getString("trackId"), own.getJSONObject("sourceContext"));
            if (group<0) return;
            JSONArray previous=groups.getJSONArray(group), remaining=new JSONArray();
            for(int i=0;i<previous.length();i++) { JSONObject row=previous.getJSONObject(i); if (!(targetPlugin.equals(row.optString("pluginId"))&&targetScope.equals(row.optString("accountScope"))))remaining.put(row); }
            groups.put(group,remaining); write(document);
        }
    }

    /** Mirrors desktop matched-first, stable provider ordering; library lyric calls ignore the self token. */
    JSONArray candidates(String pluginId, String scope, String trackId, JSONObject rawContext, String kind, JSONArray installed) throws Exception {
        AndroidPluginManager.identity(pluginId);
        if (!(kind.equals("lyric") || kind.equals("comment"))) throw new IOException("来源能力无效");
        JSONObject raw = rawContext == null ? new JSONObject() : cloneObject(rawContext);
        synchronized (LOCK) {
            JSONObject document = read(); JSONArray groups = document.getJSONArray("groups");
            int group = findGroup(groups, pluginId, scope, trackId, raw);
            List<JSONObject> result = new ArrayList<>(); int ownMatch = 0;
            if (group >= 0) {
                JSONArray rows = groups.getJSONArray(group);
                for (int i=0;i<rows.length();i++) {
                    JSONObject source = rows.getJSONObject(i);
                    if (pluginId.equals(source.optString("pluginId")) && scope.equals(source.optString("accountScope"))) {
                        ownMatch = source.optInt("matched"); continue;
                    }
                    JSONObject metadata = metadata(installed, source.optString("pluginId"));
                    if (eligible(metadata, source.optString("accountScope"), kind)) result.add(cloneObject(source));
                }
            }
            JSONObject owner = metadata(installed, pluginId);
            if (eligible(owner, scope, kind)) result.add(new JSONObject().put("pluginId", pluginId).put("accountScope", scope)
                    .put("trackId", trackId == null ? "" : trackId).put("sourceContext", raw).put("matched", ownMatch));
            JSONArray priority = priorities(document).getJSONArray(kind); List<String> resolved = new ArrayList<>();
            for (int i=0;i<priority.length();i++) {
                String id = priority.getString(i);
                if (kind.equals("lyric") && owner != null && owner.optString("type").equals("library") && id.equals("self")) continue;
                resolved.add(id.equals("self") ? pluginId : id);
            }
            result.sort((left, right) -> {
                int confidence = Integer.compare(right.optInt("matched"), left.optInt("matched"));
                if (confidence != 0) return confidence;
                return Integer.compare(rank(resolved, left.optString("pluginId")), rank(resolved, right.optString("pluginId")));
            });
            return new JSONArray(result);
        }
    }

    /** Exact original auto-match thresholds; manual confirmation may explicitly save matched=1. */
    static int automaticMatch(String mode, double confidence) {
        if (mode.equals("official")) return 1;
        if (!mode.equals("search") || !Double.isFinite(confidence) || confidence < 50) return -1;
        return confidence >= 80 ? 1 : 0;
    }

    private static boolean eligible(JSONObject plugin, String scope, String kind) {
        if (plugin == null || !plugin.optBoolean("enabled", true) || !scope.equals(plugin.optString("accountScope"))) return false;
        String method = kind.equals("lyric") ? "getLyric" : "getComments";
        if (!contains(plugin.optJSONArray("methods"), method) || contains(plugin.optJSONArray("unsupportedMethods"), method)) return false;
        JSONObject capabilities = plugin.optJSONObject("capabilities");
        if (capabilities == null) return false;
        if (kind.equals("lyric")) return capabilities.optBoolean("getLyric");
        JSONObject comments = capabilities.optJSONObject("comment");
        return comments != null && comments.has("read") ? comments.optBoolean("read") : capabilities.optBoolean("getComments");
    }
    private static JSONObject metadata(JSONArray rows, String id) {
        for (int i=0;rows != null && i<rows.length();i++) { JSONObject row=rows.optJSONObject(i); if (row != null && id.equals(row.optString("id"))) return row; }
        return null;
    }
    private static int rank(List<String> rows, String id) { int value=rows.indexOf(id); return value<0?Integer.MAX_VALUE:value; }
    private static boolean contains(JSONArray rows, String value) {
        for (int i=0;rows != null && i<rows.length();i++) if (value.equals(rows.optString(i))) return true;
        return false;
    }
    private static JSONObject source(String plugin, String scope, JSONObject track, int matched) throws Exception {
        AndroidPluginManager.identity(plugin);
        if (scope == null || scope.isEmpty() || scope.length() > 256 || track == null || !track.has("id")
                || track.optJSONObject("sourceContext") == null || !(matched == 0 || matched == 1)) throw new IOException("歌曲来源关联格式无效");
        Object id = track.get("id");
        if (!(id instanceof String || id instanceof Number) || String.valueOf(id).isEmpty() || String.valueOf(id).length()>1024) throw new IOException("歌曲来源标识无效");
        return new JSONObject().put("pluginId", plugin).put("accountScope", scope).put("trackId", String.valueOf(id))
                .put("sourceContext", cloneObject(track.getJSONObject("sourceContext"))).put("matched", matched);
    }
    private static int findGroup(JSONArray groups, String plugin, String scope, String trackId, JSONObject context) throws Exception {
        String fingerprint = canonical(context);
        for (int i=0;i<groups.length();i++) {
            JSONArray sources = groups.getJSONArray(i);
            for (int n=0;n<sources.length();n++) {
                JSONObject row = sources.getJSONObject(n);
                boolean sameTrack = trackId != null && !trackId.isEmpty() ? trackId.equals(row.optString("trackId"))
                        : context.length() > 0 && fingerprint.equals(canonical(row.getJSONObject("sourceContext")));
                if (plugin.equals(row.optString("pluginId")) && scope.equals(row.optString("accountScope")) && sameTrack) return i;
            }
        }
        return -1;
    }
    private static void appendSources(JSONArray to, JSONArray from) throws Exception { for (int i=0;i<from.length();i++) upsert(to, from.getJSONObject(i)); }
    private static void upsert(JSONArray rows, JSONObject source) throws Exception {
        for (int i=0;i<rows.length();i++) {
            JSONObject old = rows.getJSONObject(i);
            if (old.getString("pluginId").equals(source.getString("pluginId")) && old.getString("accountScope").equals(source.getString("accountScope"))) {
                rows.put(i, cloneObject(source)); return;
            }
        }
        if (rows.length() >= 64) throw new IOException("同一歌曲关联的来源过多");
        rows.put(cloneObject(source));
    }
    private JSONObject read() throws Exception {
        if (!file.isFile()) return new JSONObject().put("format", 1).put("groups", new JSONArray());
        if (file.length() > MAX_BYTES) throw new IOException("插件来源资料超过容量限制");
        JSONObject value = new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
        if (value.optInt("format") != 1 || value.optJSONArray("groups") == null) throw new IOException("插件来源索引格式无效");
        return value;
    }
    private void write(JSONObject value) throws IOException {
        if (value.toString().getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new IOException("插件来源资料超过容量限制");
        LibraryFiles.writeJson(file, value);
    }
    private static JSONObject priorities(JSONObject document) throws Exception {
        JSONObject current = document.optJSONObject("priority"), result = new JSONObject();
        for (String kind : new String[]{"lyric", "comment"}) result.put(kind, current != null && current.optJSONArray(kind) != null
                ? cloneArray(current.getJSONArray(kind)) : new JSONArray().put("self"));
        return result;
    }
    private static JSONObject cloneObject(JSONObject value) throws Exception { return new JSONObject(value.toString()); }
    private static JSONArray cloneArray(JSONArray value) throws Exception { return new JSONArray(value.toString()); }
    private static String canonical(Object value) throws Exception {
        if (value instanceof JSONObject) {
            JSONObject object=(JSONObject)value; List<String> keys=new ArrayList<>(); Iterator<String> names=object.keys();
            while(names.hasNext()) keys.add(names.next()); Collections.sort(keys); StringBuilder result=new StringBuilder("{");
            for(String key:keys) result.append(JSONObject.quote(key)).append(':').append(canonical(object.get(key))).append(',');
            return result.append('}').toString();
        }
        if (value instanceof JSONArray) { JSONArray array=(JSONArray)value; StringBuilder result=new StringBuilder("["); for(int i=0;i<array.length();i++)result.append(canonical(array.get(i))).append(',');return result.append(']').toString(); }
        return value instanceof String ? JSONObject.quote((String)value) : String.valueOf(value);
    }
}
