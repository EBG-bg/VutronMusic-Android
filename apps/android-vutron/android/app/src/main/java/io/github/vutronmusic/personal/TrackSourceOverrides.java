package io.github.vutronmusic.personal;

import android.content.Context;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Iterator;
import java.util.Set;

/** Per-NetEase-track source choices, separate from account and cache state. */
final class TrackSourceOverrides {
    private static final Object LOCK = new Object();
    private static final int MAX_ENTRIES = 10000;
    private static final long MAX_BYTES = 1024 * 1024;
    private static final Set<String> SOURCES = Set.of("bodian", "kuwo", "kugou", "qq", "bilibili", "pyncmd", "migu");

    private TrackSourceOverrides() { }

    static String get(Context context, long trackId) {
        if (trackId <= 0) return "";
        synchronized (LOCK) {
            try { return read(context).getJSONObject("overrides").optString(String.valueOf(trackId), ""); }
            catch (Exception invalid) {
                android.util.Log.w("VutronSourceChoice", "Ignoring invalid per-track source choices");
                return "";
            }
        }
    }

    static JSONObject set(Context context, long trackId, String source) throws Exception {
        if (trackId <= 0 || source == null || !source.isEmpty() && !SOURCES.contains(source))
            throw new IOException("歌曲或音源标识无效");
        synchronized (LOCK) {
            JSONObject document = read(context), overrides = document.getJSONObject("overrides");
            String key = String.valueOf(trackId), previous = overrides.optString(key, "");
            if (source.equals(previous)) return new JSONObject().put("changed", false).put("source", source);
            if (source.isEmpty()) overrides.remove(key);
            else {
                if (!overrides.has(key) && overrides.length() >= MAX_ENTRIES) throw new IOException("单曲音源选择已达到保存上限");
                overrides.put(key, source);
            }
            write(context, document);
            return new JSONObject().put("changed", true).put("source", source);
        }
    }

    static JSONObject snapshot(Context context) throws Exception {
        synchronized (LOCK) { return sanitize(read(context)); }
    }

    static JSONObject sanitize(JSONObject input) throws Exception {
        if (input == null || input.optInt("format") != 1 || input.optJSONObject("overrides") == null)
            throw new IOException("单曲音源选择备份格式无效");
        JSONObject safe = new JSONObject(), raw = input.getJSONObject("overrides");
        for (Iterator<String> keys = raw.keys(); keys.hasNext() && safe.length() < MAX_ENTRIES;) {
            String id = keys.next(), source = raw.optString(id, "");
            if (!id.matches("[1-9][0-9]{0,18}") || !SOURCES.contains(source)) continue;
            try { if (Long.parseLong(id) > 0) safe.put(id, source); }
            catch (NumberFormatException | JSONException ignored) { }
        }
        return new JSONObject().put("format", 1).put("overrides", safe);
    }

    static void restore(Context context, JSONObject input) throws Exception {
        JSONObject safe = sanitize(input);
        synchronized (LOCK) { write(context, safe); }
    }

    private static JSONObject read(Context context) throws Exception {
        File file = file(context);
        if (!file.isFile()) return new JSONObject().put("format", 1).put("overrides", new JSONObject());
        if (file.length() > MAX_BYTES) throw new IOException("单曲音源选择文件超过容量限制");
        return sanitize(new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8)));
    }

    private static void write(Context context, JSONObject document) throws Exception {
        JSONObject safe = sanitize(document);
        if (safe.toString().getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new IOException("单曲音源选择超过容量限制");
        LibraryFiles.writeJson(file(context), safe);
    }

    private static File file(Context context) { return new File(context.getApplicationContext().getFilesDir(), "track-source-overrides-v1.json"); }
}
