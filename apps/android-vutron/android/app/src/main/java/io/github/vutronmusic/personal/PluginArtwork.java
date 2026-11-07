package io.github.vutronmusic.personal;

import android.content.Context;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Resolves plugin artwork through the common bounded cover cache. */
final class PluginArtwork {
    private static final int MAX_BYTES = 4 * 1024 * 1024;
    private PluginArtwork() { }

    static String cacheKey(String pluginId, String uri, long revision) { return "plugin-artwork:" + pluginId + ":" + revision + ":" + uri; }

    static void request(Context context, String id, String uri, ArtworkCache.Result result) {
        request(context, id, uri, new JSONObject(), result);
    }

    static void request(Context context, String id, String uri, JSONObject sourceContext, ArtworkCache.Result result) {
        final long revision = AndroidPluginManager.artworkRevision(context, id);
        final String key = cacheKey(id, uri, revision);
        ArtworkCache.fetchOwned(context, key, () -> {
            AndroidPluginManager.identity(id);
            byte[] bytes = load(context, id, uri, sourceContext);
            if (revision != AndroidPluginManager.artworkRevision(context, id)) throw new IOException("Plugin account or server changed");
            return bytes;
        }, new ArtworkCache.Result() {
            @Override public void success(String path) {
                if (revision == AndroidPluginManager.artworkRevision(context, id)) result.success(path);
                else result.failure(new IOException("Plugin account or server changed"));
            }
            @Override public void failure(Exception error) { result.failure(error); }
        });
    }

    static String resolve(Context context, String id, String uri) throws Exception { return resolve(context, id, uri, new JSONObject()); }
    static String resolve(Context context, String id, String uri, JSONObject sourceContext) throws Exception {
        String cached = ArtworkCache.resolveOwned(context, cacheKey(id, uri, AndroidPluginManager.artworkRevision(context, id)));
        if (!cached.isEmpty()) return cached;
        CountDownLatch done = new CountDownLatch(1); AtomicReference<String> value = new AtomicReference<>(); AtomicReference<Exception> failure = new AtomicReference<>();
        request(context, id, uri, sourceContext, new ArtworkCache.Result() {
            @Override public void success(String result) { value.set(result); done.countDown(); }
            @Override public void failure(Exception error) { failure.set(error); done.countDown(); }
        });
        if (!done.await(90, TimeUnit.SECONDS)) throw new IOException("Plugin artwork request timed out");
        if (failure.get() != null) throw failure.get();
        return value.get();
    }

    private static byte[] load(Context context, String id, String original, JSONObject sourceContext) throws Exception {
        if (original == null || original.isEmpty()) throw new IOException("Plugin artwork is empty");
        java.net.URI address = new java.net.URI(original);
        JSONObject params = sourceContext == null ? new JSONObject() : new JSONObject(sourceContext.toString());
        if (address.getRawQuery() != null) for (String pair : address.getRawQuery().split("&")) {
            int equals = pair.indexOf('=');
            String key = URLDecoder.decode(equals < 0 ? pair : pair.substring(0, equals), "UTF-8");
            String value = URLDecoder.decode(equals < 0 ? "" : pair.substring(equals + 1), "UTF-8");
            if (!key.equals("__proto__") && !key.equals("constructor")) params.put(key, value);
        }
        if (isLocalAsset(address)) return local(context, params.optString("trackId", params.optString("id")));
        if (!AndroidPluginManager.networkAllowed(context)) throw new IOException("Local-only mode has no cached plugin artwork");
        String uri = original; JSONObject headers = new JSONObject();
        if ("vutron".equalsIgnoreCase(address.getScheme())) {
            Object result = AndroidPluginManager.invoke(context, id, "getPic", params);
            if (result instanceof String) uri = (String) result;
            else if (result instanceof JSONObject) { uri = ((JSONObject) result).optString("url"); headers = ((JSONObject) result).optJSONObject("headers"); }
            if (uri == null || uri.isEmpty()) throw new IOException("Plugin has no artwork for this item");
        }
        if (!AndroidPluginManager.networkAllowed(context)) throw new IOException("Local-only mode has no cached plugin artwork");
        if (!(uri.startsWith("https://") || uri.startsWith("http://"))) throw new IOException("Unsupported plugin artwork URI");
        JSONObject location = AndroidPluginManager.resolveMedia(context, id, uri, headers);
        HttpURLConnection connection = (HttpURLConnection) new URL(location.getString("url")).openConnection();
        connection.setConnectTimeout(10000); connection.setReadTimeout(15000); connection.setInstanceFollowRedirects(false);
        try {
            if (!AndroidPluginManager.networkAllowed(context)) throw new IOException("Plugin networking is paused");
            int status = connection.getResponseCode(); if (status < 200 || status >= 300) throw new IOException("Plugin artwork HTTP " + status);
            if (connection.getContentLength() > MAX_BYTES) throw new IOException("Plugin artwork exceeds 4 MiB");
            try (InputStream input = connection.getInputStream()) { return read(input, context, true); }
        } finally { connection.disconnect(); }
    }

    static boolean isLocalAsset(java.net.URI value) {
        return ("http".equalsIgnoreCase(value.getScheme()) || "https".equalsIgnoreCase(value.getScheme()))
                && ("localhost".equalsIgnoreCase(value.getHost()) || "127.0.0.1".equals(value.getHost()))
                && value.getPort() == 41830 && "/local-asset".equals(value.getPath());
    }

    private static byte[] local(Context context, String identity) throws Exception {
        JSONArray rows = PluginLocalLibrary.tracks(context);
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            if (!identity.equals(String.valueOf(row.opt("id"))) && !identity.equals(AndroidPluginManager.digest("album:" + row.optString("album", "")))) continue;
            String image = row.optString("picLocalUri", row.optString("coverLocalUri", ""));
            if (image.startsWith("content://")) try (InputStream input = context.getContentResolver().openInputStream(Uri.parse(image))) { if (input != null) return read(input, context, false); }
            else if (image.startsWith("file://")) try (InputStream input = new FileInputStream(Uri.parse(image).getPath())) { return read(input, context, false); }
            String audio = LocalLibraryIds.uri(row);
            MediaMetadataRetriever retriever = new MediaMetadataRetriever();
            try {
                if (audio.startsWith("content://")) retriever.setDataSource(context, Uri.parse(audio));
                else retriever.setDataSource(audio.startsWith("file://") ? Uri.parse(audio).getPath() : audio);
                byte[] bytes = retriever.getEmbeddedPicture();
                if (bytes != null && bytes.length > 0 && bytes.length <= MAX_BYTES) return bytes;
            } finally { retriever.release(); }
        }
        throw new IOException("No artwork is embedded in the authorized local recording");
    }

    private static byte[] read(InputStream input, Context context, boolean remote) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int count;
        while ((count = input.read(buffer)) != -1) {
            if (remote && !AndroidPluginManager.networkAllowed(context)) throw new IOException("Plugin networking is paused");
            if (output.size() + count > MAX_BYTES) throw new IOException("Plugin artwork exceeds 4 MiB"); output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }
}
