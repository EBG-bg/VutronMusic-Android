package io.github.vutronmusic.personal;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.util.*;
import java.util.function.Function;
import java.util.function.Predicate;

/** Exact inverse entries, including repeated files; later conflicting edits are never overwritten. */
final class LocalRemovalRows {
    private LocalRemovalRows() { }
    static JSONArray capture(JSONArray source, Predicate<JSONObject> matches, Function<JSONObject, String> identity) throws Exception {
        JSONArray removed = new JSONArray(); Map<String, JSONArray> remaining = new HashMap<>();
        for (int i = 0; i < source.length(); i++) {
            JSONObject row = source.getJSONObject(i); String key = identity.apply(row);
            if (!matches.test(row)) remaining.computeIfAbsent(key, ignored -> new JSONArray()).put(row);
        }
        for (int i = 0; i < source.length(); i++) {
            JSONObject row = source.getJSONObject(i);
            if (matches.test(row)) removed.put(new JSONObject().put("index", i).put("row", new JSONObject(row.toString()))
                    .put("remaining", remaining.getOrDefault(identity.apply(row), new JSONArray()))
                    .put("previous", i > 0 ? source.getJSONObject(i - 1) : JSONObject.NULL)
                    .put("next", i + 1 < source.length() ? source.getJSONObject(i + 1) : JSONObject.NULL));
        }
        return removed;
    }
    static JSONArray restore(JSONArray source, JSONArray removed, Function<JSONObject, String> identity) throws Exception {
        List<JSONObject> result = new ArrayList<>(); Map<String, List<JSONObject>> current = new HashMap<>(), groups = new LinkedHashMap<>();
        for (int i = 0; i < source.length(); i++) { JSONObject row = source.getJSONObject(i); result.add(row); current.computeIfAbsent(identity.apply(row), ignored -> new ArrayList<>()).add(row); }
        for (int i = 0; i < removed.length(); i++) { JSONObject entry = removed.getJSONObject(i); groups.computeIfAbsent(identity.apply(entry.getJSONObject("row")), ignored -> new ArrayList<>()).add(entry); }
        Set<String> restoreKeys = new HashSet<>();
        for (Map.Entry<String, List<JSONObject>> group : groups.entrySet()) {
            List<JSONObject> survivors = new ArrayList<>(), full = new ArrayList<>();
            JSONArray remaining = group.getValue().get(0).getJSONArray("remaining");
            for (int i = 0; i < remaining.length(); i++) survivors.add(remaining.getJSONObject(i));
            full.addAll(survivors); for (JSONObject entry : group.getValue()) full.add(entry.getJSONObject("row"));
            List<JSONObject> present = current.getOrDefault(group.getKey(), Collections.emptyList());
            if (counts(present).equals(counts(full))) continue;
            if (!counts(present).equals(counts(survivors))) throw new IOException("曲目条目已变化，未覆盖之后的修改，请重新检查移除记录");
            restoreKeys.add(group.getKey());
        }
        for (int i = 0; i < removed.length(); i++) {
            JSONObject entry = removed.getJSONObject(i), row = entry.getJSONObject("row"); String key = identity.apply(row);
            if (!restoreKeys.contains(key)) continue;
            int insertion = Math.max(0, Math.min(entry.getInt("index"), result.size()));
            int next = anchor(result, current, entry.optJSONObject("next"), key, identity);
            int previous = anchor(result, current, entry.optJSONObject("previous"), key, identity);
            if (next >= 0) insertion = next; else if (previous >= 0) insertion = previous + 1;
            result.add(insertion, row);
            current.computeIfAbsent(key, ignored -> new ArrayList<>()).add(row);
        }
        JSONArray rows = new JSONArray(); for (JSONObject row : result) rows.put(row);
        return rows;
    }
    private static int anchor(List<JSONObject> rows, Map<String, List<JSONObject>> grouped, JSONObject target, String restoringKey, Function<JSONObject, String> identity) throws Exception {
        if (target == null) return -1;
        String key = identity.apply(target), value = canonical(target); List<JSONObject> candidates = grouped.getOrDefault(key, Collections.emptyList());
        for (JSONObject row : candidates) if (value.equals(canonical(row))) return rows.indexOf(row);
        if (!key.equals(restoringKey) && !candidates.isEmpty()) return rows.indexOf(candidates.get(0));
        return -1;
    }
    private static Map<String, Integer> counts(List<JSONObject> rows) throws Exception {
        Map<String, Integer> result = new HashMap<>(); for (JSONObject row : rows) result.merge(canonical(row), 1, Integer::sum); return result;
    }
    private static String canonical(Object value) throws Exception {
        if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value; List<String> keys = new ArrayList<>(); object.keys().forEachRemaining(keys::add); Collections.sort(keys);
            StringJoiner result = new StringJoiner(",", "{", "}"); for (String key : keys) result.add(JSONObject.quote(key) + ":" + canonical(object.get(key))); return result.toString();
        }
        if (value instanceof JSONArray) { JSONArray array = (JSONArray) value; StringJoiner result = new StringJoiner(",", "[", "]"); for (int i = 0; i < array.length(); i++) result.add(canonical(array.get(i))); return result.toString(); }
        return value == null || value == JSONObject.NULL ? "null" : value instanceof String ? JSONObject.quote((String) value) : String.valueOf(value);
    }
}
