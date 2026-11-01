package io.github.vutronmusic.personal;
import org.junit.Test;
import static org.junit.Assert.*;
public class LyricVisibilityTest {
    @Test public void thirtySecondNotificationHideResumesWithoutChangingPlayback() {
        LyricVisibility policy=new LyricVisibility();long wall=100000,hidden=wall+LyricVisibility.TEMPORARY_HIDE_MS;
        assertEquals(30000,LyricVisibility.TEMPORARY_HIDE_MS);
        assertFalse(policy.visible(true,false,true,0,wall,hidden));
        assertFalse(policy.visible(true,false,true,29999,wall+29999,hidden));
        assertTrue(policy.visible(true,false,true,30000,wall+30000,hidden));
    }
    @Test public void expiredTemporaryHideDoesNotReshowLyricsForPausedOrAbsentAudio() {
        LyricVisibility policy=new LyricVisibility();
        assertFalse(policy.visible(false,false,true,0,1000,31000));
        assertFalse(policy.visible(false,false,true,30000,31000,31000));
        assertFalse(policy.visible(true,false,false,30000,31000,31000));
    }
}
