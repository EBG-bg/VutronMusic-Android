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

    @Test public void exhaustedMatchingKeepsTheAttemptedProviderAndPlayerCode() {
        PlaybackFailure original = PlaybackFailure.media(1, Integer.MIN_VALUE, true, true);
        PlaybackFailure unavailable = PlaybackFailure.noOtherMatch("bodian", original);
        assertEquals("alternatives_unavailable", unavailable.code);
        assertEquals("bodian: MediaPlayer what=1, extra=-2147483648", unavailable.diagnostic);
        assertTrue(PlaybackFailure.isMediaSourceFailure(1, Integer.MIN_VALUE));
        assertFalse(PlaybackFailure.isMediaSourceFailure(100, Integer.MIN_VALUE));
    }

    @Test public void twoAddressFailuresExplainPrepareTimeoutAndKeepBothAttempts() {
        PlaybackFailure timeout = PlaybackFailure.timedOut("prepare", 15_000);
        String rejected = "relay=failed, address", exhausted = "relay=failed, public DNS fallback, address_recovery";
        PlaybackFailure primary = timeout.withRelayReason(rejected).atAttempt(1, 2, rejected);
        PlaybackFailure backup = timeout.withRelayReason(exhausted).atAttempt(2, 2, exhausted).afterAttempts(primary.diagnostic);
        assertEquals("source_address", primary.code);
        assertEquals("source_address", backup.code);
        assertEquals("CDN 1/2 · prepare (15000 ms) · relay=failed, address\n"
                + "CDN 2/2 · prepare (15000 ms) · relay=failed, public DNS fallback, address_recovery", backup.diagnostic);
    }

    @Test public void previousAddressFailureDoesNotOverrideTheLatestDecodeFailure() {
        String rejected = "relay=failed, address", received = "relay=complete, HTTP 206, range, received bytes";
        PlaybackFailure primary = PlaybackFailure.timedOut("prepare", 15_000)
                .withRelayReason(rejected).atAttempt(1, 2, rejected);
        PlaybackFailure backup = PlaybackFailure.media(1, -1007, true, true).atStage("prepare")
                .withRelayReason(received).atAttempt(2, 2, received).afterAttempts(primary.diagnostic);
        assertEquals("decode", backup.code);
        assertEquals("CDN 1/2 · prepare (15000 ms) · relay=failed, address\n"
                + "CDN 2/2 · prepare: MediaPlayer what=1, extra=-1007 · relay=complete, HTTP 206, range, received bytes", backup.diagnostic);
    }

    @Test public void onlyAnExactRelayAddressFailureRefinesAnAmbiguousError() {
        PlaybackFailure timeout = PlaybackFailure.timedOut("prepare");
        for (String relay : new String[] { "", "relay=complete, address", "relay=failed, address, first_byte_timeout",
                "relay=failed, unknown_address", "relay=failed, first_byte_timeout" }) {
            assertSame(relay, timeout, timeout.withRelayReason(relay));
        }
        assertEquals("source_address", PlaybackFailure.media(1, Integer.MIN_VALUE, true, true)
                .withRelayReason("relay=failed, address").code);
        for (String code : new String[] { "auth", "plugin_auth", "offline", "network", "player", "decode" }) {
            PlaybackFailure known = PlaybackFailure.of(code);
            assertSame(code, known, known.withRelayReason("relay=failed, address_recovery"));
        }
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
