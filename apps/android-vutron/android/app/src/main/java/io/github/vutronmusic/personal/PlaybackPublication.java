package io.github.vutronmusic.personal;

import java.util.Objects;

/** Media-thread policy: progress samples do not resend unchanged artwork or notifications. */
final class PlaybackPublication {
    static final long CHECKPOINT_INTERVAL_MS = 5_000L;
    private boolean metadataPublished, notificationPublished, checkpointSaved;
    private long id, duration, metadataRevision, notificationRevision, checkpointAt;
    private String title, artist;
    private Object artwork;
    private boolean ongoing, pauseAction;

    boolean metadataChanged(long nextId, String nextTitle, String nextArtist, long nextDuration, Object nextArtwork) {
        if (metadataPublished && id == nextId && duration == nextDuration && artwork == nextArtwork
                && Objects.equals(title, nextTitle) && Objects.equals(artist, nextArtist)) return false;
        metadataPublished = true;
        id = nextId; title = nextTitle; artist = nextArtist; duration = nextDuration; artwork = nextArtwork;
        metadataRevision++;
        return true;
    }

    boolean notificationChanged(boolean nextOngoing, boolean nextPauseAction) {
        if (notificationPublished && notificationRevision == metadataRevision
                && ongoing == nextOngoing && pauseAction == nextPauseAction) return false;
        notificationPublished = true;
        notificationRevision = metadataRevision; ongoing = nextOngoing; pauseAction = nextPauseAction;
        return true;
    }

    boolean checkpointDue(long now, boolean advancing) {
        return advancing && (!checkpointSaved || now < checkpointAt || now - checkpointAt >= CHECKPOINT_INTERVAL_MS);
    }

    void checkpointSaved(long now) { checkpointAt = now; checkpointSaved = true; }
}
