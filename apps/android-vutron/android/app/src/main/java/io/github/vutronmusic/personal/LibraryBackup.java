package io.github.vutronmusic.personal;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Portable settings and library metadata. Optional media uses the separate streaming cache archive. */
final class LibraryBackup {
    static final String GENERATOR = "vutron-mobile-backup";
    static final String ACCOUNT_ENVELOPE = "encryptedAccounts";
    static final int MAX_BYTES = 8 * 1024 * 1024;
    static final int MAX_STORE_BYTES = 64 * 1024 * 1024;
    private static final String[] PREFS = {"lyric_overlay", "playback_volume", "audio_cache_settings", "artwork_cache_settings", "audio_sources", "vutron_playback", "playback_tuning"};
    private static final Set<String> LYRIC_BOOLEANS = new HashSet<>(Arrays.asList("locked", "touch_passthrough_priority", "translation", "wifi_validation", "next_line", "estimated_word_timing", "shadow_enabled", "reduced_motion"));
    private static final Set<String> LYRIC_INTS = new HashSet<>(Arrays.asList("font_size", "played_color", "unplayed_color", "background_color", "shadow_color", "shadow_radius"));
    private LibraryBackup() { }
    private static File file(Context c) { return new File(c.getFilesDir(), "restored-playlists.json"); }

    static JSONObject read(InputStream input) throws Exception {
        return readLimited(input,MAX_BYTES,"备份文件超过 8 MiB");
    }
    static JSONObject readStore(InputStream input) throws Exception {
        return readLimited(input,MAX_STORE_BYTES,"本机恢复资料超过 64 MiB，请保留原文件并联系维护者处理");
    }
    static byte[] exportBytes(JSONObject document) throws Exception {
        validate(document);
        byte[] bytes = document.toString(2).getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES) throw new IOException("资料超过 8 MiB，请精简歌单或排序历史后备份");
        return bytes;
    }
    private static JSONObject readLimited(InputStream input,int limit,String message) throws Exception {
        if (input == null) throw new IOException("无法打开备份文件");
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = stream.read(buffer)) != -1) { if (output.size() + count > limit) throw new IOException(message); output.write(buffer, 0, count); }
            return new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
        }
    }
    static String digest(String text) throws Exception {
        StringBuilder result = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))) result.append(String.format(Locale.ROOT, "%02x", b & 255));
        return result.toString();
    }
    static JSONObject portableTrack(JSONObject row) throws Exception {
        JSONArray artists = row.optJSONArray("artists"); if (artists == null) artists = row.optJSONArray("ar");
        JSONArray names = new JSONArray();
        for (int i = 0; artists != null && i < artists.length(); i++) {
            Object artist = artists.opt(i); String name = artist instanceof JSONObject ? ((JSONObject) artist).optString("name") : String.valueOf(artist);
            if (!name.trim().isEmpty()) names.put(name);
        }
        if (names.length() == 0 && !row.optString("artist").isEmpty()) names.put(row.optString("artist"));
        JSONObject album = row.optJSONObject("al"); if (album == null) album = row.optJSONObject("album");
        String filename = row.optString("localFileName", row.optString("fileName", "")).replace((char) 92, '/');
        filename = filename.substring(filename.lastIndexOf('/') + 1);
        JSONObject result = new JSONObject().put("name", row.optString("name")).put("artists", names)
                .put("album", album == null ? row.optString("album", "") : album.optString("name"))
                .put("duration", Math.max(0, row.optLong("duration", row.optLong("dt", 0)))).put("fileName", filename);
        if (row.has("cueTrackNo")) {
            long number=row.optLong("cueTrackNo"),start=row.optLong("cueOffsetMs",-1),length=row.optLong("cueDurationMs",-1);
            if (number<1 || number>999 || start<0 || length<=0 || start+length>Integer.MAX_VALUE) throw new IOException("CUE 备份资料无效");
            result.put("cueTrackNo",number).put("cueOffsetMs",start).put("cueDurationMs",length);
        }
        long remote = row.optLong("neteaseId");
        boolean online = row.optBoolean("onlineOnly");
        if (online && remote == 0) remote = row.optLong("id");
        if (remote > 0) result.put("neteaseId", remote);
        if (online) result.put("onlineOnly", true);
        result.put("key", digest(result.toString()));
        if (row.has("volume")) result.put("volume", row.getInt("volume"));
        if (row.has("lyricOffsetMs")) result.put("lyricOffsetMs", row.getLong("lyricOffsetMs"));
        return result;
    }
    static String fingerprint(JSONObject row) throws Exception {
        JSONObject value = portableTrack(row); value.remove("key"); value.remove("volume"); value.remove("lyricOffsetMs");
        if (!value.optBoolean("onlineOnly")) value.remove("neteaseId");
        return digest(value.toString());
    }
    private static boolean validPreference(String pref, String key, Object value) {
        if ("playback_tuning".equals(pref)) {
            if ("prefetchWifi".equals(key)) return value instanceof Boolean;
            return ("speed".equals(key) || "pitch".equals(key)) && value instanceof Number
                    && Double.isFinite(((Number)value).doubleValue()) && ((Number)value).doubleValue()>=.5 && ((Number)value).doubleValue()<=2;
        }
        if ("playback_volume".equals(pref)) return key.matches("track:id:[1-9][0-9]*|track:local:[a-f0-9]{64}|playlist:key:[a-f0-9]{64}|plugin:[1-9][0-9]{0,15}") && value instanceof Number && ((Number) value).doubleValue() == ((Number) value).intValue() && ((Number) value).intValue() >= 0 && ((Number) value).intValue() <= 100;
        if ("lyric_overlay".equals(pref)) {
            if (LYRIC_BOOLEANS.contains(key)) return value instanceof Boolean;
            if (key.matches("lyric_offset_ms_[a-f0-9]{64}")) return value instanceof Number && Math.abs(((Number) value).longValue()) <= 30000;
            if (!LYRIC_INTS.contains(key) || !(value instanceof Number)) return false;
            long number = ((Number) value).longValue();
            return "font_size".equals(key) ? number >= 16 && number <= 34 : "shadow_radius".equals(key) ? number >= 0 && number <= 8 : number >= Integer.MIN_VALUE && number <= Integer.MAX_VALUE;
        }
        if ("audio_cache_settings".equals(pref) && key.equals("enabled")) return value instanceof Boolean;
        if ("artwork_cache_settings".equals(pref) && key.equals("auto_cache")) return value instanceof Boolean;
        if ((pref.equals("audio_cache_settings") || pref.equals("artwork_cache_settings")) && key.equals("capacity_mib")) {
            if (!(value instanceof Number)) return false; long number = ((Number) value).longValue();
            return pref.equals("audio_cache_settings") ? number >= 256 && number <= 10240 : number >= 32 && number <= 1024;
        }
        if (pref.equals("audio_sources") && key.equals("auto_match")) return value instanceof Boolean;
        return pref.equals("vutron_playback") && key.equals("mode") && value instanceof Number && ((Number) value).intValue() >= 0 && ((Number) value).intValue() <= 2;
    }
    static JSONObject safePreferences(JSONObject supplied) throws Exception {
        JSONObject result = new JSONObject();
        for (String pref : PREFS) {
            JSONObject values = supplied.optJSONObject(pref), safe = new JSONObject();
            if (values != null) for (Iterator<String> i = values.keys(); i.hasNext();) { String key = i.next(); Object value = values.get(key); if (validPreference(pref, key, value)) safe.put(key, value); }
            result.put(pref, safe);
        }
        return result;
    }
    static JSONObject exportPreferences(JSONObject supplied, boolean includePrivacy) throws Exception {
        JSONObject preferences = safePreferences(supplied);
        if (!includePrivacy) {
            preferences.getJSONObject("audio_sources").remove("auto_match");
            preferences.getJSONObject("lyric_overlay").remove("wifi_validation");
            preferences.getJSONObject("playback_tuning").remove("prefetchWifi");
        }
        return preferences;
    }
    /** Pull the native-only section out before the ordinary restore plan or JS receipt can see it. */
    static JSONObject takeAccountEnvelope(JSONObject document, boolean includePrivacy) throws Exception {
        Object envelope = document.remove(ACCOUNT_ENVELOPE);
        if (!includePrivacy) {
            JSONObject settings = document.optJSONObject("settings");
            if (settings != null) document.put("settings", exportPreferences(settings, false));
            return null;
        }
        if (envelope == null) return null; // Previous backups and signed-out exports have no accounts.
        if (!(envelope instanceof JSONObject)) throw new IOException("备份账号资料格式无效");
        return (JSONObject) envelope;
    }
    private static JSONObject load(Context c) throws Exception { return file(c).isFile() ? readStore(new FileInputStream(file(c))) : new JSONObject().put("collections", new JSONArray()); }
    static byte[] storeBytes(JSONObject data) throws Exception {
        byte[] bytes=data.toString().getBytes(StandardCharsets.UTF_8);
        checkStoreSize(bytes.length);
        return bytes;
    }
    static void checkStoreSize(long length) throws IOException {
        if(length>MAX_STORE_BYTES) throw new IOException("合并后的恢复资料超过 64 MiB，本次未写入，请精简导入资料");
    }
    private static JSONArray allTracks(Context c) throws Exception {
        JSONArray result = LocalTrackStore.loadFolderIndex(c);
        for (JSONArray source : new JSONArray[]{LocalTrackStore.load(c), LocalPlaylistStore.tracks(new File(c.getFilesDir(), "local-bundles"))})
            for (int i = 0; i < source.length(); i++) result.put(source.getJSONObject(i));
        return result;
    }
    static JSONArray list(Context c) throws Exception {
        JSONArray result = new JSONArray(), collections = load(c).getJSONArray("collections");
        for (int i = 0; i < collections.length(); i++) {
            JSONObject item = collections.getJSONObject(i);
            result.put(new JSONObject().put("id", item.getString("id")).put("name", item.getString("name"))
                    .put("trackCount", item.getJSONArray("tracks").length()).put("isLocalBundle", true).put("isRestored", true)
                    .put("description",item.optString("description")).put("createTime",item.optLong("createTime")));
        }
        return result;
    }
    static JSONObject collection(Context c, String id) throws Exception {
        JSONArray rows = load(c).getJSONArray("collections");
        for (int i = 0; i < rows.length(); i++) if (id.equals(rows.getJSONObject(i).optString("id"))) return rows.getJSONObject(i);
        throw new IOException("恢复的歌单不存在");
    }
    static JSONArray tracks(Context c, String id) throws Exception {
        JSONObject collection = collection(c, id); JSONArray saved = collection.getJSONArray("tracks"), source = allTracks(c), result = new JSONArray();
        Map<String, Map<String, JSONObject>> matches = new HashMap<>();
        for (int i = 0; i < source.length(); i++) {
            JSONObject row = source.getJSONObject(i); String uri = LocalLibraryIds.uri(row); if (uri.isEmpty()) continue;
            matches.computeIfAbsent(fingerprint(row), ignored -> new HashMap<>()).put(uri+PlaybackSegment.suffix(row), row);
        }
        for (int i = 0; i < saved.length(); i++) {
            JSONObject data = saved.getJSONObject(i); String key = data.getString("key");
            Map<String, JSONObject> candidates = matches.get(fingerprint(data));
            JSONObject row = candidates != null && candidates.size() == 1 ? new JSONObject(candidates.values().iterator().next().toString()) : new JSONObject();
            boolean online = data.optBoolean("onlineOnly");
            if (row.length() == 0) row.put("id", online ? data.getLong("neteaseId") : Math.max(1L, Math.abs((long) (id + key).hashCode())))
                    .put("name", data.getString("name")).put("artists", data.getJSONArray("artists")).put("album", data.getString("album"))
                    .put("duration", data.getLong("duration")).put("localFileName", data.optString("fileName"));
            if (data.has("cueTrackNo")) for (String field : new String[]{"cueTrackNo","cueOffsetMs","cueDurationMs"}) row.put(field,data.getLong(field));
            row.remove("localFolderId"); row.remove("trackVolumeKey");
            row.put("localPlaylistId", id).put("localEntryKey", key).put("missingLocal", !online && LocalLibraryIds.uri(row).isEmpty());
            if (row.optBoolean("missingLocal")) row.put("volume", data.optInt("volume", 100)).put("lyricOffsetMs", data.optLong("lyricOffsetMs"));
            if (data.has("neteaseId")) row.put("neteaseId", data.getLong("neteaseId"));
            if (online) row.put("onlineOnly", true);
            SharedPreferences applied = c.getSharedPreferences("backup_linked", Context.MODE_PRIVATE);
            String appliedKey = digest(id + key + PlaybackVolume.trackKey(row) + LyricOverlaySettings.trackIdentity(row));
            if (!row.optBoolean("missingLocal") && !applied.getBoolean(appliedKey, false)) {
                if (data.has("volume") && PlaybackVolume.trackPercent(c, row) != data.getInt("volume")) PlaybackVolume.setTrackPercent(c, row, data.getInt("volume"));
                if (data.has("lyricOffsetMs") && LyricOverlaySettings.lyricOffsetMs(c, row) != data.getLong("lyricOffsetMs")) LyricOverlaySettings.lyricOffsetMs(c, row, data.getLong("lyricOffsetMs"));
                if (!applied.edit().putBoolean(appliedKey, true).commit()) throw new IOException("恢复记录保存失败");
            }
            result.put(row);
        }
        return result;
    }
    private static JSONObject portableCollection(Context c, String id, String name, JSONArray rows, JSONObject orders, JSONObject histories) throws Exception {
        JSONObject order = orders.optJSONObject(id); String mode = order == null ? "original" : order.optString("mode", "original");
        List<JSONObject> ordered = new ArrayList<>(); for (int i = 0; i < rows.length(); i++) ordered.add(rows.getJSONObject(i));
        if (mode.equals("custom")) {
            Map<String, Integer> ranks = new HashMap<>(); JSONArray keys = order.optJSONArray("keys");
            for (int i = 0; keys != null && i < keys.length(); i++) ranks.put(keys.optString(i), i);
            ordered.sort(Comparator.comparingInt(row -> ranks.getOrDefault(LocalLibraryIds.key(row), Integer.MAX_VALUE)));
        }
        JSONObject sourceHistory = histories.optJSONObject(id);
        JSONArray portable = new JSONArray();
        for (JSONObject row : ordered) {
            JSONObject track = portableTrack(row).put("volume", row.optBoolean("missingLocal") ? row.optInt("volume", 100) : PlaybackVolume.trackPercent(c, row))
                    .put("lyricOffsetMs", row.optBoolean("missingLocal") ? row.optLong("lyricOffsetMs") : LyricOverlaySettings.lyricOffsetMs(c, row));
            track.put("key", digest(fingerprint(track) + ":" + portable.length()));
            portable.put(track);
        }
        JSONObject result = new JSONObject().put("name", name).put("sortMode", mode).put("volume", PlaybackVolume.playlistPercent(c, id)).put("tracks", portable);
        if (id.matches("[a-zA-Z0-9:_-]{1,200}")) result.put("collectionKey", id);
        return attachOrderHistory(result, sourceHistory, ordered);
    }
    static JSONObject attachOrderHistory(JSONObject collection, JSONObject history, List<JSONObject> orderedSource) throws Exception {
        if (history == null) return collection;
        Map<String,String> keys = new HashMap<>(); JSONArray tracks = collection.getJSONArray("tracks");
        for (int i = 0; i < orderedSource.size(); i++) keys.put(LocalLibraryIds.key(orderedSource.get(i)), tracks.getJSONObject(i).getString("key"));
        return collection.put("orderHistory", CollectionOrderHistoryBackup.portable(history, keys));
    }
    /** Mirrors getLocalMusicIndex only when its aggregate has history worth restoring. */
    static JSONArray aggregateBackupRows(JSONArray folderIndex, JSONArray selected, boolean includeFolders) throws Exception {
        if (!includeFolders) return selected;
        JSONArray result = new JSONArray(); Set<String> uris = new HashSet<>();
        for (int i = 0; i < folderIndex.length(); i++) {
            JSONObject row = folderIndex.getJSONObject(i); result.put(row); uris.add(row.optString("localUri", row.optString("uri", "")));
        }
        for (int i = 0; i < selected.length(); i++) {
            JSONObject row = selected.getJSONObject(i);
            if (uris.add(row.optString("localUri", row.optString("uri", "")))) result.put(row);
        }
        return result;
    }
    static JSONObject snapshot(Context c, JSONObject frontend, JSONObject orders, boolean includePrivacy) throws Exception {
        String historyText = frontend.optString(CollectionOrderHistoryBackup.KEY, "{}");
        if (historyText.length() > MAX_BYTES) throw new IOException("排序历史超过备份大小限制，请精简后备份");
        JSONObject histories = new JSONObject(historyText);
        JSONObject preferences = new JSONObject();
        for (String pref : PREFS) preferences.put(pref, new JSONObject(c.getSharedPreferences(pref, Context.MODE_PRIVATE).getAll()));
        JSONArray collections = new JSONArray(), folderTracks = LocalTrackStore.loadFolderIndex(c), folders = LocalFolderStore.list(c);
        for (int i = 0; i < folders.length(); i++) {
            JSONObject folder = folders.getJSONObject(i); JSONArray rows = new JSONArray();
            for (int j = 0; j < folderTracks.length(); j++) if (LocalLibraryIds.inCollection(folderTracks.getJSONObject(j), folder.getString("id"))) rows.put(folderTracks.getJSONObject(j));
            collections.put(portableCollection(c, folder.getString("id"), folder.getString("name"), rows, orders, histories));
        }
        JSONObject aggregateHistory = histories.optJSONObject("local:folder");
        JSONArray aggregateEntries = aggregateHistory == null ? null : aggregateHistory.optJSONArray("entries");
        JSONArray selected = aggregateBackupRows(folderTracks, LocalTrackStore.load(c), aggregateEntries != null && aggregateEntries.length() > 0);
        if (selected.length() > 0 || histories.has("local:folder")) collections.put(portableCollection(c, "local:folder", "本地音乐", selected, orders, histories));
        JSONArray bundles = LocalPlaylistStore.list(new File(c.getFilesDir(), "local-bundles"));
        for (int i = 0; i < bundles.length(); i++) { JSONObject item = bundles.getJSONObject(i); collections.put(portableCollection(c, item.getString("id"), item.getString("name"), item.getJSONArray("localTracks"), orders, histories).put("createTime",item.optLong("createTime",0))); }
        JSONArray restored = list(c);
        for (int i = 0; i < restored.length(); i++) { JSONObject item = restored.getJSONObject(i); collections.put(portableCollection(c, item.getString("id"), item.getString("name"), tracks(c, item.getString("id")), orders, histories).put("createTime",item.optLong("createTime",0)).put("description",item.optString("description"))); }
        JSONArray pluginLocal = PluginLocalBackup.collections(c, histories);
        for (int i=0;i<pluginLocal.length();i++) collections.put(pluginLocal.getJSONObject(i));
        PlaybackQueue.Snapshot queue = PlaybackQueue.load(c);
        if (queue != null) {
            JSONArray rows = new JSONArray(); for (JSONArray lane : new JSONArray[]{queue.songs, queue.upNext}) for (int i = 0; i < lane.length(); i++) rows.put(lane.getJSONObject(i));
            collections.put(portableCollection(c, "backup:queue", "恢复的播放队列", rows, new JSONObject(), new JSONObject()));
        }
        return new JSONObject().put("format", 1).put("generator", GENERATOR).put("settings", exportPreferences(preferences, includePrivacy)).put("frontend", safeFrontend(frontend)).put("collections", collections)
                .put("pluginSourcePriorities",PluginSourceRegistry.priorities(c)).put("trackSourceOverrides",TrackSourceOverrides.snapshot(c));
    }
    static JSONObject safeFrontend(JSONObject value) throws Exception {
        JSONObject result = new JSONObject();
        Map<String, String> allowed = new HashMap<>();
        allowed.put("vutron:language", "zh|zht|en"); allowed.put("vutron:appearance", "auto|light|dark"); allowed.put("vutron:accent", "#[0-9a-fA-F]{6}");
        allowed.put("vutron:motion-preference", "full|system|reduced"); allowed.put("vutron:playlist-view", "cards|list"); allowed.put("vutron:playlist-columns", "[1-6]");
        allowed.put("vutron:local-track-order", "original|title|artist|album");
        allowed.put("vutron:font-scale", "1(?:[0-4][0-9]|50)");
        allowed.put("vutron:player-lyrics", "true|false");
        allowed.put("vutron:playlist-sort-hints", "true|false");
        allowed.put("vutron:timer-preset", "(?:[1-9][0-9]{0,3}|1[0-7][0-9]{3}|18000)");
        allowed.put("vutron:sleep-mode", "duration|track|count");
        allowed.put("vutron:sleep-track-count", "(?:[1-9]|[1-9][0-9]|100)");
        allowed.put("vutron:sleep-fade-seconds", "0|5|15|30");
        for (Map.Entry<String, String> item : allowed.entrySet()) if (value.opt(item.getKey()) instanceof String && value.getString(item.getKey()).matches(item.getValue())) result.put(item.getKey(), value.getString(item.getKey()));
        String orders = value.optString("vutron:playlist-orders:v1", "");
        if (!orders.isEmpty()) {
            if (orders.length() > MAX_BYTES) throw new IOException("歌单排序超过备份大小限制，请精简后备份");
            try { result.put("vutron:playlist-orders:v1", safePlaylistOrders(new JSONObject(orders)).toString()); }
            catch (org.json.JSONException ignored) { /* Ignore malformed optional UI preferences. */ }
        }
        String trackOrders = value.optString("vutron:collection-orders:v1", "");
        if (!trackOrders.isEmpty()) {
            if (trackOrders.length() > MAX_BYTES) throw new IOException("歌曲排序超过备份大小限制，请精简后备份");
            try { result.put("vutron:collection-orders:v1", safeOnlineTrackOrders(new JSONObject(trackOrders)).toString()); }
            catch (org.json.JSONException ignored) { /* Optional UI ordering, never media or account data. */ }
        }
        String histories = value.optString(CollectionOrderHistoryBackup.KEY, "");
        if (!histories.isEmpty()) {
            if (histories.length() > MAX_BYTES) throw new IOException("排序历史超过备份大小限制，请精简后备份");
            try { result.put(CollectionOrderHistoryBackup.KEY, CollectionOrderHistoryBackup.online(new JSONObject(histories)).toString()); }
            catch (org.json.JSONException ignored) { /* Malformed optional history is not imported as media or account data. */ }
        }
        return result;
    }
    static JSONObject safeOnlineTrackOrders(JSONObject raw) throws Exception {
        JSONObject safe = new JSONObject(); java.util.Iterator<String> scopes = raw.keys();
        while (scopes.hasNext() && safe.length() < 250) {
            String scope = scopes.next(); JSONObject order = raw.optJSONObject(scope);
            boolean netease = scope.matches("netease:[0-9]+:playlist:[0-9]+");
            if (!netease) {
                JSONArray parts;
                try { parts = new JSONArray(scope); } catch (org.json.JSONException invalid) { continue; }
                if (parts.length() != 4 || !"plugin".equals(parts.optString(0)) || !parts.optString(1).matches("[a-zA-Z0-9._:-]{1,160}")
                        || !parts.optString(2).matches("[a-zA-Z0-9._:-]{1,160}") || !parts.optString(3).matches("[a-zA-Z0-9._:-]{1,256}")) continue;
            }
            if (order == null || !order.optString("mode").matches("original|title|artist|album|custom")) continue;
            JSONArray input = order.optJSONArray("keys"), keys = new JSONArray(); java.util.Set<String> seen = new java.util.HashSet<>();
            if (input != null) for (int i = 0; i < input.length() && keys.length() < 10000; i++) {
                if (!(input.opt(i) instanceof String)) continue;
                String key = input.optString(i); boolean valid = netease && key.matches("netease:[0-9]+");
                if (!netease) try {
                    JSONArray pair = new JSONArray(key);
                    valid = pair.length() == 2 && pair.optString(0).matches("[a-zA-Z0-9._:-]{0,160}") && pair.optString(1).matches("[a-zA-Z0-9._:-]{1,256}");
                } catch (org.json.JSONException invalid) { valid = false; }
                if (valid && seen.add(key)) keys.put(key);
            }
            safe.put(scope, new JSONObject().put("mode", order.getString("mode")).put("keys", keys));
        }
        return safe;
    }
    static JSONObject safePlaylistOrders(JSONObject raw) throws Exception {
        JSONObject safe = new JSONObject(); int count = 0;
        java.util.Iterator<String> scopes = raw.keys();
        while (scopes.hasNext() && count < 250) {
            String scope = scopes.next(); JSONObject order = raw.optJSONObject(scope);
            if (!scope.matches("(?:netease:[0-9]+|local:device)") || order == null) continue;
            String mode = order.optString("mode", "");
            if (!mode.matches("original|name|created|recent|custom")) continue;
            JSONArray keys = new JSONArray(); java.util.Set<String> seen = new java.util.HashSet<>();
            JSONArray input = order.optJSONArray("keys");
            if (input != null) for (int i = 0; i < input.length() && keys.length() < 3000; i++) {
                Object item = input.opt(i);
                if (item instanceof String && ((String)item).matches("[a-zA-Z0-9:_-]{1,200}") && seen.add((String)item)) keys.put(item);
            }
            JSONObject recent = new JSONObject(), source = order.optJSONObject("recent");
            if (source != null) {
                java.util.Iterator<String> names = source.keys();
                while (names.hasNext() && recent.length() < 3000) {
                    String key = names.next(); Object time = source.opt(key);
                    if (key.matches("[a-zA-Z0-9:_-]{1,200}") && time instanceof Number && Double.isFinite(((Number)time).doubleValue()) && ((Number)time).doubleValue() > 0) recent.put(key,time);
                }
            }
            safe.put(scope, new JSONObject().put("mode", mode).put("keys", keys).put("recent", recent)); count++;
        }
        return safe;
    }
    static JSONObject validate(JSONObject input) throws Exception {
        if (!(input.opt("format") instanceof Number) || ((Number) input.get("format")).doubleValue() != 1.0 || !GENERATOR.equals(input.optString("generator"))) throw new IOException("请选择 Vutron Music 导出的 JSON 备份");
        JSONArray collections = input.optJSONArray("collections"), safe = new JSONArray(); int count = 0;
        if (collections == null || collections.length() > 250) throw new IOException("备份歌单数量无效");
        for (int i = 0; i < collections.length(); i++) {
            JSONObject item = collections.getJSONObject(i); JSONArray tracks = item.getJSONArray("tracks"), cleaned = new JSONArray(); Map<String,String> historyKeys = item.optJSONObject("orderHistory") == null ? null : new HashMap<>();
            if ((count += tracks.length()) > 20000 || item.getString("name").length() > 1024 || item.optString("description").length()>4096) throw new IOException("备份曲目或名称超过限制");
            for (int j = 0; j < tracks.length(); j++) {
                JSONObject row = tracks.getJSONObject(j), track = portableTrack(row);
                track.put("key", digest(fingerprint(track) + ":" + j));
                if (historyKeys != null && row.optString("key").matches("[a-f0-9]{64}")) historyKeys.put(row.getString("key"), track.getString("key"));
                if (track.optString("name").length() > 2048 || track.optString("album").length() > 2048 || track.optLong("duration") > 86400000
                        || track.optInt("volume", 100) < 0 || track.optInt("volume", 100) > 100 || Math.abs(track.optLong("lyricOffsetMs")) > 30000
                        || track.optBoolean("onlineOnly") && track.optLong("neteaseId") <= 0) throw new IOException("备份曲目资料无效");
                cleaned.put(track);
            }
            String mode = item.optString("sortMode", "original"); if (!Arrays.asList("original", "title", "artist", "album", "custom").contains(mode)) mode = "original";
            JSONObject collection = new JSONObject().put("name", item.getString("name")).put("sortMode", mode).put("tracks", cleaned).put("volume", Math.max(0, Math.min(100, item.optInt("volume", 100))));
            if (item.has("description")) collection.put("description",item.optString("description"));
            JSONObject orderHistory = CollectionOrderHistoryBackup.portable(item.optJSONObject("orderHistory"), historyKeys);
            if (orderHistory != null) collection.put("orderHistory", orderHistory);
            String key = item.optString("collectionKey", "");
            if (key.matches("[a-zA-Z0-9:_-]{1,200}")) collection.put("collectionKey", key);
            if (item.opt("createTime") instanceof Number && item.optLong("createTime") > 0) collection.put("createTime",item.getLong("createTime"));
            safe.put(collection);
        }
        JSONObject result = new JSONObject().put("collections", safe).put("frontend", safeFrontend(input.optJSONObject("frontend") == null ? new JSONObject() : input.getJSONObject("frontend")))
                .put("settings", safePreferences(input.optJSONObject("settings") == null ? new JSONObject() : input.getJSONObject("settings")))
                .put("pluginSourcePriorities",PluginSourceRegistry.sanitizePriorities(input.optJSONObject("pluginSourcePriorities")==null ? new JSONObject() : input.getJSONObject("pluginSourcePriorities")));
        if (input.has("trackSourceOverrides")) result.put("trackSourceOverrides",TrackSourceOverrides.sanitize(input.getJSONObject("trackSourceOverrides")));
        return result;
    }
    static final class RestorePlan {
        final JSONObject document,safe,orders;
        final List<JSONObject> added;
        final byte[] encoded;
        RestorePlan(JSONObject document,JSONObject safe,JSONObject orders,List<JSONObject> added,byte[] encoded) {
            this.document=document;this.safe=safe;this.orders=orders;this.added=added;this.encoded=encoded;
        }
        JSONObject receipt() throws JSONException {
            return new JSONObject().put("frontend", safe.getJSONObject("frontend")).put("orders", orders)
                    .put("collectionCount", added.size()).put("collectionSkipped", safe.getJSONArray("collections").length() - added.size());
        }
    }
    static RestorePlan planRestore(JSONObject previous,JSONObject input) throws Exception {
        JSONObject safe = validate(input), existing = new JSONObject(previous.toString()), orders = new JSONObject(); JSONArray collections = existing.getJSONArray("collections"), incoming = safe.getJSONArray("collections");
        JSONObject historyRecords = new JSONObject(safe.getJSONObject("frontend").optString(CollectionOrderHistoryBackup.KEY, "{}"));
        List<JSONObject> added=new ArrayList<>();
        Map<String,String> known = new HashMap<>(), remap = new HashMap<>();
        for (int i = 0; i < collections.length(); i++) known.put(collections.getJSONObject(i).optString("backupKey"), collections.getJSONObject(i).getString("id"));
        for (int i = 0; i < incoming.length(); i++) {
            JSONObject item = incoming.getJSONObject(i); String hash = digest(item.toString());
            String sourceKey = item.optString("collectionKey", "");
            if (known.containsKey(hash)) { if (!sourceKey.isEmpty()) remap.put(sourceKey,known.get(hash)); restoreOrderHistory(historyRecords, item, known.get(hash)); continue; }
            String id = "restored:" + UUID.randomUUID(); item.put("id", id).put("backupKey", hash);
            if (item.optLong("createTime") <= 0) item.put("createTime", System.currentTimeMillis());
            known.put(hash,id); if (!sourceKey.isEmpty()) remap.put(sourceKey,id); collections.put(item);
            added.add(item);
            JSONArray keys = new JSONArray(), tracks = item.getJSONArray("tracks");
            for (int j = 0; j < tracks.length(); j++) keys.put(LocalLibraryIds.key(new JSONObject(tracks.getJSONObject(j).toString()).put("localPlaylistId", id).put("localEntryKey", tracks.getJSONObject(j).getString("key"))));
            orders.put(id, new JSONObject().put("mode", item.getString("sortMode")).put("keys", keys));
            restoreOrderHistory(historyRecords, item, id);
        }
        JSONObject frontend = safe.getJSONObject("frontend");
        if (historyRecords.length() > 0 || frontend.has(CollectionOrderHistoryBackup.KEY)) frontend.put(CollectionOrderHistoryBackup.KEY, historyRecords.toString());
        if (frontend.has("vutron:playlist-orders:v1")) {
            JSONObject all = new JSONObject(frontend.getString("vutron:playlist-orders:v1")), local = all.optJSONObject("local:device");
            if (local != null) {
                JSONArray keys = new JSONArray(), source = local.getJSONArray("keys");
                for (int i=0;i<source.length();i++) if (remap.containsKey(source.optString(i))) keys.put(remap.get(source.getString(i)));
                JSONObject recent = new JSONObject(), sourceRecent = local.getJSONObject("recent");
                for (Iterator<String> i=sourceRecent.keys();i.hasNext();) { String key=i.next(); if (remap.containsKey(key)) recent.put(remap.get(key),sourceRecent.get(key)); }
                local.put("keys",keys).put("recent",recent); frontend.put("vutron:playlist-orders:v1",all.toString());
            }
        }
        return new RestorePlan(existing,safe,orders,added,storeBytes(existing));
    }
    private static void restoreOrderHistory(JSONObject records, JSONObject collection, String id) throws Exception {
        JSONObject history = collection.optJSONObject("orderHistory");
        if (history == null) return;
        Map<String,String> keys = new HashMap<>(); JSONArray tracks = collection.getJSONArray("tracks");
        for (int i = 0; i < tracks.length(); i++) {
            String key = tracks.getJSONObject(i).getString("key");
            keys.put(key, LocalLibraryIds.key(new JSONObject(tracks.getJSONObject(i).toString()).put("localPlaylistId", id).put("localEntryKey", key)));
        }
        records.put(id, CollectionOrderHistoryBackup.remap(history, keys));
    }
    static JSONObject restore(Context c, JSONObject input, PortableAccounts.RestorePlan accounts) throws Exception {
        RestorePlan plan = planRestore(load(c), input);
        long originalArtworkCapacity = ArtworkCache.capacityMiB(c);
        JSONObject receipt = BackupRestoreTransaction.run(transaction -> {
            java.util.concurrent.Callable<JSONObject> publishLibrary = () -> {
                synchronized (PluginSourceRegistry.LOCK) {
                    synchronized (TrackSourceOverrides.LOCK) {
                        try { return publishLibrary(c, plan, transaction); }
                        catch (Exception failure) { transaction.rollback(failure); throw failure; }
                    }
                }
            };
            return accounts == null ? publishLibrary.call() : accounts.apply(transaction, publishLibrary);
        });
        JSONObject audioSettings = plan.safe.getJSONObject("settings").getJSONObject("audio_cache_settings");
        JSONObject artworkSettings = plan.safe.getJSONObject("settings").getJSONObject("artwork_cache_settings");
        if (audioSettings.has("capacity_mib")) AudioCache.reloadRestoredCapacity(c);
        if (artworkSettings.has("capacity_mib")) {
            long restoredArtworkCapacity = artworkSettings.getLong("capacity_mib");
            if (restoredArtworkCapacity < originalArtworkCapacity)
                ArtworkCache.trimRestoredCapacity(c, restoredArtworkCapacity);
        }
        AndroidLyricOverlayService.refreshSettings();
        AndroidPlaybackService.onVolumeSettingsChanged(c);
        AndroidPlaybackService.onPlaybackTuningChanged(c, () -> {});
        return receipt;
    }

    private static JSONObject publishLibrary(Context c, RestorePlan plan, BackupRestoreTransaction transaction) throws Exception {
        if (!plan.added.isEmpty()) {
            transaction.beforeFile(file(c));
            LibraryFiles.writeBytes(file(c),plan.encoded);
        }
        PluginSourceRegistry.restorePriorities(c, plan.safe.getJSONObject("pluginSourcePriorities"), transaction);
        if (plan.safe.has("trackSourceOverrides")) {
            transaction.beforeFile(TrackSourceOverrides.file(c));
            TrackSourceOverrides.restore(c,plan.safe.getJSONObject("trackSourceOverrides"));
        }
        JSONObject settings = plan.safe.getJSONObject("settings");
        JSONObject audioSettings = settings.getJSONObject("audio_cache_settings");
        JSONObject artworkSettings = settings.getJSONObject("artwork_cache_settings");
        long audioCapacity = audioSettings.optLong("capacity_mib"), artworkCapacity = artworkSettings.optLong("capacity_mib");
        if (audioCapacity > 0 && audioCapacity * 1024L * 1024L < AudioCache.stats(c).bytes) audioSettings.remove("capacity_mib");
        if (artworkCapacity > 0 && artworkCapacity * 1024L * 1024L < ArtworkCache.bytes(c)) artworkSettings.remove("capacity_mib");
        for (String pref : PREFS) {
            Map<String,Object> changes = new LinkedHashMap<>();
            if ("playback_volume".equals(pref)) {
                for (JSONObject item : plan.added) changes.put(PlaybackVolume.playlistKey(item.getString("id")), item.getInt("volume"));
            }
            SharedPreferences preferences = c.getSharedPreferences(pref, Context.MODE_PRIVATE);
            JSONObject values = settings.getJSONObject(pref);
            for (Iterator<String> i = values.keys(); i.hasNext();) {
                String key = i.next(); Object value = values.get(key);
                if (value instanceof Boolean) changes.put(key, value);
                else if ("playback_tuning".equals(pref)) changes.put(key, ((Number)value).floatValue());
                else if ("capacity_mib".equals(key) || key.startsWith("lyric_offset_ms_")) changes.put(key, ((Number)value).longValue());
                else changes.put(key, ((Number)value).intValue());
            }
            transaction.preferences(preferences, changes);
        }
        return plan.receipt();
    }
    static void remove(Context c, String id, String entry) throws Exception {
        removeEntries(c, id, entry == null ? null : java.util.Collections.singleton(entry));
    }
    static void removeEntries(Context c, String id, java.util.Set<String> entries) throws Exception {
        JSONObject data = load(c); JSONArray kept = new JSONArray(), collections = data.getJSONArray("collections"); boolean found = false;
        for (int i = 0; i < collections.length(); i++) {
            JSONObject item = collections.getJSONObject(i);
            if (!id.equals(item.optString("id"))) { kept.put(item); continue; }
            found = true;
            if (entries == null) continue;
            JSONArray rows = new JSONArray(), tracks = item.getJSONArray("tracks");
            for (int j = 0; j < tracks.length(); j++) if (!entries.contains(tracks.getJSONObject(j).optString("key"))) rows.put(tracks.getJSONObject(j));
            item.put("tracks", rows); kept.put(item);
        }
        if (!found) throw new IOException("恢复的歌单不存在");
        LibraryFiles.writeJson(file(c), data.put("collections", kept));
    }
    static void restoreRemoved(Context c, String id, JSONArray removed) throws Exception {
        JSONObject data = load(c); JSONArray collections = data.getJSONArray("collections");
        for (int i = 0; i < collections.length(); i++) {
            JSONObject item = collections.getJSONObject(i); if (!id.equals(item.optString("id"))) continue;
            JSONArray current = item.getJSONArray("tracks"), restored = LocalRemovalRows.restore(current, removed, row -> row.optString("key"));
            if (current.toString().equals(restored.toString())) return;
            item.put("tracks", restored); LibraryFiles.writeJson(file(c), data); return;
        }
        throw new IOException("恢复的歌单已删除，请重新导入");
    }
}
