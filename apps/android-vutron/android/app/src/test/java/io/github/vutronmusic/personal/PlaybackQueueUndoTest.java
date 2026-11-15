package io.github.vutronmusic.personal;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class PlaybackQueueUndoTest {
    private JSONObject song(int id) throws Exception { return new JSONObject().put("id", id).put("name", "song" + id); }
    private PlaybackQueue.Snapshot queue() throws Exception { return PlaybackQueue.create(new JSONArray().put(song(1)).put(song(2)).put(song(3)), 1); }
    @Test public void undoReinsertsOneRowAndKeepsCurrentCursorAfterPlaybackMoved() throws Exception {
        PlaybackQueue.Snapshot original = queue(), after = original.remove(0, false);
        String id = PlaybackQueueUndo.offer(original, after, "remove", 0, false, 1000);
        PlaybackQueue.Snapshot moved = after.at(1), restored = PlaybackQueueUndo.restore(id, moved, 2000);
        assertEquals(3, restored.count()); assertEquals(3, restored.current().getInt("id")); assertEquals(2, restored.index);
        assertEquals(1, restored.songs.getJSONObject(0).getInt("id"));
    }
    @Test public void subsequentQueueEditRejectsUndoAndDoesNotReplaceItsSongs() throws Exception {
        PlaybackQueue.Snapshot original = queue(), after = original.remove(0, false), edited = after.appendTail(song(9));
        String id = PlaybackQueueUndo.offer(original, after, "remove", 0, false, 1000);
        try { PlaybackQueueUndo.restore(id, edited, 2000); fail("Overwrote a later queue edit"); } catch (java.io.IOException expected) { assertTrue(expected.getMessage().contains("已改变")); }
        assertEquals(9, edited.songs.getJSONObject(2).getInt("id"));
    }
    @Test public void removingCurrentWithPendingTracksDoesNotRestartTheRemovedSongOnUndo() throws Exception {
        PlaybackQueue.Snapshot original = PlaybackQueue.create(new JSONArray().put(song(1)), 0).appendNext(song(2));
        PlaybackQueue.Snapshot after = original.remove(0, false);
        String id = PlaybackQueueUndo.offer(original, after, "remove", 0, false, 1000);
        PlaybackQueue.Snapshot restored = PlaybackQueueUndo.restore(id, after, 2000);
        assertEquals(2, restored.current().getInt("id")); assertEquals(2, restored.count()); assertEquals(0, restored.upNext.length());
    }
    @Test public void clearedNextRestoresInOriginalOrderAndExpiresWithoutMutatingAnything() throws Exception {
        PlaybackQueue.Snapshot original = queue().appendNext(song(4)).appendNext(song(5)), after = original.clearNext();
        String id = PlaybackQueueUndo.offer(original, after, "clearNext", -1, true, 1000);
        PlaybackQueue.Snapshot restored = PlaybackQueueUndo.restore(id, after, 2000);
        assertEquals(4, restored.upNext.getJSONObject(0).getInt("id")); assertEquals(5, restored.upNext.getJSONObject(1).getInt("id"));
        try { PlaybackQueueUndo.restore(id, after, 13000); fail("Accepted expired undo"); } catch (java.io.IOException expected) { }
        assertEquals(0, after.upNext.length());
    }
    @Test public void batchAppendPreservesSelectionOrderAndRejectsInvalidRowsBeforePersist() throws Exception {
        PlaybackQueue.Snapshot original = queue(); JSONArray selected = new JSONArray().put(song(7)).put(song(8));
        PlaybackQueue.Snapshot next = original.appendMany(selected, true), tail = original.appendMany(selected, false);
        assertEquals(7, next.upNext.getJSONObject(0).getInt("id")); assertEquals(8, next.upNext.getJSONObject(1).getInt("id"));
        assertEquals(7, tail.songs.getJSONObject(3).getInt("id")); assertEquals(8, tail.songs.getJSONObject(4).getInt("id"));
        try { original.appendMany(new JSONArray().put(song(7)).put(new JSONObject()), true); fail("Accepted invalid row"); } catch (IllegalArgumentException expected) { }
        assertEquals(0, original.upNext.length());
    }
}
