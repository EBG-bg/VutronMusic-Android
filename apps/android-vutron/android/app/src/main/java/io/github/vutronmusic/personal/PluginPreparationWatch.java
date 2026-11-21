package io.github.vutronmusic.personal;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.function.Consumer;
import java.util.function.Supplier;

/** Owns one relay wait; only the playback thread starts, cancels or delivers it. */
final class PluginPreparationWatch implements AutoCloseable {
    private final ExecutorService worker;
    private final Consumer<Runnable> post;
    private Attempt current;

    PluginPreparationWatch(ExecutorService worker, Consumer<Runnable> post) {
        this.worker = worker;
        this.post = post;
    }

    /** closeWait must unblock the wait without blocking the playback thread. */
    void start(Supplier<String> awaitFailure, Runnable closeWait, Consumer<String> onFailure) {
        cancel();
        Attempt attempt = new Attempt(closeWait);
        current = attempt;
        attempt.task = worker.submit(() -> {
            String failure = awaitFailure.get();
            if (failure.isEmpty() || attempt.cancelled) return;
            post.accept(() -> {
                if (current != attempt) return;
                current = null;
                attempt.closeWait.run();
                onFailure.accept(failure);
            });
        });
    }

    void cancel() {
        Attempt previous = current;
        current = null;
        if (previous != null) previous.cancel();
    }

    @Override public void close() {
        cancel();
        worker.shutdownNow();
    }

    private static final class Attempt {
        final Runnable closeWait;
        volatile boolean cancelled;
        Future<?> task;

        Attempt(Runnable closeWait) { this.closeWait = closeWait; }

        void cancel() {
            cancelled = true;
            task.cancel(true);
            closeWait.run();
        }
    }
}
