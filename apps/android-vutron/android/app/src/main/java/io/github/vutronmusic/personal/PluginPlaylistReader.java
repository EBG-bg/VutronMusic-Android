package io.github.vutronmusic.personal;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Set;
import java.util.function.BiConsumer;

/** Materialize a complete playlist through the original plugin contract before publishing a snapshot. */
final class PluginPlaylistReader {
    static final int MAX_TRACKS = 20_000;
    private static final int MAX_PAGES = 200;
    @FunctionalInterface interface Request { JSONObject call(String method, JSONObject params) throws Exception; }
    record Loaded(JSONObject detail, List<JSONObject> tracks) { }

    private PluginPlaylistReader() { }

    static Loaded read(JSONObject supplied, Request request, BiConsumer<Integer, Integer> progress) throws Exception {
        JSONObject query = params(supplied.optJSONObject("sourceContext"), supplied.get("id"));
        JSONObject firstResult = result(request.call("getPlaylistDetail", query));
        JSONObject detail = firstResult.optJSONObject("data");
        if (detail == null) throw new IOException("无法读取插件歌单");
        Object id = detail.get("id");
        if (String.valueOf(id).isBlank()) throw new IOException("插件歌单标识无效");
        int expected = detail.optInt("trackCount", -1);
        JSONArray ids = detail.optJSONArray("trackIds");
        boolean orderedIds = ids != null && ids.length() > 0 && ids.length() >= expected;
        if (orderedIds) expected = ids.length();
        if (expected > MAX_TRACKS) throw new IOException("歌单超出离线保存数量上限");
        List<JSONObject> songs = new ArrayList<>();
        append(songs, detail.optJSONArray("tracks"));
        LinkedHashMap<String, JSONObject> byId = new LinkedHashMap<>();
        Set<String> missing = new HashSet<>();
        if (orderedIds) {
            for (int index = 0; index < ids.length(); index++) missing.add(String.valueOf(ids.get(index)));
            acceptIds(songs, byId, missing);
        }
        JSONObject cursor = firstResult.optJSONObject("sourceContext");
        if (cursor == null) cursor = detail.optJSONObject("sourceContext");
        if (cursor == null) cursor = supplied.optJSONObject("sourceContext");
        // Even a playlist advertised as empty may have separately paged tracks.
        boolean readFirst = songs.isEmpty() && (expected != 0 || cursor != null && (cursor.has("page") || cursor.optBoolean("hasMore")));
        progress.accept(songs.size(), Math.max(0, expected));
        Set<String> readCursors = new HashSet<>();
        int skipped = 0;
        for (int page = 0; readFirst || (orderedIds ? !missing.isEmpty()
                : expected > songs.size() + skipped || more(cursor) || expected <= 0 && cursor != null && cursor.has("page") && !explicitlyFinished(cursor)); page++) {
            if (page >= MAX_PAGES || cursor != null && explicitlyFinished(cursor)) throw incomplete();
            JSONObject pageArgs = params(cursor, id);
            // Match the desktop plugin API: the first page gets the detail context; subsequent pages get reset:false.
            if (page > 0) pageArgs.put("reset", false);
            if (!readCursors.add(AndroidPluginManager.digest(PluginSourceRegistry.canonical(cursor == null ? new JSONObject() : cursor)))) throw incomplete();
            JSONObject response = result(request.call("getPlaylistTracks", pageArgs));
            JSONArray incoming = response.optJSONArray("data");
            if (incoming == null) throw incomplete();
            int first = songs.size();
            append(songs, incoming);
            int filtered = response.optInt("skippedUnavailableTracks");
            if (filtered < 0 || filtered > MAX_TRACKS - skipped - songs.size()) throw incomplete();
            skipped += filtered;
            if (orderedIds) acceptIds(songs.subList(first, songs.size()), byId, missing);
            cursor = nextCursor(response, pageArgs);
            progress.accept(Math.min(Math.max(0, expected), songs.size() + skipped), Math.max(0, expected));
            readFirst = false;
            if (first == songs.size() && filtered == 0) {
                if (orderedIds ? !missing.isEmpty() : expected > songs.size() + skipped || more(cursor)) throw incomplete();
                break;
            }
        }
        if (orderedIds) {
            if (!missing.isEmpty()) throw incomplete();
            List<JSONObject> ordered = new ArrayList<>(ids.length());
            for (int index = 0; index < ids.length(); index++) ordered.add(byId.get(String.valueOf(ids.get(index))));
            return new Loaded(detail, ordered);
        }
        if (expected > songs.size() + skipped) throw incomplete();
        return new Loaded(detail, songs);
    }

    private static JSONObject nextCursor(JSONObject response, JSONObject submitted) throws Exception {
        JSONObject cursor = response.optJSONObject("sourceContext");
        if (cursor == null) return null;
        JSONObject echo = cursor.optJSONObject("sourceContext");
        // Some plugins return {...params, page: next}; the embedded copy of our
        // previous cursor is not a new cursor and otherwise grows per page.
        if (echo != null && PluginSourceRegistry.canonical(echo).equals(PluginSourceRegistry.canonical(submitted.optJSONObject("sourceContext")))) {
            cursor.remove("sourceContext");
            if (Boolean.FALSE.equals(cursor.opt("reset"))) cursor.remove("reset");
        }
        return cursor;
    }

    private static boolean more(JSONObject cursor) { return cursor != null && cursor.optBoolean("hasMore"); }
    private static boolean explicitlyFinished(JSONObject cursor) { return Boolean.FALSE.equals(cursor.opt("hasMore")); }
    private static IOException incomplete() { return new IOException("插件没有返回完整歌单，已保留原有离线资料"); }

    private static JSONObject params(JSONObject context, Object id) throws Exception {
        JSONObject original = context == null ? new JSONObject() : context;
        JSONObject result = new JSONObject(original.toString());
        return result.put("id", id).put("sourceContext", original);
    }

    private static JSONObject result(JSONObject response) throws IOException {
        if (response == null || response.optInt("code") != 200) throw incomplete();
        return response;
    }

    private static void append(List<JSONObject> songs, JSONArray rows) throws Exception {
        if (rows == null) return;
        if (rows.length() > MAX_TRACKS - songs.size()) throw new IOException("歌单超出离线保存数量上限");
        for (int index = 0; index < rows.length(); index++) {
            JSONObject row = rows.optJSONObject(index);
            if (row == null || row.isNull("id") || row.optJSONObject("sourceContext") == null) throw incomplete();
            songs.add(row);
        }
    }

    private static void acceptIds(List<JSONObject> rows, LinkedHashMap<String, JSONObject> byId, Set<String> missing) {
        for (JSONObject row : rows) {
            String id = String.valueOf(row.opt("id"));
            if (missing.remove(id)) byId.put(id, row);
        }
    }
}
