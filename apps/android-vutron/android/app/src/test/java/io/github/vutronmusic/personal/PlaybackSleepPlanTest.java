package io.github.vutronmusic.personal;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class PlaybackSleepPlanTest {
    @Test public void legacyDeadlineAndNewRoundTripKeepWallClockExpiry() throws Exception {
        PlaybackSleepPlan legacy=PlaybackSleepPlan.read(null,8000);
        assertTrue(legacy.active());assertEquals(3000,legacy.remainingMs(5000));assertTrue(legacy.expires(8000));
        PlaybackSleepPlan plan=PlaybackSleepPlan.create("duration",10000,0,5,2000,"",false);
        PlaybackSleepPlan loaded=PlaybackSleepPlan.read(plan.json(4000),0);
        assertEquals(plan.deadline,loaded.deadline);assertEquals(8000,loaded.remainingMs(4000));assertFalse(loaded.expires(11999));
        assertTrue(loaded.expires(12000));assertEquals(0,loaded.remainingMs(13000));
    }
    @Test public void shortTimerDoesNotDropToAThirdAtTheStartOfLongRequestedFade(){
        PlaybackSleepPlan plan=PlaybackSleepPlan.create("duration",10000,0,30,2000,"",false);
        assertEquals(10000,plan.fadeWindowMs);assertEquals(1f,plan.gain(2000,0,0),0);
        assertEquals(.5f,plan.gain(7000,0,0),.0001f);assertEquals(0f,plan.gain(12000,0,0),0);
    }
    @Test public void naturalCompletionDecrementsAndManualTrackSelectionDoesNot(){
        PlaybackSleepPlan plan=PlaybackSleepPlan.create("count",0,3,5,0,"recording-one",false);
        assertSame(plan,plan.onTrack("other-recording"));assertEquals(3,plan.remainingTracks);
        plan=plan.completed();assertEquals(2,plan.remainingTracks);assertEquals(1f,plan.gain(0,100,5000),0);
        plan=plan.completed();assertTrue(plan.finalTrack());assertEquals(.5f,plan.gain(0,2500,5000),.0001f);
        assertFalse(plan.completed().active());
    }
    @Test public void currentTrackTimerCancelsOnDifferentRecordingButRetainsSameIdentity(){
        PlaybackSleepPlan plan=PlaybackSleepPlan.create("track",0,0,15,0,"cue:first",false);
        assertSame(plan,plan.onTrack("cue:first"));assertFalse(plan.onTrack("cue:second").active());
        assertFalse(plan.completed().json(0).optBoolean("active"));
    }
    @Test public void onlySongBoundaryModesConflictWithAbAndInputsAreBounded(){
        assertTrue(PlaybackSleepPlan.create("duration",1000,0,0,0,"",true).active());
        for(String mode:new String[]{"track","count"})assertThrows(IllegalArgumentException.class,()->PlaybackSleepPlan.create(mode,1000,1,0,0,"song",true));
        assertThrows(IllegalArgumentException.class,()->PlaybackSleepPlan.create("count",0,0,0,0,"song",false));
        assertThrows(IllegalArgumentException.class,()->PlaybackSleepPlan.create("count",0,101,0,0,"song",false));
        assertThrows(IllegalArgumentException.class,()->PlaybackSleepPlan.create("track",0,1,0,0,"",false));
        assertThrows(IllegalArgumentException.class,()->PlaybackSleepPlan.create("duration",999,0,0,0,"",false));
        assertThrows(IllegalArgumentException.class,()->PlaybackSleepPlan.create("duration",1000,0,3,0,"",false));
    }
    @Test public void malformedPersistenceDoesNotArmAnUnknownMode() throws Exception {
        assertFalse(PlaybackSleepPlan.read(new JSONObject().put("mode","other").put("remainingTracks",1),0).active());
        assertFalse(PlaybackSleepPlan.read(new JSONObject().put("mode","track").put("remainingTracks",1),0).active());
    }
}
