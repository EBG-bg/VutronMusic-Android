package io.github.vutronmusic.personal;

/** A disconnected output cancels start commands that were already queued. */
final class PlaybackRouteGuard {
    private long epoch;
    synchronized long capture() { return epoch; }
    synchronized void disconnected() { epoch++; }
    synchronized boolean accepts(long captured) { return epoch == captured; }
}
