package io.github.vutronmusic.personal;

import org.json.JSONObject;
import org.junit.Test;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

public class LyricPrewarmTest {
    private static LyricRepository.Lyrics lyrics(String text) throws Exception {
        return new LyricRepository.Lyrics(new JSONObject().put("lrc", "[00:01]" + text));
    }

    @Test public void foregroundSharesLivePrewarmButAnotherSessionDoesNot() throws Exception {
        LyricRepository.Lyrics prefetched = lyrics("Shared"), other = lyrics("Another account");
        ExecutorService workers = Executors.newFixedThreadPool(2);
        CountDownLatch loading = new CountDownLatch(1), joining = new CountDownLatch(1), finish = new CountDownLatch(1);
        try {
            Future<LyricRepository.Lyrics> warm = workers.submit(() -> LyricRepository.shareLoad(301L, "one", () -> {
                joining.countDown(); return true;
            }, true, () -> {
                loading.countDown(); assertTrue(finish.await(5, TimeUnit.SECONDS)); return prefetched;
            }));
            assertTrue(loading.await(5, TimeUnit.SECONDS));
            Future<LyricRepository.Lyrics> current = workers.submit(() -> LyricRepository.shareLoad(301L, "one", () -> true,
                    false, () -> { fail("Foreground should reuse ongoing prewarm"); return null; }));
            assertTrue(joining.await(5, TimeUnit.SECONDS));
            assertSame(other, LyricRepository.shareLoad(301L, "two", () -> true, false, () -> other));
            finish.countDown();
            assertSame(prefetched, warm.get(5, TimeUnit.SECONDS));
            assertSame(prefetched, current.get(5, TimeUnit.SECONDS));
        } finally { finish.countDown(); workers.shutdownNow(); }
    }

    @Test public void policyCancellationLetsForegroundLoadBeforeAbandonedTransportReturns() throws Exception {
        LyricRepository.Lyrics expected = lyrics("Current");
        AtomicBoolean allowed = new AtomicBoolean(true);
        AtomicInteger normalRequests = new AtomicInteger();
        ExecutorService workers = Executors.newFixedThreadPool(2);
        CountDownLatch loading = new CountDownLatch(1), cancelled = new CountDownLatch(1), finish = new CountDownLatch(1);
        try {
            workers.submit(() -> LyricRepository.shareLoad(302L, "one", allowed::get, true, () -> {
                loading.countDown();
                // A socket read can outlive an interrupt; it must not hold up playback.
                while (finish.getCount() > 0) try { finish.await(); }
                catch (InterruptedException interrupted) { cancelled.countDown(); }
                return lyrics("Abandoned");
            }));
            assertTrue(loading.await(5, TimeUnit.SECONDS));
            allowed.set(false);
            Future<LyricRepository.Lyrics> current = workers.submit(() -> LyricRepository.shareLoad(302L, "one", () -> true, false, () -> {
                normalRequests.incrementAndGet(); return expected;
            }));
            assertSame(expected, current.get(5, TimeUnit.SECONDS));
            assertTrue(cancelled.await(5, TimeUnit.SECONDS));
            assertEquals(1, normalRequests.get());
        } finally { finish.countDown(); workers.shutdownNow(); }
    }

    @Test public void speculativeCallerSkipsExistingForegroundWork() throws Exception {
        ExecutorService worker = Executors.newSingleThreadExecutor();
        CountDownLatch loading = new CountDownLatch(1), finish = new CountDownLatch(1);
        LyricRepository.Lyrics normal = lyrics("Current");
        try {
            Future<LyricRepository.Lyrics> current = worker.submit(() -> LyricRepository.shareLoad(303L, "one", () -> true,
                    false, () -> { loading.countDown(); assertTrue(finish.await(5, TimeUnit.SECONDS)); return normal; }));
            assertTrue(loading.await(5, TimeUnit.SECONDS));
            assertNull(LyricRepository.shareLoad(303L, "one", () -> true, true,
                    () -> { fail("Do not make a second request"); return null; }));
            finish.countDown();
            assertSame(normal, current.get(5, TimeUnit.SECONDS));
        } finally { finish.countDown(); worker.shutdownNow(); }
    }
}
