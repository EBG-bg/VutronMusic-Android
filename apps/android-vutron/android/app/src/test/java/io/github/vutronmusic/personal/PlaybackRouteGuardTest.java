package io.github.vutronmusic.personal;

import org.junit.Test;
import static org.junit.Assert.*;

public class PlaybackRouteGuardTest {
    @Test public void disconnectInvalidatesAllPreviouslyQueuedStarts() {
        PlaybackRouteGuard route = new PlaybackRouteGuard();
        long first = route.capture(), second = route.capture();
        assertTrue(route.accepts(first));
        route.disconnected();
        assertFalse(route.accepts(first));
        assertFalse(route.accepts(second));
        long explicitNewPlay = route.capture();
        assertTrue(route.accepts(explicitNewPlay));
        route.disconnected();
        assertFalse(route.accepts(explicitNewPlay));
    }
    @Test public void acceptingANewExplicitActionNeverRevalidatesAnOldStart() {
        PlaybackRouteGuard route = new PlaybackRouteGuard();
        long preparing = route.capture();
        route.disconnected();
        long explicitResume = route.capture();
        assertFalse(route.accepts(preparing));
        assertTrue(route.accepts(explicitResume));
        assertFalse(route.accepts(-1));
    }
}
