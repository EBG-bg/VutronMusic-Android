package io.github.vutronmusic.personal;

/** Monitors a MediaPlayer clock even when it never reports BUFFERING_START. */
final class RemotePlaybackProgress {
    static final long START_TIMEOUT_MS = 12_000L;
    static final long STALL_TIMEOUT_MS = 25_000L;
    private static final long DETECT_STALL_MS = 2_500L;
    private static final int ADVANCE_MS = 50;

    enum Sample { IDLE, ADVANCING, TIMED_OUT }

    private boolean active, started, waiting;
    private long progressedAt;
    private int position;

    void start(long now, int position) {
        active = true;
        waiting = !started;
        progressedAt = now;
        this.position = position;
    }

    void pause() { active = waiting = false; }

    void stop() { pause(); started = false; }

    boolean active() { return active; }
    boolean waiting() { return waiting; }
    boolean started() { return started; }

    Sample sample(long now, int next) {
        if (!active) return Sample.IDLE;
        if ((long) next - position >= ADVANCE_MS) {
            started = true;
            waiting = false;
            progressedAt = now;
            position = next;
            return Sample.ADVANCING;
        }
        long elapsed = now - progressedAt;
        if (elapsed >= DETECT_STALL_MS) waiting = true;
        return elapsed >= (started ? STALL_TIMEOUT_MS : START_TIMEOUT_MS) ? Sample.TIMED_OUT : Sample.IDLE;
    }

    /** Compare decoder timing with catalogue timing only for matched audio. */
    static boolean obviouslyTruncated(long catalogueMs, long decodedMs) {
        // Ignore short songs, unknown duration and normal VBR duration estimates.
        return catalogueMs >= 15_000L && catalogueMs <= Integer.MAX_VALUE && decodedMs > 0
                && catalogueMs - decodedMs > Math.max(8_000L, catalogueMs / 5L);
    }
}
