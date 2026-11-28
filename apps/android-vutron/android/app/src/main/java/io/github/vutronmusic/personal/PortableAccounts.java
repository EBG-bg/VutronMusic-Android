package io.github.vutronmusic.personal;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;

/** Portable, encrypted-backup payload. This class never returns credentials to Capacitor. */
final class PortableAccounts {
    private static final int MAX_PLUGINS = 64;
    private static final String[] DEVICE_FIELDS = {"KUGOU_API_GUID", "KUGOU_API_MID", "KUGOU_API_DEV", "KUGOU_API_MAC", "KUGOU_API_WEBGL", "dfid"};
    private PortableAccounts() { }

    static JSONObject snapshot(Context context) throws Exception {
        try { return collect(context); }
        catch (org.json.JSONException malformed) { throw invalid(); }
    }
    private static JSONObject collect(Context context) throws Exception {
        JSONObject document = new JSONObject().put("version", 1);
        synchronized (SessionStore.class) {
            String cookie = SessionStore.readForBackup(context);
            if (!cookie.isEmpty()) {
                String profile = prefs(context, "vutron_user").getString("profile", "");
                if (profile.isEmpty()) throw new IOException("无法读取网易云账号资料，请先刷新账号");
                document.put("netease", mainAccount(new JSONObject().put("cookie", cookie).put("profile", new JSONObject(profile))));
            }
        }
        synchronized (AndroidPluginManager.class) {
            File root = AndroidPluginManager.root(context);
            // Snapshot the registered definitions without mutating or reconciling a running host's registry.
            JSONObject stored = AndroidPluginManager.readJson(new File(root, "registry.json"), new JSONObject().put("plugins", new JSONObject()));
            JSONObject entries = stored.getJSONObject("plugins");
            JSONArray rows = new JSONArray();
            for (Iterator<String> ids = entries.keys(); ids.hasNext();) {
                String id = ids.next();
                JSONObject definition = entries.getJSONObject(id);
                String base = definition.optString("baseId", id);
                if (!trusted(entries, id, base)) continue;
                JSONObject state = AndroidPluginManager.readJson(new File(root, id + ".state.json"), new JSONObject());
                JSONObject db = state.optJSONObject("db");
                JSONObject account = db == null ? null : db.optJSONObject("PluginData");
                if (!signedIn(base, account)) continue;
                JSONObject row = new JSONObject().put("id", id).put("baseId", base).put("enabled", definition.optBoolean("enabled", true))
                    .put("name", definition.optString("name", base)).put("account", account);
                JSONObject store = state.optJSONObject("store");
                row.put("baseUrl", store == null ? "" : store.optString("baseUrl", ""));
                if (base.equals("kugou") && state.optJSONObject("kugouDevice") != null) row.put("kugouDevice", state.getJSONObject("kugouDevice"));
                rows.put(pluginRow(row));
            }
            return document.put("plugins", rows);
        }
    }

    static boolean hasAccounts(JSONObject document) {
        JSONArray rows = document.optJSONArray("plugins");
        return document.optJSONObject("netease") != null || rows != null && rows.length() > 0;
    }

    static RestorePlan prepare(Context context, JSONObject document) throws Exception {
        try { return validate(context, document); }
        catch (org.json.JSONException malformed) { throw invalid(); }
    }
    private static RestorePlan validate(Context context, JSONObject document) throws Exception {
        if (document == null || !Integer.valueOf(1).equals(document.opt("version"))) throw invalid();
        JSONObject main = document.has("netease") ? mainAccount(document.getJSONObject("netease")) : null;
        JSONArray raw = document.getJSONArray("plugins");
        if (raw.length() > MAX_PLUGINS) throw invalid();
        Set<String> ids = new HashSet<>();
        JSONArray rows = new JSONArray();
        int skipped = 0;
        for (int i = 0; i < raw.length(); i++) {
            JSONObject row = raw.getJSONObject(i);
            String id = AndroidPluginManager.identity(row.getString("id"));
            if (!ids.add(id)) throw invalid();
            if (!supported(row.getString("baseId"))) { skipped++; continue; }
            rows.put(pluginRow(row));
        }
        return new RestorePlan(context, main, rows, skipped);
    }

    private static IOException invalid() { return new IOException("备份中的账号资料格式无效"); }
    private static SharedPreferences prefs(Context context, String name) { return context.getSharedPreferences(name, Context.MODE_PRIVATE); }
    private static boolean supported(String base) {
        return base.equals("netease") || base.equals("kugou") || base.equals("emby") || base.equals("jellyfin") || base.equals("navidrome");
    }
    private static boolean trusted(JSONObject entries, String id, String base) {
        JSONObject parent = entries.optJSONObject(base), entry = entries.optJSONObject(id);
        return supported(base) && (id.equals(base) || id.startsWith(base + ":")) && parent != null && parent.optBoolean("builtIn")
            && base.equals(parent.optString("baseId")) && (entry == null || base.equals(entry.optString("baseId")));
    }
    private static boolean signedIn(String base, JSONObject account) {
        if (account == null) return false;
        Object userId = account.opt("userId");
        if (!(userId instanceof String || userId instanceof Number) || userId.toString().trim().isEmpty() || "0".equals(userId.toString())) return false;
        String field = base.equals("netease") ? "cookie" : base.equals("navidrome") ? "nativeToken" : "token";
        Object token = account.opt(field);
        return token instanceof String && !((String)token).trim().isEmpty();
    }
    private static String text(JSONObject value, String key, int limit, boolean required) throws Exception {
        Object raw = value.opt(key);
        if ((raw == null || raw == JSONObject.NULL) && !required) return "";
        if (!(raw instanceof String)) throw invalid();
        String result = (String)raw;
        if (result.length() > limit || result.indexOf('\0') >= 0 || required && result.trim().isEmpty()) throw invalid();
        return result;
    }
    private static String header(JSONObject value, String key) throws Exception {
        String result = text(value, key, 65536, true);
        if (result.contains("\r") || result.contains("\n")) throw invalid();
        return result;
    }
    private static JSONObject mainAccount(JSONObject row) throws Exception {
        JSONObject source = row.getJSONObject("profile");
        long id = source.getLong("userId");
        if (id <= 0) throw invalid();
        JSONObject profile = new JSONObject().put("userId", id).put("vipType", source.optInt("vipType", 0));
        profile.put("nickname", text(source, source.has("nickname") ? "nickname" : "userName", 512, false));
        profile.put("avatarUrl", text(source, "avatarUrl", 8192, false));
        return new JSONObject().put("cookie", header(row, "cookie")).put("profile", profile);
    }
    static JSONObject pluginRow(JSONObject row) throws Exception {
        String id = AndroidPluginManager.identity(text(row, "id", 120, true)), base = text(row, "baseId", 64, true);
        if (!supported(base) || !(id.equals(base) || id.startsWith(base + ":"))) throw invalid();
        String url = text(row, "baseUrl", 8192, false);
        if (!url.isEmpty()) {
            URI uri;
            try { uri = new URI(url); } catch (java.net.URISyntaxException invalidUri) { throw invalid(); }
            if (!("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme())) || uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null) throw invalid();
        } else if (!(base.equals("netease") || base.equals("kugou"))) throw invalid();
        JSONObject source = row.getJSONObject("account");
        if (!signedIn(base, source)) throw invalid();
        if (source.get("userId").toString().length() > 512) throw invalid();
        JSONObject account = new JSONObject().put("userId", source.get("userId"));
        String tokenKey = base.equals("netease") ? "cookie" : base.equals("navidrome") ? "nativeToken" : "token";
        account.put(tokenKey, header(source, tokenKey));
        if (base.equals("navidrome")) {
            account.put("userName", text(source, "userName", 8192, true));
            account.put("clientId", text(source, "clientId", 8192, true));
            // The Subsonic protocol signs requests with this value even after native login.
            account.put("pwd", text(source, "pwd", 8192, false));
        } else if (source.has("userName")) {
            account.put("userName", text(source, "userName", 8192, false));
        }
        if (!source.isNull("isVip")) account.put("isVip", source.getBoolean("isVip"));
        if (!source.isNull("vipType")) account.put("vipType", source.getInt("vipType"));
        JSONObject result = new JSONObject().put("id", id).put("baseId", base).put("name", text(row, "name", 256, false))
                .put("enabled", row.getBoolean("enabled")).put("baseUrl", url).put("account", account);
        if (base.equals("kugou") && row.has("kugouDevice")) {
            JSONObject sourceDevice = row.getJSONObject("kugouDevice"), device = new JSONObject();
            for (String key : DEVICE_FIELDS) if (sourceDevice.has(key)) device.put(key, text(sourceDevice, key, 512, false));
            result.put("kugouDevice", device);
        }
        return result;
    }

    static final class RestorePlan {
        final Context context;
        final JSONObject main;
        final JSONArray plugins;
        final int skipped;
        RestorePlan(Context context, JSONObject main, JSONArray plugins, int skipped) {
            this.context = context; this.main = main; this.plugins = plugins; this.skipped = skipped;
        }
        JSONObject apply(BackupRestoreTransaction transaction, java.util.concurrent.Callable<JSONObject> publishLibrary) throws Exception {
            synchronized (AndroidPluginManager.class) {
                synchronized (SessionStore.class) {
                    File directory = plugins.length() == 0 ? null : AndroidPluginManager.root(context);
                    java.util.concurrent.Callable<JSONObject> publish = () -> {
                        try { return applyLocked(directory, transaction, publishLibrary); }
                        catch (Exception failure) { transaction.rollback(failure); throw failure; }
                    };
                    try {
                        return directory == null ? publish.call() : EmbeddedSources.withPluginStoreAccess(context, directory, plugins, publish);
                    } catch (Exception failure) {
                        transaction.rollback(failure);
                        throw failure;
                    }
                }
            }
        }
        private JSONObject applyLocked(File root, BackupRestoreTransaction transaction, java.util.concurrent.Callable<JSONObject> publishLibrary) throws Exception {
            JSONObject registry = root == null ? null : AndroidPluginManager.registryForRestore(context);
            Set<String> applied = new HashSet<>();
            for (int i = 0; i < plugins.length(); i++) {
                JSONObject row = plugins.getJSONObject(i);
                if (writePlugin(root, registry.getJSONObject("plugins"), row, transaction)) applied.add(row.getString("id"));
            }
            if (!applied.isEmpty()) {
                File registryFile = new File(root, "registry.json");
                transaction.beforeFile(registryFile);
                LibraryFiles.writeJson(registryFile, registry);
            }
            if (main != null) {
                transaction.beforePreferences(prefs(context, "session"), java.util.List.of("iv", "data"));
                SessionStore.save(context, main.getString("cookie"));
                JSONObject user = main.getJSONObject("profile");
                transaction.preferences(prefs(context, "vutron_user"), Map.of("profile", user.toString()));
                transaction.preferences(prefs(context, "vutron_cache_index"), Map.of("owner_id", user.getLong("userId")));
            }
            JSONObject result = publishLibrary.call();
            for (String id : applied) {
                AndroidPluginManager.invalidateArtwork(context, id);
                AndroidPlaybackService.invalidatePluginSource(id);
            }
            return result.put("neteaseRestored", main != null).put("pluginAccountsRestored", applied.size())
                .put("pluginAccountsSkipped", skipped + plugins.length() - applied.size());
        }
    }
    private static boolean writePlugin(File root, JSONObject entries, JSONObject row, BackupRestoreTransaction transaction) throws Exception {
        String id = row.getString("id"), base = row.getString("baseId");
        if (!trusted(entries, id, base)) return false;
        JSONObject entry = entries.optJSONObject(id);
        if (entry == null) {
            if (entries.length() >= MAX_PLUGINS) return false;
            entry = new JSONObject(entries.getJSONObject(base).toString()).put("id", id).put("builtIn", false).put("createdAt", System.currentTimeMillis());
        }
        File file = new File(root, id + ".state.json");
        JSONObject state = AndroidPluginManager.readJson(file, new JSONObject());
        JSONObject next = restoredState(row, state);
        transaction.beforeFile(file);
        LibraryFiles.writeJson(file, next);
        entry.put("enabled", row.getBoolean("enabled")).put("status", "login");
        if (!row.getString("name").trim().isEmpty()) entry.put("name", row.getString("name"));
        entries.put(id, entry);
        return true;
    }
    static JSONObject restoredState(JSONObject row, JSONObject old) throws Exception {
        JSONObject account = row.getJSONObject("account"), oldStore = old.optJSONObject("store"), oldDb = old.optJSONObject("db");
        JSONObject oldAccount = oldDb == null ? null : oldDb.optJSONObject("PluginData");
        String url = row.getString("baseUrl");
        boolean same = oldAccount != null && signedIn(row.getString("baseId"), oldAccount) && oldAccount.get("userId").toString().equals(account.get("userId").toString())
            && url.equals(oldStore == null ? "" : oldStore.optString("baseUrl", ""));
        JSONObject state = same ? old : new JSONObject();
        JSONObject db = same ? oldDb : new JSONObject();
        JSONObject store = same && oldStore != null ? oldStore : new JSONObject();
        state.put("db", db.put("PluginData", account)).put("store", store.put("baseUrl", url)).put("accountGeneration", old.optLong("accountGeneration",0) + 1);
        if (row.has("kugouDevice")) state.put("kugouDevice", row.getJSONObject("kugouDevice"));
        return state;
    }
}
