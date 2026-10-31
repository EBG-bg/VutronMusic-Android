package io.github.vutronmusic.personal;

import java.io.FileNotFoundException;
import java.io.IOException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import org.junit.Test;
import static org.junit.Assert.*;

public class PlaybackFailureTest {
    @Test public void wrappedAndSuppressedFailuresKeepActionableCategoriesWithoutPrivateUrls() {
        IOException combined = new IOException("https://private.example/audio?token=secret");
        combined.addSuppressed(new NeteaseApi.CommentFailure(301, "cookie=secret"));
        PlaybackFailure auth = PlaybackFailure.from(combined, "resolve", true, true);
        assertEquals("auth", auth.code);
        assertFalse(auth.message.contains("secret"));
        assertFalse(auth.diagnostic.contains("private.example"));
        assertEquals("timeout", PlaybackFailure.from(new IOException(new SocketTimeoutException("secret")), "resolve", true, true).code);
        assertEquals("network", PlaybackFailure.from(new UnknownHostException("private.example"), "resolve", true, true).code);
    }

    @Test public void localPermissionAndMissingFilesDoNotBecomeOnlineSourceErrors() {
        assertEquals("local_permission", PlaybackFailure.from(new SecurityException("private/path"), "prepare", false, false).code);
        assertEquals("local_missing", PlaybackFailure.from(new FileNotFoundException("private/path"), "prepare", false, false).code);
        assertEquals("local_missing", PlaybackFailure.from(new PlaybackFailure.Reported("local_missing", "backup"), "resolve", true, false).code);
        assertEquals("source_unavailable", PlaybackFailure.from(new IOException("no full track"), "resolve", true, true).code);
    }

    @Test public void playerCodesSeparateDecodingTimeoutNetworkAndUnknownFailures() {
        assertEquals("decode", PlaybackFailure.media(1, -1007, false, true).code);
        assertEquals("decode", PlaybackFailure.media(1, -1010, true, true).code);
        assertEquals("timeout", PlaybackFailure.media(1, -110, true, true).code);
        assertEquals("source_io", PlaybackFailure.media(1, -1004, true, true).code);
        assertEquals("network", PlaybackFailure.media(1, -1004, true, false).code);
        assertEquals("playback", PlaybackFailure.media(1, 0, false, true).code);
        assertEquals("player", PlaybackFailure.media(100, 0, true, true).code);
    }
}
