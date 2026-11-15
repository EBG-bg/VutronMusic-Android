package io.github.vutronmusic.personal;

import org.junit.Test;
import static org.junit.Assert.*;

public class PlaybackAbLoopTest {
    private PlaybackAbLoop track(){return PlaybackAbLoop.empty().forTrack("recording-one",1,30000);}
    @Test public void zeroStartIsLegalAndMissingMarkersAreDistinct() {
        PlaybackAbLoop state=track();assertEquals(-1,state.startMs);assertEquals(-1,state.endMs);
        state=state.update(state.trackKey,false,0L,null,false,false);assertEquals(0,state.startMs);assertEquals(-1,state.endMs);
        assertFalse(state.enabled);assertThrows(IllegalArgumentException.class,()->track().update("recording-one",false,0L,null,true,false));
    }
    @Test public void rangeChecksHalfSecondAndFullDurationEnd(){
        PlaybackAbLoop state=track().update("recording-one",false,0L,30000L,true,false);
        assertTrue(state.atEnd(30000));assertFalse(state.atEnd(29999));assertEquals(29999,state.boundedSeek(30000));
        assertThrows(IllegalArgumentException.class,()->track().update("recording-one",false,100L,599L,true,false));
        assertTrue(track().update("recording-one",false,100L,600L,true,false).enabled);
        assertThrows(IllegalArgumentException.class,()->track().update("recording-one",false,0L,30001L,false,false));
    }
    @Test public void staleRecordingAndUnknownLengthCannotAcceptRequests(){
        assertThrows(IllegalArgumentException.class,()->track().update("other",false,0L,2000L,true,false));
        assertThrows(IllegalArgumentException.class,()->PlaybackAbLoop.empty().update("",false,0L,2000L,true,false));
        PlaybackAbLoop enabled=track().update("recording-one",false,1000L,2000L,true,false);
        assertFalse(enabled.forTrack("other",2,30000).enabled);assertEquals(-1,enabled.forTrack("other",2,30000).startMs);
    }
    @Test public void loopSeekRemainsRelativeAndDoesNotChangeRangeOrRecording(){
        PlaybackAbLoop state=track().update("recording-one",false,1000L,2000L,true,false);
        assertEquals(1000,state.boundedSeek(0));assertEquals(1500,state.boundedSeek(1500));assertEquals(1999,state.boundedSeek(8000));
        assertEquals(1000,state.startMs);assertEquals(2000,state.endMs);assertEquals("recording-one",state.trackKey);
        assertFalse(state.update("recording-one",true,null,null,null,true).enabled);
    }
    @Test public void songTimerConflictOnlyBlocksEnablingNotEditingOrClearing(){
        assertThrows(IllegalArgumentException.class,()->track().update("recording-one",false,0L,1000L,true,true));
        assertFalse(track().update("recording-one",false,0L,1000L,false,true).enabled);
        assertFalse(track().update("recording-one",true,null,null,null,true).enabled);
    }
}
