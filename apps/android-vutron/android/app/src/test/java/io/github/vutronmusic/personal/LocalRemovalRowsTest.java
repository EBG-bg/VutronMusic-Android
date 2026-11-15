package io.github.vutronmusic.personal;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class LocalRemovalRowsTest {
    private JSONObject row(String key) throws Exception { return new JSONObject().put("key", key).put("name", key); }
    @Test public void inverseUsesNeighboursAndKeepsLaterAdditions() throws Exception {
        JSONArray original = new JSONArray().put(row("a")).put(row("b")).put(row("c")).put(row("d")).put(row("e"));
        JSONArray removed = LocalRemovalRows.capture(original, value -> "b".equals(value.optString("key")) || "d".equals(value.optString("key")), value -> value.optString("key"));
        JSONArray current = new JSONArray().put(row("a")).put(row("c")).put(row("e")).put(row("new"));
        JSONArray restored = LocalRemovalRows.restore(current, removed, value -> value.optString("key"));
        assertEquals("a", restored.getJSONObject(0).getString("key")); assertEquals("b", restored.getJSONObject(1).getString("key"));
        assertEquals("d", restored.getJSONObject(3).getString("key")); assertEquals("new", restored.getJSONObject(5).getString("key"));
        assertEquals(restored.toString(), LocalRemovalRows.restore(restored, removed, value -> value.optString("key")).toString());
    }
    @Test public void restoringOneCueSegmentDoesNotRestoreEverySegmentOfItsFile() throws Exception {
        JSONObject first = new JSONObject().put("localFolderId", "folder:x").put("localUri", "content://audio/1").put("cueTrackNo", 1).put("cueOffsetMs", 0);
        JSONObject second = new JSONObject(first.toString()).put("cueTrackNo", 2).put("cueOffsetMs", 30000);
        assertNotEquals(LocalTrackStore.exclusionKey(first), LocalTrackStore.exclusionKey(second));
        JSONArray removed = LocalRemovalRows.capture(new JSONArray().put(first).put(second), value -> LocalTrackStore.exclusionKey(first).equals(LocalTrackStore.exclusionKey(value)), LocalTrackStore::exclusionKey);
        JSONArray restored = LocalRemovalRows.restore(new JSONArray().put(second), removed, LocalTrackStore::exclusionKey);
        assertEquals(2, restored.length()); assertEquals(1, restored.getJSONObject(0).getInt("cueTrackNo")); assertEquals(2, restored.getJSONObject(1).getInt("cueTrackNo"));
    }
    @Test public void restoringAllRetainsSelectedFileMetadataAndOnlyClearsLegacyMarkersAfterBuildingTheIndex() throws Exception {
        JSONObject manual = new JSONObject().put("id", 8).put("name", "Selected file").put("localUri", "content://manual/8");
        JSONArray original = new JSONArray().put(manual), captured = LocalRemovalRows.capture(original, row -> true, LocalTrackStore::exclusionKey);
        JSONObject record = new JSONObject().put("track", manual).put("rows", new JSONObject().put("folders", new JSONArray()).put("selected", captured));
        java.util.Set<String> excluded = new java.util.HashSet<>(java.util.Set.of(LocalTrackStore.exclusionKey(manual), "legacy-record"));
        LocalTrackStore.RestoredIndex restored = LocalTrackStore.planRestore(new JSONArray(), new JSONArray(), excluded, java.util.Set.of(), new JSONArray().put(record), true);
        assertTrue(restored.changed); assertTrue(restored.excluded.isEmpty()); assertEquals("Selected file", restored.selected.getJSONObject(0).getString("name"));
        assertEquals("content://manual/8", restored.selected.getJSONObject(0).getString("localUri")); assertEquals(2, excluded.size());
        assertFalse(LocalTrackStore.planRestore(restored.folders, restored.selected, restored.excluded, java.util.Set.of(), new JSONArray().put(record), true).changed);
    }
    @Test public void restoringOneFolderTrackRequiresItsPermissionAndDoesNotMutateTheInputOnFailure() throws Exception {
        JSONObject track = new JSONObject().put("id", 9).put("localFolderId", "folder:lost").put("localUri", "content://lost/9");
        JSONObject record = new JSONObject().put("track", track).put("rows", new JSONObject().put("folders", LocalRemovalRows.capture(new JSONArray().put(track), row -> true, LocalTrackStore::exclusionKey)).put("selected", new JSONArray()));
        java.util.Set<String> excluded = new java.util.HashSet<>(java.util.Set.of(LocalTrackStore.exclusionKey(track)));
        try { LocalTrackStore.planRestore(new JSONArray(), new JSONArray(), excluded, java.util.Set.of(), new JSONArray().put(record), false); fail("Restored an unauthorized folder"); } catch (java.io.IOException expected) { }
        assertEquals(1, excluded.size());
    }
    @Test public void duplicateFilesKeepTheirOriginalMultiplicityMetadataAndOrder() throws Exception {
        JSONObject one = new JSONObject().put("fileName", "same.flac").put("name", "First title"), two = new JSONObject().put("fileName", "same.flac").put("name", "Second title"), three = new JSONObject().put("fileName", "same.flac").put("name", "Third title");
        JSONArray original = new JSONArray().put(one).put(two).put(three), removed = LocalRemovalRows.capture(original, row -> true, LocalPlaylistStore::removalIdentity);
        JSONArray restored = LocalRemovalRows.restore(new JSONArray(), removed, LocalPlaylistStore::removalIdentity);
        assertEquals(original.toString(), restored.toString());
        assertEquals(restored.toString(), LocalRemovalRows.restore(restored, removed, LocalPlaylistStore::removalIdentity).toString());
        JSONArray identical = new JSONArray().put(one).put(new JSONObject(one.toString())).put(new JSONObject(one.toString()));
        JSONArray identicalInverse = LocalRemovalRows.capture(identical, row -> true, LocalPlaylistStore::removalIdentity);
        assertEquals(3, LocalRemovalRows.restore(new JSONArray(), identicalInverse, LocalPlaylistStore::removalIdentity).length());
    }
    @Test public void aLaterConflictingEntryForTheSameFileIsRejectedInsteadOfOverwrittenOrDuplicated() throws Exception {
        JSONObject original = new JSONObject().put("fileName", "same.flac").put("name", "Original");
        JSONArray inverse = LocalRemovalRows.capture(new JSONArray().put(original).put(new JSONObject(original.toString())), row -> true, LocalPlaylistStore::removalIdentity);
        JSONArray later = new JSONArray().put(new JSONObject().put("fileName", "same.flac").put("name", "User's later title"));
        try { LocalRemovalRows.restore(later, inverse, LocalPlaylistStore::removalIdentity); fail("Overwrote a later same-file edit"); } catch (java.io.IOException expected) { assertTrue(expected.getMessage().contains("已变化")); }
        assertEquals(1, later.length()); assertEquals("User's later title", later.getJSONObject(0).getString("name"));
    }
    @Test public void aFailedIndexWriteNeverTouchesThePlaybackQueueAndRunsItsRollbackOnce() throws Exception {
        java.util.List<String> events = new java.util.ArrayList<>();
        try {
            LocalRemovalStore.commitThenPrepare(() -> { events.add("write-index"); throw new java.io.IOException("disk full"); }, () -> { events.add("stop-and-trim-queue"); return true; }, () -> events.add("rollback-index"));
            fail("Ignored a write failure");
        } catch (java.io.IOException expected) { assertEquals("disk full", expected.getMessage()); }
        assertEquals(java.util.List.of("write-index", "rollback-index"), events);
        events.clear(); assertFalse(LocalRemovalStore.commitThenPrepare(() -> events.add("write-index"), () -> { events.add("check-stop-confirmation"); return false; }, () -> events.add("rollback-index")));
        assertEquals(java.util.List.of("write-index", "check-stop-confirmation", "rollback-index"), events);
    }
    @Test public void onlineOnlyBundleEntriesWithEmptyFileNamesKeepSeparateTrackIdentities() throws Exception {
        JSONObject one = new JSONObject().put("fileName", "").put("onlineOnly", true).put("neteaseId", 101), two = new JSONObject().put("fileName", "").put("onlineOnly", true).put("neteaseId", 102);
        assertNotEquals(LocalPlaylistStore.removalIdentity(one), LocalPlaylistStore.removalIdentity(two));
        JSONArray inverse = LocalRemovalRows.capture(new JSONArray().put(one).put(two), row -> row.optLong("neteaseId") == 101, LocalPlaylistStore::removalIdentity);
        JSONArray restored = LocalRemovalRows.restore(new JSONArray().put(two), inverse, LocalPlaylistStore::removalIdentity);
        assertEquals(2, restored.length()); assertEquals(101, restored.getJSONObject(0).getLong("neteaseId")); assertEquals(102, restored.getJSONObject(1).getLong("neteaseId"));
    }
}
