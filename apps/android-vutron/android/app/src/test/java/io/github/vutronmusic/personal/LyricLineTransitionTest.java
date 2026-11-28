package io.github.vutronmusic.personal;

import org.junit.Test;
import static org.junit.Assert.*;

public class LyricLineTransitionTest {
    private static final Object TIMELINE = new Object();

    private LyricLineTransition transition() {
        LyricLineTransition result = new LyricLineTransition();
        result.configure(1f, false, true);
        return result;
    }

    private void start(LyricLineTransition transition) {
        assertEquals(LyricLineTransition.Change.DIRECT,
                transition.show(TIMELINE, 0, 990, 1000, 1f, true, true));
        assertEquals(LyricLineTransition.Change.SCROLL,
                transition.show(TIMELINE, 1, 1006, 1016, 1f, true, true));
    }

    @Test public void automaticModeRespectsBothFasterAndSlowerSystemScales() {
        LyricLineTransition transition = transition();
        assertEquals(420L, transition.durationMs());
        transition.configure(.5f, false, true);
        assertEquals(210L, transition.durationMs());
        start(transition);
        assertTrue(transition.advance(1016 + 105));
        assertEquals(.5f, transition.progress(), .0001f);
        transition.configure(2f, false, true);
        assertEquals(840L, transition.durationMs());
    }

    @Test public void eachDisabledAnimationSettingImmediatelyFinishesAnActiveTransition() {
        for (int setting = 0; setting < 5; setting++) {
            LyricLineTransition transition = transition();
            start(transition);
            float scale = setting == 0 ? 0f : setting == 3 ? Float.NaN : setting == 4 ? Float.POSITIVE_INFINITY : 1f;
            transition.configure(scale, setting == 1, setting != 2);
            assertFalse(transition.enabled());
            assertFalse(transition.running());
            assertEquals(1f, transition.progress(), 0f);
            assertEquals(LyricLineTransition.Change.DIRECT,
                    transition.show(TIMELINE, 2, 1022, 1032, 1f, true, true));
        }
    }

    @Test public void movementIsBalancedAcrossBothHalvesAndSettlesExactly() {
        LyricLineTransition transition = transition();
        start(transition);
        assertTrue(transition.advance(1016 + 140));
        assertTrue(transition.progress() > .2f && transition.progress() < .35f);
        assertTrue(transition.advance(1016 + 210));
        assertEquals(.5f, transition.progress(), .0001f);
        assertTrue(transition.advance(1016 + 315));
        assertTrue(transition.progress() > .8f && transition.progress() < .9f);
        assertFalse(transition.advance(1016 + 420));
        assertEquals(1f, transition.progress(), 0f);
    }

    @Test public void movingTextFadesBeforeItReachesTheTrackEdges() {
        assertTrue(LyricLineTransition.outgoingOpacity(.35f) < .8f);
        assertTrue(LyricLineTransition.incomingOpacity(.35f) < .4f);
        assertTrue(LyricLineTransition.outgoingOpacity(.5f) > .3f);
        assertTrue(LyricLineTransition.incomingOpacity(.5f) > .4f);
        assertEquals(0f, LyricLineTransition.outgoingOpacity(.9f), 0f);
        assertEquals(0f, LyricLineTransition.incomingOpacity(0f), 0f);
        float previousOld = 1f, previousNew = 0f;
        for (int frame = 0; frame <= 100; frame++) {
            float progress = frame / 100f;
            float old = LyricLineTransition.outgoingOpacity(progress), incoming = LyricLineTransition.incomingOpacity(progress);
            assertTrue(old <= previousOld && incoming >= previousNew);
            assertTrue(old + incoming <= 1.01f);
            previousOld = old; previousNew = incoming;
        }
    }

    @Test public void fullMotionOverridesDisabledSystemAnimationsAndStaleLegacyFlags() {
        for (float scale : new float[]{0f, .5f, 1f, 10f, Float.NaN}) {
            LyricLineTransition transition = transition();
            transition.configure("full", scale, true, false);
            assertTrue(transition.enabled());
            assertEquals(420L, transition.durationMs());
            start(transition);
            assertTrue(transition.advance(1016 + 210));
            assertEquals(.5f, transition.progress(), .0001f);
        }
    }

    @Test public void systemMotionHonorsBothNativeAndShellAccessibilitySignals() {
        LyricLineTransition transition = transition();
        for (int disabled = 0; disabled < 3; disabled++) {
            transition.configure("system", disabled == 0 ? 0f : 1f, disabled == 1, disabled != 2);
            assertFalse(transition.enabled());
        }
        transition.configure("system", 2f, false, true);
        assertTrue(transition.enabled());
        assertEquals(840L, transition.durationMs());
    }

    @Test public void reducedPreferenceStopsAnActiveFullMotionTransitionEvenWithLegacyFalse() {
        LyricLineTransition transition = transition();
        transition.configure("full", 0f, false, false);
        start(transition);
        transition.configure("reduced", 1f, false, true);
        assertFalse(transition.running());
        assertFalse(transition.enabled());
        assertEquals(1f, transition.progress(), 0f);
    }

    @Test public void allRowsTravelTogetherEvenWhenSomeHaveTwoTextLines() {
        float[] rowTops = {0f, 60f, 95f};
        float trackHeight = 150f;
        for (int frame = 0; frame <= 100; frame++) {
            float progress = frame / 100f;
            float outgoing = LyricLineTransition.outgoingOffset(progress, trackHeight);
            float incoming = LyricLineTransition.incomingOffset(progress, trackHeight);
            assertEquals(trackHeight, incoming - outgoing, .0001f);
            for (int row = 1; row < rowTops.length; row++) {
                assertEquals(rowTops[row] - rowTops[0], rowTops[row] + outgoing - (rowTops[0] + outgoing), .0001f);
                assertEquals(rowTops[row] - rowTops[0], rowTops[row] + incoming - (rowTops[0] + incoming), .0001f);
            }
        }
        assertEquals(0f, LyricLineTransition.outgoingOffset(0f, trackHeight), 0f);
        assertEquals(0f, LyricLineTransition.incomingOffset(1f, trackHeight), 0f);
    }

    @Test public void pollingAndDisplayFramesShareOneTimelineWithoutRestartingIt() {
        LyricLineTransition transition = transition();
        start(transition);
        float previous = 0f;
        for (int elapsed = 16; elapsed < 420; elapsed += 16) {
            // All rows read this one frame value; neither metadata polling nor word progress resets it.
            assertEquals(LyricLineTransition.Change.NONE,
                    transition.show(TIMELINE, 1, 1006 + elapsed, 1016 + elapsed, 1f, false, true));
            assertTrue(transition.advance(1016 + elapsed));
            assertTrue(transition.progress() > previous);
            previous = transition.progress();
        }
        assertFalse(transition.advance(1436));
    }

    @Test public void firstLyricAfterLoadingOrAnIntroIsDirectThenNaturalBoundariesScroll() {
        LyricLineTransition transition = transition();
        assertEquals(LyricLineTransition.Change.DIRECT,
                transition.show(null, -1, 900, 1000, 1f, true, false));
        assertEquals(LyricLineTransition.Change.DIRECT,
                transition.show(TIMELINE, -1, 920, 1020, 1f, false, true));
        assertEquals(LyricLineTransition.Change.DIRECT,
                transition.show(TIMELINE, 0, 1000, 1100, 1f, true, true));
        assertEquals(LyricLineTransition.Change.SCROLL,
                transition.show(TIMELINE, 1, 1100, 1200, 1f, true, true));
    }

    @Test public void restoringAHiddenWindowAndReplacingLyricsNeverScrollStaleText() {
        LyricLineTransition transition = transition();
        start(transition);
        transition.reset();
        assertFalse(transition.running());
        assertEquals(LyricLineTransition.Change.DIRECT,
                transition.show(TIMELINE, 2, 2000, 2010, 1f, true, true));
        assertEquals(LyricLineTransition.Change.DIRECT,
                transition.show(new Object(), 3, 2100, 2110, 1f, true, true));
        assertEquals(1f, transition.progress(), 0f);
    }

    @Test public void forwardAndBackwardSeeksDuringAScrollDiscardTheOutgoingSentence() {
        for (int nextIndex : new int[]{0, 2, 12}) {
            LyricLineTransition transition = transition();
            start(transition);
            transition.advance(1100);
            assertEquals(LyricLineTransition.Change.DIRECT,
                    transition.show(TIMELINE, nextIndex, nextIndex * 3000, 1116, 1f, true, true));
            assertFalse(transition.running());
            assertEquals(1f, transition.progress(), 0f);
        }
    }

    @Test public void seekingWithinTheCurrentLineAlsoClearsTheActiveScroll() {
        LyricLineTransition transition = transition();
        start(transition);
        assertEquals(LyricLineTransition.Change.DIRECT,
                transition.show(TIMELINE, 1, 5000, 1032, 1f, false, true));
        assertFalse(transition.running());
    }

    @Test public void rapidAdjacentLinesReplaceRatherThanStackTransitions() {
        LyricLineTransition transition = transition();
        start(transition);
        transition.advance(1116);
        assertEquals(LyricLineTransition.Change.SCROLL,
                transition.show(TIMELINE, 2, 1106, 1116, 1f, true, true));
        assertEquals(0f, transition.progress(), 0f);
        assertTrue(transition.advance(1116 + 210));
        assertEquals(.5f, transition.progress(), .0001f);
    }

    @Test public void pausedOrStalledFramesDisplayTheCurrentSentenceDirectly() {
        LyricLineTransition transition = transition();
        start(transition);
        assertEquals(LyricLineTransition.Change.DIRECT,
                transition.show(TIMELINE, 1, 1010, 1020, 1f, false, false));
        assertFalse(transition.running());
        assertEquals(LyricLineTransition.Change.DIRECT,
                transition.show(TIMELINE, 2, 2010, 2020, 1f, true, true));
    }

    @Test public void translationOrPreviewEditsWithinTheSameLineDoNotInventALineAdvance() {
        LyricLineTransition transition = transition();
        start(transition);
        assertEquals(LyricLineTransition.Change.DIRECT,
                transition.show(TIMELINE, 1, 1022, 1032, 1f, true, true));
        assertFalse(transition.running());
        assertEquals(LyricLineTransition.Change.SCROLL,
                transition.show(TIMELINE, 2, 1038, 1048, 1f, false, true));
    }

    @Test public void blankInstrumentalRowsAndTheFollowingLyricKeepTitleFallbackDirect() {
        LyricLineTransition transition = transition();
        start(transition);
        assertEquals(LyricLineTransition.Change.DIRECT,
                transition.show(TIMELINE, -1, 1022, 1032, 1f, true, true));
        assertEquals(LyricLineTransition.Change.DIRECT,
                transition.show(TIMELINE, 3, 1038, 1048, 1f, true, true));
    }

    @Test public void projectedPlaybackSpeedAndOffsetChangesAreHandledSeparately() {
        LyricLineTransition transition = transition();
        LyricFrameClock clock = new LyricFrameClock();
        clock.update(1, 800, 1000, true, 10000, 1000, 2f);
        transition.show(TIMELINE, 0, clock.positionAt(1000), 1000, 2f, true, true);
        assertEquals(LyricLineTransition.Change.SCROLL,
                transition.show(TIMELINE, 1, clock.positionAt(1200), 1200, 2f, true, true));
        assertEquals(LyricLineTransition.Change.DIRECT,
                transition.show(TIMELINE, 2, clock.positionAt(1216) + 2000, 1216, 2f, true, true));
    }
}
