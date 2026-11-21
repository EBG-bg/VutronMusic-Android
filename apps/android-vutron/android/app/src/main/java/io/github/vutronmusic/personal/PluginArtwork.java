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
    static String thumbnailKey(String pluginId, String uri, long revision, int size) {
        int requested=ArtworkSource.requestSize(size);
        return requested==512?"":"plugin-artwork-thumbnail:"+requested+":"+cacheKey(pluginId,uri,revision);
    }

    static void request(Context context, String id, String uri, ArtworkCache.Result result) {
        request(context, id, uri, new JSONObject(), result);
    }

    static void request(Context context, String id, String uri, JSONObject sourceContext, ArtworkCache.Result result) {
        request(context, id, uri, sourceContext, 512, result);
    }

    static void request(Context context, String id, String uri, JSONObject sourceContext, int size, ArtworkCache.Result result) {
        final int requested = ArtworkSource.requestSize(size);
        final long revision = AndroidPluginManager.artworkRevision(context, id);
        final String key = cacheKey(id, uri, revision);
        final String smallKey=thumbnailKey(id,uri,revision,requested);
        ArtworkCache.Result complete=new ArtworkCache.Result() {
            @Override public void success(String path) {
                if (revision != AndroidPluginManager.artworkRevision(context, id)) { result.failure(new IOException("Plugin account or server changed")); return; }
                if (requested == 512 || path.startsWith("data:image/")) { result.success(path); return; }
                ArtworkThumbnail.request(context, path, requested, smallKey, new ArtworkCache.Result() {
                    @Override public void success(String thumbnail) {
                        if (revision == AndroidPluginManager.artworkRevision(context, id)) result.success(thumbnail);
                        else result.failure(new IOException("Plugin account or server changed"));
                    }
                    @Override public void failure(Exception error) { result.failure(error); }
                });
            }
            @Override public void failure(Exception error) { result.failure(error); }
        };
        if(!smallKey.isEmpty()) {
            String small=ArtworkCache.resolveOwned(context,smallKey);
            if(!small.isEmpty()){complete.success(small);return;}
        }
        String full=ArtworkCache.resolveOwned(context,key);
        if(!full.isEmpty()){complete.success(full);return;}
        if(!AndroidPluginManager.networkAllowed(context)) {
            // A scoped thumbnail remains a valid offline image after its large source was evicted.
            for(int bucket:new int[]{320,192,96}) {
                String small=ArtworkCache.resolveOwned(context,thumbnailKey(id,uri,revision,bucket));
                if(!small.isEmpty()){complete.success(small);return;}
            }
        }
        ArtworkCache.fetchOwned(context, key, () -> {
            AndroidPluginManager.identity(id);
            byte[] bytes = load(context, id, uri, sourceContext);
            if (revision != AndroidPluginManager.artworkRevision(context, id)) throw new IOException("Plugin account or server changed");
            return bytes;
        }, complete);
    }

    static void enqueuePlaylistCover(Context context, String id, String scope, String uri, JSONObject sourceContext, long revision) {
        if (uri.isEmpty()) return;
        ArtworkCache.fetchOwnedManual(context, cacheKey(id, uri, revision), () -> {
            checkPlaylistOwner(context, id, scope, revision);
            byte[] bytes = load(context, id, uri, sourceContext == null ? new JSONObject() : sourceContext);
            checkPlaylistOwner(context, id, scope, revision);
            return bytes;
        });
    }

    private static void checkPlaylistOwner(Context context, String id, String scope, long revision) throws Exception {
        AndroidPluginManager.requireEnabled(context, id);
        if (!AndroidPluginManager.networkAllowed(context) || revision != AndroidPluginManager.artworkRevision(context, id)
                || !scope.equals(AndroidPluginManager.accountScope(context, id))) throw new IOException("Plugin playlist owner changed");
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
        original = imageUri(original);
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
            uri = PluginMedia.resolvedUrl(result);
            if (result instanceof JSONObject) {
                JSONObject value = (JSONObject) result;
                headers = value.optJSONObject("headers");
                if (headers == null && value.optJSONObject("data") != null) headers = value.getJSONObject("data").optJSONObject("headers");
            }
            if (uri == null || uri.isEmpty()) throw new IOException("Plugin has no artwork for this item");
        }
        uri = imageUri(uri);
        if (!AndroidPluginManager.networkAllowed(context)) throw new IOException("Local-only mode has no cached plugin artwork");
        if (!(uri.startsWith("https://") || uri.startsWith("http://"))) throw new IOException("Unsupported plugin artwork URI");
        // Public Kugou thumbnails have no account credentials. Fetch their exact
        // HTTPS CDN directly, like native NetEase covers; a Node media proxy is
        // unnecessary and its public-IP lookup rejects VPN fake-IP DNS routes.
        JSONObject location;
        if (directPublicImage(uri)) {
            AndroidPluginManager.requireEnabled(context, id);
            location = new JSONObject().put("url", uri);
        } else location = AndroidPluginManager.resolveMedia(context, id, uri, headers);
        HttpURLConnection connection = (HttpURLConnection) new URL(location.getString("url")).openConnection();
        connection.setConnectTimeout(10000); connection.setReadTimeout(15000); connection.setInstanceFollowRedirects(false);
        if (directPublicImage(uri)) {
            connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36");
            connection.setRequestProperty("Referer", "https://www.kugou.com/");
        }
        try {
            if (!AndroidPluginManager.networkAllowed(context)) throw new IOException("Plugin networking is paused");
            int status = connection.getResponseCode(); if (status < 200 || status >= 300) throw new IOException("Plugin artwork HTTP " + status);
            if (connection.getContentLength() > MAX_BYTES) throw new IOException("Plugin artwork exceeds 4 MiB");
            try (InputStream input = connection.getInputStream()) { return read(input, context, true); }
        } finally { connection.disconnect(); }
    }

    /** Only normalize public Kugou image templates; signed/custom URLs retain their bytes. */
    static String imageUri(String original) {
        if (original == null) return "";
        String template = original.replace("{size}", "512").replace("%7Bsize%7D", "512").replace("%7bsize%7d", "512");
        try {
            java.net.URI uri = new java.net.URI(template);
            String host = uri.getHost();
            if (host == null || uri.getRawQuery() != null || uri.getRawFragment() != null || uri.getRawUserInfo() != null) return original;
            host = host.toLowerCase(java.util.Locale.ROOT);
            if (!(host.equals("imge.kugou.com") || host.equals("singerimg.kugou.com") || host.equals("kgimg.com") || host.endsWith(".kgimg.com"))) return original;
            if ("http".equalsIgnoreCase(uri.getScheme())) return "https" + template.substring(template.indexOf(':'));
            return "https".equalsIgnoreCase(uri.getScheme()) ? template : original;
        } catch (java.net.URISyntaxException invalid) { return original; }
    }

    static boolean directPublicImage(String value) {
        try {
            java.net.URI uri = new java.net.URI(value);
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || uri.getPort() != -1
                    || uri.getRawQuery() != null || uri.getRawFragment() != null || uri.getRawUserInfo() != null) return false;
            host = host.toLowerCase(java.util.Locale.ROOT);
            return host.equals("imge.kugou.com") || host.equals("singerimg.kugou.com")
                    || host.equals("kgimg.com") || host.endsWith(".kgimg.com");
        } catch (java.net.URISyntaxException invalid) { return false; }
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
