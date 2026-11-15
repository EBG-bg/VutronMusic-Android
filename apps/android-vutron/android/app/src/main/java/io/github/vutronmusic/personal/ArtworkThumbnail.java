package io.github.vutronmusic.personal;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.ExifInterface;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.net.URI;

/** Disk-backed small covers. Image decoding shares the existing artwork queue, never the UI thread. */
final class ArtworkThumbnail {
    private ArtworkThumbnail() { }

    static boolean isOwned(Context context, String uri) {
        try { return ownedFile(context.getFilesDir(), uri) != null; }
        catch (IOException | IllegalArgumentException invalid) { return false; }
    }

    static boolean isOwnedPath(Context context, String uri) {
        try { return ownedPath(context.getFilesDir(), uri) != null; }
        catch (IOException | IllegalArgumentException invalid) { return false; }
    }

    /** Only an existing direct child owned by ArtworkCache may be read for a thumbnail. */
    static File ownedFile(File filesDirectory, String uri) throws IOException {
        File file = ownedPath(filesDirectory, uri);
        return file != null && file.isFile() && file.length() > 0 ? file : null;
    }

    static File ownedPath(File filesDirectory, String uri) throws IOException {
        if (uri == null || uri.isEmpty()) return null;
        try {
            URI address = URI.create(uri);
            if (!"file".equalsIgnoreCase(address.getScheme()) || address.getRawAuthority() != null
                    || address.getRawQuery() != null || address.getRawFragment() != null) return null;
            File root = new File(filesDirectory, "artwork-cache-v1").getCanonicalFile();
            File file = new File(address).getCanonicalFile();
            return root.equals(file.getParentFile()) && file.getName().matches("[a-f0-9]{64}\\.img") ? file : null;
        } catch (IllegalArgumentException invalid) { return null; }
    }

    static String key(File source, int size) throws IOException {
        return "artwork-thumbnail:v1:" + source.getCanonicalPath() + ":" + source.length()
                + ":" + source.lastModified() + ":" + ArtworkSource.requestSize(size);
    }

    static int sampleSize(int width, int height, int size) {
        int sample = 1, target = ArtworkSource.requestSize(size);
        while (width / sample > target * 2 || height / sample > target * 2) sample *= 2;
        return sample;
    }

    static boolean supportedMime(String mime) { return "image/jpeg".equals(mime) || "image/png".equals(mime); }

    static void request(Context context, String uri, int size, ArtworkCache.Result result) {
        request(context, uri, size, "", result);
    }

    /** A public-image URL alias keeps a known thumbnail reachable after its large source is evicted. */
    static void request(Context context, String uri, int size, String cacheKey, ArtworkCache.Result result) {
        final File source;
        final String identity;
        final int requested = ArtworkSource.requestSize(size);
        try {
            source = ownedFile(context.getFilesDir(), uri);
            if (source == null) { result.failure(new IOException("Thumbnail source is not an owned cached image")); return; }
            if (requested == 512) { result.success(uri); return; }
            identity = key(source, requested);
        } catch (IOException invalid) { result.failure(invalid); return; }
        ArtworkCache.fetchDerived(context, cacheKey == null || cacheKey.isEmpty() ? identity : cacheKey, uri, () -> {
            if (!source.isFile() || !identity.equals(key(source, requested))) throw new IOException("Thumbnail source changed");
            byte[] bytes = thumbnail(source, requested);
            if (!source.isFile() || !identity.equals(key(source, requested))) throw new IOException("Thumbnail source changed");
            return bytes;
        }, new ArtworkCache.Result() {
            @Override public void success(String path) { result.success(path); }
            @Override public void failure(Exception error) {
                // An unsupported/failed optional thumbnail must not break an existing usable cover.
                if (source.isFile()) result.success(uri);
                else result.failure(error);
            }
        });
    }

    private static byte[] thumbnail(File source, int size) throws IOException {
        BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(source.getAbsolutePath(), bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IOException("Thumbnail source is not a decodable image");
        if (!supportedMime(bounds.outMimeType) || Math.max(bounds.outWidth, bounds.outHeight) <= size) return null;
        if ("image/png".equals(bounds.outMimeType) && pngHasAnimation(source)) return null;
        if ("image/jpeg".equals(bounds.outMimeType)) {
            int orientation = new ExifInterface(source.getAbsolutePath()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            if (orientation != ExifInterface.ORIENTATION_NORMAL && orientation != ExifInterface.ORIENTATION_UNDEFINED) return null;
        }
        Bitmap decoded = null, scaled = null;
        try {
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, size);
            options.inScaled = false; options.inPreferredConfig = Bitmap.Config.ARGB_8888;
            decoded = BitmapFactory.decodeFile(source.getAbsolutePath(), options);
            if (decoded == null) throw new IOException("Thumbnail decoding failed");
            double ratio = Math.min(1.0, (double) size / Math.max(decoded.getWidth(), decoded.getHeight()));
            int width = Math.max(1, (int) Math.round(decoded.getWidth() * ratio));
            int height = Math.max(1, (int) Math.round(decoded.getHeight() * ratio));
            scaled = width == decoded.getWidth() && height == decoded.getHeight()
                    ? decoded : Bitmap.createScaledBitmap(decoded, width, height, true);
            try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                if (!scaled.compress(Bitmap.CompressFormat.PNG, 100, output)) throw new IOException("Thumbnail encoding failed");
                return output.toByteArray();
            }
        } catch (OutOfMemoryError exhausted) { throw new IOException("Thumbnail decoding exceeded available memory", exhausted); }
        finally {
            if (scaled != null && scaled != decoded) scaled.recycle();
            if (decoded != null) decoded.recycle();
        }
    }

    /** APNG's animation control must occur before its first IDAT; unknown headers keep the original. */
    static boolean pngHasAnimation(File file) throws IOException {
        try (DataInputStream input = new DataInputStream(new FileInputStream(file))) {
            if (input.readLong() != 0x89504e470d0a1a0aL) throw new IOException("Invalid PNG signature");
            for (int chunks = 0; chunks < 1024; chunks++) {
                int length = input.readInt(), kind = input.readInt();
                if (length < 0 || length > 4 * 1024 * 1024) throw new IOException("Invalid PNG chunk size");
                if (kind == 0x6163544c) return true; // acTL
                if (kind == 0x49444154 || kind == 0x49454e44) return false; // IDAT / IEND
                int remaining = length + 4;
                while (remaining > 0) {
                    int skipped = input.skipBytes(remaining);
                    if (skipped == 0) throw new IOException("Incomplete PNG chunk");
                    remaining -= skipped;
                }
            }
            throw new IOException("Too many PNG chunks");
        }
    }
}
