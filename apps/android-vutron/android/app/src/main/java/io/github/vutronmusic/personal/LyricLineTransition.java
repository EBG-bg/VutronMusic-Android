package io.github.vutronmusic.personal;

/** One display-frame clock for all three overlay rows; independent of Android's view lifecycle. */
final class LyricLineTransition {
    static final long DEFAULT_DURATION_MS = 420L;
    private static final long MAX_FRAME_GAP_MS = 250L;
    private static final long POSITION_TOLERANCE_MS = 250L;

    enum Change { NONE, DIRECT, SCROLL }

    private Object timeline;
    private int lineIndex = Integer.MIN_VALUE;
    private long previousPosition;
    private long previousFrameAt = -1L;
    private boolean enabled;
    private long durationMs = DEFAULT_DURATION_MS;
    private long activeDurationMs;
    private long startedAt = -1L;
    private float progress = 1f;

    void configure(float systemScale, boolean reducedMotion, boolean animatorsEnabled) {
        configure(null, systemScale, reducedMotion, animatorsEnabled);
    }

    void configure(String preference, float systemScale, boolean reducedMotion, boolean animatorsEnabled) {
        boolean full = "full".equals(preference);
        enabled = full || !"reduced".equals(preference) && !reducedMotion && animatorsEnabled
                && Float.isFinite(systemScale) && systemScale > 0f;
        // Explicit full mode has its own clock; automatic mode uses the actual system scale.
        durationMs = full ? DEFAULT_DURATION_MS
                : enabled ? Math.max(1L, Math.round(DEFAULT_DURATION_MS * (double) systemScale)) : 0L;
        if (!enabled) finish();
    }

    boolean enabled() { return enabled; }
    long durationMs() { return durationMs; }
    boolean running() { return startedAt >= 0L; }
    float progress() { return progress; }

    Change show(Object nextTimeline, int nextIndex, long position, long now, float playbackRate,
                boolean textChanged, boolean allowTransition) {
        boolean sameTimeline = timeline == nextTimeline;
        boolean changedLine = lineIndex != nextIndex;
        long frameGap = previousFrameAt < 0 ? -1 : now - previousFrameAt;
        float rate = Float.isFinite(playbackRate) && playbackRate > 0f ? playbackRate : 1f;
        boolean continuous = frameGap >= 0L && frameGap <= MAX_FRAME_GAP_MS
                && Math.abs((double) position - previousPosition - frameGap * (double) rate) <= POSITION_TOLERANCE_MS;
        boolean scroll = enabled && allowTransition && sameTimeline && continuous
                && lineIndex >= 0 && nextIndex == lineIndex + 1;
        boolean changed = !sameTimeline || changedLine || textChanged;
        boolean interrupted = running() && (!continuous || !allowTransition || !enabled);
        timeline = nextTimeline;
        lineIndex = nextIndex;
        previousPosition = position;
        previousFrameAt = now;
        if (!changed && !interrupted) return Change.NONE;
        // A seek, new timeline, title/first lyric or restored window never animates stale text.
        finish();
        if (!scroll) return Change.DIRECT;
        startedAt = now;
        activeDurationMs = durationMs;
        progress = 0f;
        return Change.SCROLL;
    }

    boolean advance(long now) {
        if (!running()) return false;
        float fraction = (float) Math.max(0L, now - startedAt) / activeDurationMs;
        if (fraction >= 1f) { finish(); return false; }
        progress = smooth(fraction);
        return true;
    }

    void finish() { startedAt = -1L; progress = 1f; }

    void reset() {
        finish();
        timeline = null;
        lineIndex = Integer.MIN_VALUE;
        previousFrameAt = -1L;
    }

    // Both groups fade while travelling, before their glyphs or shadows reach the outer edge.
    static float outgoingOpacity(float progress) { return 1f - smooth((progress - .08f) / .78f); }
    static float incomingOpacity(float progress) { return smooth((progress - .08f) / .84f); }

    /** A common distance keeps all rows on one track, irrespective of individual line counts. */
    static float outgoingOffset(float progress, float trackHeight) { return -trackHeight * progress; }
    static float incomingOffset(float progress, float trackHeight) { return trackHeight * (1f - progress); }

    private static float smooth(float fraction) {
        float t = Math.max(0f, Math.min(1f, fraction));
        return t * t * (3f - 2f * t);
    }
}
