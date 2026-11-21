package io.github.vutronmusic.personal;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.net.SocketTimeoutException;
import java.util.ArrayList;
import java.util.List;
import static org.junit.Assert.*;

public class PluginMediaPlaybackTest {
    private static final String PRIMARY = "https://primary.example.test/song";
    private static final String BACKUP = "https://backup.example.test/song";
    private static final String THIRD = "https://other.example.test/song";
    private static final String FOURTH = "https://unused.example.test/song";

    @Test public void registerPrimaryAndRetainTwoDistinctSignedBackupsWithoutRequestingThem() throws Exception {
        List<String> calls = new ArrayList<>();
        String signedBackup = BACKUP + "?signature=synthetic";
        JSONArray urls = new JSONArray().put("").put(JSONObject.NULL).put(PRIMARY).put(PRIMARY).put(signedBackup).put(THIRD);
        JSONObject resolved = PluginMedia.resolvePlaybackLocation(urls, url -> {
            calls.add(url);
            return new JSONObject().put("url", "http://127.0.0.1/plugin-media/primary");
        });
        assertEquals(List.of(PRIMARY), calls);
        assertEquals("http://127.0.0.1/plugin-media/primary", resolved.getString("url"));
        assertEquals(List.of(signedBackup, THIRD), candidates(resolved));
        assertEquals(1, resolved.getInt("pluginMediaAttempt"));
        assertEquals(3, resolved.getInt("pluginMediaTotal"));
    }

    @Test public void failedPrimaryRegistrationFallsThroughToBackupWithoutResolvingTheSongAgain() throws Exception {
        List<String> calls = new ArrayList<>();
        JSONObject resolved = PluginMedia.resolvePlaybackLocation(new JSONArray().put(PRIMARY).put(BACKUP).put(THIRD), url -> {
            calls.add(url);
            if (PRIMARY.equals(url)) throw new SocketTimeoutException("synthetic timeout");
            return new JSONObject().put("url", "http://127.0.0.1/plugin-media/backup");
        });
        assertEquals(List.of(PRIMARY, BACKUP), calls);
        assertEquals("http://127.0.0.1/plugin-media/backup", resolved.getString("url"));
        assertEquals(List.of(THIRD), candidates(resolved));
        assertEquals(2, resolved.getInt("pluginMediaAttempt"));
        assertEquals(3, resolved.getInt("pluginMediaTotal"));
    }

    @Test public void noBackupIsAttemptedAfterCancellationAccountChangeOrOfflinePolicy() {
        JSONArray urls = new JSONArray().put(PRIMARY).put(BACKUP);
        for (IOException original : List.of(new PluginMedia.StaleAccount(), new InterruptedIOException("cancelled"),
                new AndroidPluginManager.PluginFailure("PLUGIN_OFFLINE", "offline"),
                new AndroidPluginManager.PluginFailure("PLUGIN_ACCOUNT_CHANGED", "cancelled"))) {
            List<String> calls = new ArrayList<>();
            Exception actual = assertThrows(IOException.class, () -> PluginMedia.resolvePlaybackLocation(urls, url -> { calls.add(url); throw original; }));
            assertSame(original, actual);
            assertEquals(List.of(PRIMARY), calls);
        }
    }

    @Test public void pluginAuthAndTransportErrorsStayDistinctFromNativeNetEaseLogin() {
        assertEquals("plugin_auth", PlaybackFailure.from(new AndroidPluginManager.PluginFailure("PLUGIN_AUTH", "synthetic"), "resolve", true, true).code);
        assertEquals("plugin_auth", PlaybackFailure.from(new PluginMedia.StaleAccount(), "source_owner", true, true).code);
        assertEquals("timeout", PlaybackFailure.from(new AndroidPluginManager.PluginFailure("PLUGIN_TIMEOUT", "synthetic"), "resolve", true, true).code);
        assertEquals("network", PlaybackFailure.from(new AndroidPluginManager.PluginFailure("ENETUNREACH", "synthetic"), "resolve", true, true).code);
    }

    @Test public void sameSourceRetryCannotRunAnUnboundedArrayOfFailedOrigins() {
        List<String> calls = new ArrayList<>();
        IOException first = new IOException("first source failed");
        Exception failure = assertThrows(IOException.class, () -> PluginMedia.resolvePlaybackLocation(new JSONArray().put(PRIMARY).put(BACKUP).put(THIRD).put(FOURTH), url -> {
            calls.add(url);
            if (PRIMARY.equals(url)) throw first;
            throw new IOException("backup failed");
        }));
        assertSame(first, failure);
        assertEquals(List.of(PRIMARY, BACKUP, THIRD), calls);
    }

    @Test public void successivePlayerFailuresUseOnlyTheRemainingAddresses() throws Exception {
        List<String> calls = new ArrayList<>();
        PluginMedia.PlaybackLocationResolver register = url -> {
            calls.add(url);
            return new JSONObject().put("url", "http://127.0.0.1/media/test");
        };
        JSONObject primary = PluginMedia.resolvePlaybackLocation(new JSONArray().put(PRIMARY).put(BACKUP).put(THIRD), register);
        JSONObject backup = next(primary, register);
        assertEquals(2, backup.getInt("pluginMediaAttempt"));
        JSONObject last = next(backup, register);
        assertEquals(3, last.getInt("pluginMediaAttempt"));
        assertEquals(3, last.getInt("pluginMediaTotal"));
        assertEquals(0, last.getJSONArray("pluginMediaCandidates").length());
        assertEquals(List.of(PRIMARY, BACKUP, THIRD), calls);
    }

    @Test public void aLocalAssetIsNotQueuedAsAnOnlineRecoveryAddress() throws Exception {
        JSONObject result = PluginMedia.resolvePlaybackLocation(new JSONArray().put(PRIMARY).put("vutron://local-asset?id=1").put(THIRD),
                url -> new JSONObject().put("url", "http://127.0.0.1/media/test"));
        assertEquals(List.of(THIRD), candidates(result));
        assertEquals(2, result.getInt("pluginMediaTotal"));
    }

    private static JSONObject next(JSONObject attempt, PluginMedia.PlaybackLocationResolver resolver) throws Exception {
        return PluginMedia.resolveCandidates(candidates(attempt), attempt.getInt("pluginMediaAttempt"), resolver);
    }

    private static List<String> candidates(JSONObject attempt) throws Exception {
        List<String> remaining = new ArrayList<>();
        JSONArray rows = attempt.getJSONArray("pluginMediaCandidates");
        for (int i = 0; i < rows.length(); i++) remaining.add(rows.getString(i));
        return remaining;
    }
}
