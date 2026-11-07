package io.github.vutronmusic.personal;

import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Visible images have reserved workers; queued preloads can be promoted. */
final class ArtworkTasks {
    private final Executor visible;
    private final Executor background;
    ArtworkTasks(Executor visible, Executor background) { this.visible = visible; this.background = background; }
    static ArtworkTasks create() {
        return new ArtworkTasks(Executors.newFixedThreadPool(2, action -> daemon(action, "visible")),
                Executors.newSingleThreadExecutor(action -> daemon(action, "preload")));
    }
    private static Thread daemon(Runnable action, String kind) {
        Thread thread = new Thread(action, "vutron-artwork-" + kind);
        thread.setDaemon(true);
        return thread;
    }
    final class Task implements Runnable {
        private final Runnable action;
        private final AtomicBoolean started = new AtomicBoolean();
        private final AtomicBoolean promoted;
        Task(Runnable action, boolean foreground) { this.action = action; this.promoted = new AtomicBoolean(foreground); }
        void promote() { if (!started.get() && promoted.compareAndSet(false, true)) visible.execute(this); }
        @Override public void run() { if (started.compareAndSet(false, true)) action.run(); }
    }
    Task submit(Runnable action, boolean foreground) {
        Task task = new Task(action, foreground);
        (foreground ? visible : background).execute(task);
        return task;
    }
}
