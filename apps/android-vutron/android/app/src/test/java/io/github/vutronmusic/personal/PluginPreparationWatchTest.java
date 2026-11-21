package io.github.vutronmusic.personal;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.AbstractExecutorService;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
import static org.junit.Assert.*;

public class PluginPreparationWatchTest {
    @Test public void oneExplicitFailureIsDeliveredOnlyOnce() {
        ManualWorker worker = new ManualWorker();
        ArrayDeque<Runnable> playback = new ArrayDeque<>();
        List<String> switches = new ArrayList<>();
        try (PluginPreparationWatch watch = new PluginPreparationWatch(worker, playback::add)) {
            watch.start(() -> "relay=failed, address", () -> {}, switches::add);
            worker.runNext();
            assertTrue(switches.isEmpty()); // The worker cannot switch the player.
            Runnable pending = playback.remove();
            pending.run();
            pending.run();
            assertEquals(List.of("relay=failed, address"), switches);
        }
    }

    @Test public void cancelledOrReplacedPreparationDropsAnAlreadyQueuedFailure() {
        ManualWorker worker = new ManualWorker();
        ArrayDeque<Runnable> playback = new ArrayDeque<>();
        List<String> switches = new ArrayList<>();
        try (PluginPreparationWatch watch = new PluginPreparationWatch(worker, playback::add)) {
            watch.start(() -> "old attempt", () -> {}, switches::add);
            worker.runNext();
            watch.cancel(); // MediaPlayer won the race or playback was paused.
            watch.start(() -> "new attempt", () -> {}, switches::add);
            worker.runNext();
            playback.remove().run();
            assertTrue(switches.isEmpty());
            playback.remove().run();
            assertEquals(List.of("new attempt"), switches);
        }
    }

    @Test public void aSlowOrSuccessfulRelayNeverForcesSwitchOrPollsAgain() {
        ManualWorker worker = new ManualWorker();
        ArrayDeque<Runnable> playback = new ArrayDeque<>();
        AtomicInteger reads = new AtomicInteger();
        try (PluginPreparationWatch watch = new PluginPreparationWatch(worker, playback::add)) {
            watch.start(() -> { reads.incrementAndGet(); return ""; }, () -> {}, failure -> fail(failure));
            worker.runNext();
            assertEquals(1, reads.get());
            assertTrue(playback.isEmpty());
            assertTrue(worker.tasks.isEmpty());
        }
    }

    @Test public void closingTheWaitUnblocksTheNextAttempt() throws Exception {
        CountDownLatch connected = new CountDownLatch(1), disconnected = new CountDownLatch(1), next = new CountDownLatch(1);
        AtomicInteger posted = new AtomicInteger();
        try (PluginPreparationWatch watch = new PluginPreparationWatch(Executors.newSingleThreadExecutor(), action -> posted.incrementAndGet())) {
            watch.start(() -> {
                connected.countDown();
                // Model a reader that only unblocks on disconnect, not interrupt alone.
                long expiry = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
                while (System.nanoTime() < expiry && disconnected.getCount() != 0) {
                    try { disconnected.await(Math.max(0, expiry - System.nanoTime()), TimeUnit.NANOSECONDS); }
                    catch (InterruptedException cancelled) { }
                }
                return "cancelled response";
            }, disconnected::countDown, failure -> fail(failure));
            assertTrue(connected.await(2, TimeUnit.SECONDS));
            watch.cancel();
            assertEquals(0, disconnected.getCount());
            watch.start(() -> { next.countDown(); return ""; }, () -> {}, failure -> fail(failure));
            assertTrue(next.await(2, TimeUnit.SECONDS));
            assertEquals(0, posted.get());
        }
    }

    private static final class ManualWorker extends AbstractExecutorService {
        final ArrayDeque<Runnable> tasks = new ArrayDeque<>();
        private boolean stopped;
        void runNext() { tasks.remove().run(); }
        @Override public void execute(Runnable action) { tasks.add(action); }
        @Override public void shutdown() { stopped = true; }
        @Override public List<Runnable> shutdownNow() { shutdown(); return List.copyOf(tasks); }
        @Override public boolean isShutdown() { return stopped; }
        @Override public boolean isTerminated() { return stopped && tasks.isEmpty(); }
        @Override public boolean awaitTermination(long wait, TimeUnit unit) { return isTerminated(); }
    }
}
