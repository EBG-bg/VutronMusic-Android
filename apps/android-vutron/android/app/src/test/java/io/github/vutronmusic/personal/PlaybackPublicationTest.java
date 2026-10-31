package io.github.vutronmusic.personal;

import org.junit.Test;
import static org.junit.Assert.*;

public class PlaybackPublicationTest {
    @Test public void progressDoesNotResendArtworkOrNotificationButChangesDo() {
        PlaybackPublication policy = new PlaybackPublication();
        Object cover = new Object();
        assertTrue(policy.metadataChanged(1, "Song", "Artist", 200_000, cover));
        assertTrue(policy.notificationChanged(true, true));
        for (int tick = 0; tick < 60; tick++) {
            assertFalse(policy.metadataChanged(1, "Song", "Artist", 200_000, cover));
            assertFalse(policy.notificationChanged(true, true));
        }
        assertTrue(policy.notificationChanged(false, false));
        assertFalse(policy.notificationChanged(false, false));
        assertTrue(policy.metadataChanged(1, "Song", "Artist", 200_000, new Object()));
        assertTrue(policy.notificationChanged(false, false));
        assertTrue(policy.metadataChanged(2, "Song", "Artist", 200_000, cover));
        assertTrue(policy.notificationChanged(true, true));
        assertTrue(policy.metadataChanged(2, "Song", "Artist", 180_000, cover));
    }

    @Test public void checkpointsArePeriodicAndImmediateSavesResetTheInterval() {
        PlaybackPublication policy = new PlaybackPublication();
        assertFalse(policy.checkpointDue(10_000, false));
        assertTrue(policy.checkpointDue(10_000, true));
        policy.checkpointSaved(10_000);
        assertFalse(policy.checkpointDue(14_999, true));
        assertTrue(policy.checkpointDue(15_000, true));
        policy.checkpointSaved(14_000); // Pause/seek/tuning saves immediately through the service.
        assertFalse(policy.checkpointDue(15_000, true));
        assertTrue(policy.checkpointDue(19_000, true));
        assertFalse(policy.checkpointDue(30_000, false));
    }

    @Test public void projectedProgressRemainsSmoothAtSpeedButStopsOnPauseBufferOrColdLaunch() {
        assertEquals(16_000, LyricFrameClock.project(10_000, 1_000, true, 60_000, 5_000, 1.5f));
        assertEquals(10_000, LyricFrameClock.project(10_000, 1_000, false, 60_000, 5_000, 1.5f));
        assertEquals(60_000, LyricFrameClock.project(59_000, 1_000, true, 60_000, 5_000, 2f));
        assertEquals(10_000, LyricFrameClock.project(10_000, 9_000, true, 60_000, 5_000, 1f));
        assertEquals(10_000, LyricFrameClock.project(10_000, -1, true, 60_000, 5_000, 1f));
    }
}
