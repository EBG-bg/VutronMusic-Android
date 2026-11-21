package io.github.vutronmusic.personal;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class ArtworkCacheAdmissionTest {
    @Test public void lastFittingCoverDoesNotOpenRoomForAnother() {
        assertTrue(ArtworkCache.fits(96, 10, 128, 32));
        assertFalse(ArtworkCache.fits(96, 10, 128, 33));
        assertFalse(ArtworkCache.fits(128, 11, 128, 1));
        assertTrue(ArtworkCache.fits(128, 11, 160, 32));
    }

    @Test public void fileCountAndByteLimitsAreIndependent() {
        assertTrue(ArtworkCache.fits(50, 4095, 128, 1));
        assertFalse(ArtworkCache.fits(50, 4096, 128, 1));
        assertFalse(ArtworkCache.fits(129, 1, 128, 0));
    }
}
