package io.github.vutronmusic.personal;

import org.junit.Test;
import static org.junit.Assert.*;
import static io.github.vutronmusic.personal.RemotePlaybackProgress.Sample.*;

public class RemotePlaybackProgressTest {
    @Test public void preparedRemoteSourceWithoutBufferEventCannotWaitAtZeroForever() {
        RemotePlaybackProgress clock = new RemotePlaybackProgress();
        clock.start(1_000, 0);
        assertTrue(clock.waiting());
        assertFalse(clock.started());
        for (long now = 2_000; now < 13_000; now += 1_000) {
            assertEquals(IDLE, clock.sample(now, 0));
            assertTrue(clock.waiting());
        }
        assertEquals(TIMED_OUT, clock.sample(13_000, 0));
        PlaybackFailure failure = PlaybackFailure.noOtherMatch("bodian", PlaybackFailure.timedOut("first_audio"));
        assertEquals("alternatives_unavailable", failure.code);
        assertEquals("bodian: first_audio", failure.diagnostic);
    }

    @Test public void slowStreamsRecoverFromShortStallsAndAdvanceTheDeadlineOnlyWithAudio() {
        RemotePlaybackProgress clock = new RemotePlaybackProgress();
        clock.start(1_000, 0);
        assertEquals(ADVANCING, clock.sample(10_000, 100));
        assertFalse(clock.waiting());
        assertTrue(clock.started());
        assertEquals(IDLE, clock.sample(13_000, 140));
        assertTrue(clock.waiting());
        assertEquals(ADVANCING, clock.sample(23_000, 240));
        assertFalse(clock.waiting());
        assertEquals(IDLE, clock.sample(47_999, 249));
        assertEquals(TIMED_OUT, clock.sample(48_000, 249));
    }

    @Test public void aPauseOrSeekCanDiscardOldSamplesAndResumeFromTheActualCursor() {
        RemotePlaybackProgress clock = new RemotePlaybackProgress();
        clock.start(1_000, 0);
        assertEquals(ADVANCING, clock.sample(2_000, 500));
        clock.pause();
        assertFalse(clock.active());
        assertFalse(clock.waiting());
        assertEquals(IDLE, clock.sample(90_000, 500));
        clock.start(95_000, 54_000);
        assertTrue(clock.started());
        assertFalse(clock.waiting());
        assertEquals(IDLE, clock.sample(102_000, 54_000));
        assertEquals(ADVANCING, clock.sample(102_999, 54_100));
        assertFalse(clock.waiting());
        clock.stop();
        clock.start(120_000, 0);
        assertFalse(clock.started());
        assertTrue(clock.waiting());
    }

    @Test public void previewDurationIsDifferentFromOrdinaryDecoderVariance() {
        assertTrue(RemotePlaybackProgress.obviouslyTruncated(95_000, 11_600));
        assertFalse(RemotePlaybackProgress.obviouslyTruncated(95_000, 90_000));
        assertFalse(RemotePlaybackProgress.obviouslyTruncated(95_000, 96_000));
        assertFalse(RemotePlaybackProgress.obviouslyTruncated(12_000, 10_000));
        assertFalse(RemotePlaybackProgress.obviouslyTruncated(95_000, 0));
        assertFalse(RemotePlaybackProgress.obviouslyTruncated(0, 11_600));
    }
}
