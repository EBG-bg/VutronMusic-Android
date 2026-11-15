package io.github.vutronmusic.personal;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.util.UUID;

/** One short-lived inverse. Subsequent queue edits invalidate it without overwriting new work. */
final class PlaybackQueueUndo {
    private static Entry pending;
    private PlaybackQueueUndo() { }
    private static final class Entry {
        final String id = UUID.randomUUID().toString(); final long deadline;
        final PlaybackQueue.Snapshot expected; final JSONObject removed; final JSONArray cleared;
        final int index; final boolean upNext;
        Entry(PlaybackQueue.Snapshot expected, JSONObject removed, JSONArray cleared, int index, boolean upNext, long now) {
            this.expected = expected; this.removed = removed; this.cleared = cleared; this.index = index; this.upNext = upNext; deadline = now + 12000;
        }
    }
    static synchronized String offer(PlaybackQueue.Snapshot before, PlaybackQueue.Snapshot after, String operation, int index, boolean upNext, long now) throws Exception {
        if ("remove".equals(operation)) pending = new Entry(after, new JSONObject((upNext ? before.upNext : before.songs).getJSONObject(index).toString()), null, index, upNext, now);
        else if ("clearNext".equals(operation) && before.upNext.length() > 0) pending = new Entry(after, null, before.upNext, -1, true, now);
        else return "";
        return pending.id;
    }
    static synchronized String token(PlaybackQueue.Snapshot expected) { return pending != null && pending.expected == expected ? pending.id : ""; }
    static synchronized void discard(String id) { if (pending != null && pending.id.equals(id)) pending = null; }
    static synchronized void clear() { pending = null; }
    static synchronized PlaybackQueue.Snapshot restore(String id, PlaybackQueue.Snapshot current, long now) throws Exception {
        Entry value = pending;
        if (value == null || !value.id.equals(id) || now >= value.deadline) throw new IOException("撤销已过期，请重新操作");
        boolean empty = value.expected.count() == 0 && value.expected.upNext.length() == 0;
        if (current == null && !empty || current != null && (!current.token.equals(value.expected.token) || current.songs != value.expected.songs || current.upNext != value.expected.upNext))
            throw new IOException("播放队列已改变，未覆盖之后的操作");
        if (current == null) current = new PlaybackQueue.Snapshot(value.expected.token, new JSONArray(), -1);
        PlaybackQueue.Snapshot result = value.cleared != null ? new PlaybackQueue.Snapshot(current.token, current.songs, current.index, value.cleared, current.insertedPlaying)
                : current.insert(value.index, value.upNext, value.removed);
        return result;
    }
}
