package io.github.vutronmusic.personal;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Portable sort snapshots. Media locations and plugin/account state are never copied. */
final class CollectionOrderHistoryBackup {
    static final String KEY = "vutron:collection-order-history:v1";
    private static final long MAX_JS_INTEGER = 9_007_199_254_740_991L;
    private static final long MAX_DATE_MILLISECONDS = 8_640_000_000_000_000L;
    private CollectionOrderHistoryBackup() { }

    interface KeyMapper { String map(String key) throws Exception; }

    private static boolean timestamp(Object value) {
        return value instanceof Number && Double.isFinite(((Number)value).doubleValue())
                && ((Number)value).doubleValue() == ((Number)value).longValue()
                && ((Number)value).longValue() > 0 && ((Number)value).longValue() <= MAX_DATE_MILLISECONDS;
    }
    private static boolean onlineScope(String scope) {
        if (scope.matches("netease:[0-9]+:playlist:[0-9]+")) return true;
        try {
            JSONArray parts = new JSONArray(scope);
            return parts.length() == 4 && "plugin".equals(parts.optString(0))
                    && parts.opt(1) instanceof String && parts.opt(2) instanceof String
                    && parts.optString(1).matches("[a-zA-Z0-9._:-]{1,160}")
                    && parts.optString(2).matches("[a-zA-Z0-9._:-]{1,160}")
                    && (parts.opt(3) instanceof String && parts.optString(3).matches("[a-zA-Z0-9._:-]{1,256}") || numericIdentifier(parts.opt(3)));
        } catch (org.json.JSONException invalid) { return false; }
    }
    private static boolean numericIdentifier(Object value) {
        return value instanceof Number && Double.isFinite(((Number)value).doubleValue())
                && ((Number)value).doubleValue() == ((Number)value).longValue()
                && Math.abs(((Number)value).doubleValue()) <= MAX_JS_INTEGER;
    }
    private static boolean onlineKey(String key, boolean netease) {
        if (netease) return key.matches("netease:[0-9]+");
        try {
            JSONArray parts = new JSONArray(key);
            return parts.length() == 2 && parts.opt(0) instanceof String && parts.opt(1) instanceof String && parts.optString(0).matches("[a-zA-Z0-9._:-]{0,160}")
                    && parts.optString(1).matches("[a-zA-Z0-9._:-]{1,256}");
        } catch (org.json.JSONException invalid) { return false; }
    }
    static JSONObject online(JSONObject source) throws Exception {
        JSONObject result = new JSONObject();
        for (Iterator<String> names = source.keys(); names.hasNext();) {
            String scope = names.next();
            if (!onlineScope(scope) || source.optJSONObject(scope) == null) continue;
            boolean netease = scope.startsWith("netease:");
            result.put(scope, sanitize(source.getJSONObject(scope), key -> onlineKey(key, netease) ? key : null));
        }
        return result;
    }
    static JSONObject remap(JSONObject source, Map<String,String> keys) throws Exception {
        return sanitize(source, key -> {
            String known = keys.get(key);
            if (known != null) return known;
            return key.matches("missing:[a-f0-9]{64}") ? key : "missing:" + LibraryBackup.digest(key);
        });
    }
    static JSONObject portable(JSONObject source, Map<String,String> keys) throws Exception {
        return source == null ? null : remap(source, keys);
    }
    /** Missing local references become stable opaque placeholders; invalid online keys reject their whole snapshot. */
    private static JSONObject sanitize(JSONObject source, KeyMapper mapper) throws Exception {
        int limit = source.optInt("limit", 10);
        if (!(source.opt("limit") instanceof Number) || ((Number)source.opt("limit")).doubleValue() != limit || limit < 1 || limit > 50) limit = 10;
        JSONObject result = new JSONObject().put("limit", limit);
        if (Boolean.TRUE.equals(source.opt("legacyMigrated"))) result.put("legacyMigrated", true);
        JSONArray entries = source.optJSONArray("entries");
        Map<String,JSONObject> unique = new HashMap<>();
        for (int i = 0; entries != null && i < entries.length(); i++) {
            JSONObject raw = entries.optJSONObject(i);
            if (raw == null || !(raw.opt("id") instanceof String) || !raw.optString("id").matches("[a-zA-Z0-9_-]{1,100}")
                    || !timestamp(raw.opt("createdAt")) || !raw.optString("mode").matches("original|title|artist|album|custom")) continue;
            JSONArray input = raw.optJSONArray("keys");
            if (input == null || input.length() == 0) continue;
            JSONArray mapped = new JSONArray(); Set<String> seen = new HashSet<>(); boolean invalid = false;
            for (int n = 0; n < input.length(); n++) {
                if (!(input.opt(n) instanceof String)) { invalid = true; break; }
                String key = mapper.map(input.getString(n));
                if (key == null) { invalid = true; break; }
                if (seen.add(key)) mapped.put(key);
            }
            if (invalid) continue;
            JSONObject entry = new JSONObject().put("id", raw.getString("id")).put("createdAt", raw.getLong("createdAt"))
                    .put("mode", raw.getString("mode")).put("keys", mapped);
            if (timestamp(raw.opt("customAt"))) entry.put("customAt", raw.getLong("customAt"));
            else if ("custom".equals(raw.getString("mode"))) entry.put("customAt", raw.getLong("createdAt"));
            if (raw.opt("name") instanceof String && raw.getString("name").trim().length() <= 80 && !raw.getString("name").trim().isEmpty()) entry.put("name", raw.getString("name").trim());
            if (Boolean.TRUE.equals(raw.opt("pinned"))) entry.put("pinned", true);
            String signature = mapped.toString(); JSONObject duplicate = unique.get(signature);
            if (duplicate == null) unique.put(signature, entry);
            else {
                JSONObject newer = duplicate.getLong("createdAt") >= entry.getLong("createdAt") ? duplicate : entry;
                JSONObject older = newer == duplicate ? entry : duplicate;
                if (!newer.has("name") && older.has("name")) newer.put("name", older.getString("name"));
                if (older.optBoolean("pinned")) newer.put("pinned", true);
                long customAt = Math.max(newer.optLong("customAt"), older.optLong("customAt"));
                if (customAt > 0) newer.put("customAt", customAt);
                unique.put(signature, newer);
            }
        }
        List<JSONObject> ordered = new ArrayList<>(unique.values());
        ordered.sort(Comparator.comparingLong((JSONObject entry) -> entry.optLong("createdAt")).reversed());
        JSONArray kept = new JSONArray(); int automatic = 0;
        for (JSONObject entry : ordered) if (entry.optBoolean("pinned") || automatic++ < limit) kept.put(entry);
        return result.put("entries", kept);
    }
}
