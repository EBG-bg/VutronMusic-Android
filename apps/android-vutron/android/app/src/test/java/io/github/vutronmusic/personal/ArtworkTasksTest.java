package io.github.vutronmusic.personal;

import org.junit.Test;
import java.util.ArrayDeque;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

public class ArtworkTasksTest {
    private static final class Lane implements Executor {
        final ArrayDeque<Runnable> tasks = new ArrayDeque<>();
        @Override public void execute(Runnable task) { tasks.add(task); }
        void drain() { while (!tasks.isEmpty()) tasks.remove().run(); }
    }
    @Test public void visibleImageDoesNotWaitForBackgroundBacklog() {
        Lane visible = new Lane(), background = new Lane();
        ArtworkTasks queue = new ArtworkTasks(visible, background);
        AtomicInteger downloads = new AtomicInteger(), preloads = new AtomicInteger();
        for (int i = 0; i < 100; i++) queue.submit(preloads::incrementAndGet, false);
        queue.submit(downloads::incrementAndGet, true);
        visible.drain();
        assertEquals(1, downloads.get());
        assertEquals(0, preloads.get());
        background.drain();
        assertEquals(100, preloads.get());
    }
    @Test public void promotionExecutesAQueuedUrlOnlyOnce() {
        Lane visible = new Lane(), background = new Lane();
        ArtworkTasks queue = new ArtworkTasks(visible, background);
        AtomicInteger count = new AtomicInteger();
        ArtworkTasks.Task task = queue.submit(count::incrementAndGet, false);
        task.promote(); task.promote();
        assertEquals(1, visible.tasks.size());
        visible.drain(); background.drain();
        assertEquals(1, count.get());
    }
    @Test public void anAlreadyRunningDownloadIsNotDuplicated() {
        Lane visible = new Lane(), background = new Lane();
        ArtworkTasks queue = new ArtworkTasks(visible, background);
        AtomicInteger count = new AtomicInteger();
        ArtworkTasks.Task task = queue.submit(count::incrementAndGet, false);
        background.drain(); task.promote(); visible.drain();
        assertEquals(1, count.get());
    }
}
