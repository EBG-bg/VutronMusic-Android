package io.github.vutronmusic.personal;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import java.io.IOException;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.net.URL;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;

/** Shared effective connectivity, including failures the system has not detected yet. */
final class MusicConnectivity implements AutoCloseable {
    private static final Object LOCK = new Object();
    private static final Set<Runnable> LISTENERS = new CopyOnWriteArraySet<>();
    private static final class MainThread { static final Handler HANDLER = new Handler(Looper.getMainLooper()); }
    private static final long COOLDOWN_MS = 30_000L;
    private static final int PROBE_TIMEOUT_MS = 3_000;
    private static final ThreadPoolExecutor PROBES = new ThreadPoolExecutor(0, 1, 30, TimeUnit.SECONDS,
            new SynchronousQueue<>(), task -> { Thread thread = new Thread(task, "MusicConnectivityProbe"); thread.setDaemon(true); return thread; });
    private static final ScheduledExecutorService DEADLINES = Executors.newSingleThreadScheduledExecutor(task -> {
        Thread thread = new Thread(task, "MusicConnectivityDeadline"); thread.setDaemon(true); return thread;
    });
    private static ConnectivityManager registeredManager;
    private static ConnectivityManager.NetworkCallback callback;
    private static Network observedNetwork, provenNetwork;
    private static boolean validated, unreachable;
    private static long revision, lastAttempt;
    private static CompletableFuture<Boolean> probe;
    private static Request probeRequest;
    private final Runnable listener;

    MusicConnectivity(Context context, Runnable changed) {
        listener = changed;
        Context app = context.getApplicationContext();
        synchronized (LOCK) {
            if (registeredManager == null) {
                ConnectivityManager manager = app.getSystemService(ConnectivityManager.class);
                if (manager != null) {
                    Network active = manager.getActiveNetwork();
                    if (!Objects.equals(active, observedNetwork)) reset(active);
                    NetworkCapabilities caps = manager.getNetworkCapabilities(active);
                    validated = caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
                    callback = new ConnectivityManager.NetworkCallback() {
                        @Override public void onAvailable(Network network) {
                            if (Build.VERSION.SDK_INT < 24) { refreshLegacyNetwork(app, manager); return; }
                            synchronized (LOCK) { if (!network.equals(observedNetwork)) reset(network); }
                            notifyChanged(app);
                        }
                        @Override public void onLost(Network network) {
                            if (Build.VERSION.SDK_INT < 24) { refreshLegacyNetwork(app, manager); return; }
                            synchronized (LOCK) { if (network.equals(observedNetwork)) reset(null); }
                            notifyChanged(app);
                        }
                        @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) {
                            if (Build.VERSION.SDK_INT < 24) { refreshLegacyNetwork(app, manager); return; }
                            synchronized (LOCK) {
                                if (!network.equals(observedNetwork)) return;
                                boolean fresh = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
                                if (fresh && !validated) { unreachable = false; provenNetwork = null; revision++; }
                                validated = fresh;
                            }
                            notifyChanged(app);
                        }
                    };
                    if (Build.VERSION.SDK_INT >= 24) manager.registerDefaultNetworkCallback(callback);
                    else manager.registerNetworkCallback(new NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(), callback);
                    registeredManager = manager;
                }
            }
            LISTENERS.add(changed);
        }
    }

    private static void reset(Network network) {
        observedNetwork = network; provenNetwork = null; validated = false;
        unreachable = false; lastAttempt = 0; revision++;
    }

    // API 23 reports every matching network, including a non-default cellular network.
    private static void refreshLegacyNetwork(Context context, ConnectivityManager manager) {
        MainThread.HANDLER.post(() -> {
            synchronized (LOCK) {
                Network active = manager.getActiveNetwork();
                if (!Objects.equals(active, observedNetwork)) reset(active);
                NetworkCapabilities caps = manager.getNetworkCapabilities(active);
                boolean fresh = caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
                if (fresh && !validated) { unreachable = false; provenNetwork = null; revision++; }
                validated = fresh;
            }
            notifyChanged(context);
        });
    }

    private static void notifyChanged(Context context) {
        MainThread.HANDLER.post(() -> {
            try { LocalOnlyMode.updateConnectivity(context, available(context)); }
            catch (IOException failure) { Log.w("VutronNetwork", "Cannot persist effective connectivity", failure); }
            for (Runnable listener : LISTENERS) listener.run();
        });
    }

    static boolean available(Context context) {
        ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
        if (manager == null) return false;
        Network network = manager.getActiveNetwork();
        NetworkCapabilities caps = manager.getNetworkCapabilities(network);
        if (caps == null || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return false;
        synchronized (LOCK) {
            return !unreachable && (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) || network.equals(provenNetwork));
        }
    }

    static boolean unreachable() { synchronized (LOCK) { return unreachable; } }
    static String reason(Context context) {
        if (available(context)) return "";
        ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
        NetworkCapabilities caps = manager == null ? null : manager.getNetworkCapabilities(manager.getActiveNetwork());
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) && unreachable() ? "unreachable" : "system";
    }
    static boolean usable(boolean internet, boolean validated) { return internet && validated; }
    static boolean wifi(Context context) {
        if (!available(context)) return false;
        ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
        NetworkCapabilities caps = manager == null ? null : manager.getNetworkCapabilities(manager.getActiveNetwork());
        return caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
    }

    record Request(Network network, long revision) { }
    static Request capture(Context context) {
        ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
        synchronized (LOCK) { return new Request(manager == null ? null : manager.getActiveNetwork(), revision); }
    }
    private static boolean current(Context context, Request request) {
        ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
        return request != null && request.revision == revision && manager != null && Objects.equals(request.network, manager.getActiveNetwork());
    }

    static boolean reportUnreachable(Context context, Throwable failure, Request request) {
        if (Thread.currentThread().isInterrupted() || !isUnreachable(failure)) return false;
        return reportUnreachable(context, request);
    }
    static boolean reportUnreachable(Context context, Request request) {
        synchronized (LOCK) {
            if (!current(context, request)) return false;
            unreachable = true; provenNetwork = null; lastAttempt = SystemClock.elapsedRealtime(); revision++;
        }
        notifyChanged(context.getApplicationContext());
        return true;
    }

    static boolean isUnreachable(Throwable failure) {
        ArrayDeque<Throwable> pending = new ArrayDeque<>();
        Set<Throwable> seen = Collections.newSetFromMap(new IdentityHashMap<>());
        if (failure != null) pending.add(failure);
        while (!pending.isEmpty() && seen.size() < 16) {
            Throwable next = pending.removeFirst();
            if (!seen.add(next)) continue;
            if (next instanceof EmbeddedSources.LocalTransportFailure) continue;
            if (next instanceof SocketTimeoutException || next instanceof UnknownHostException
                    || next instanceof ConnectException || next instanceof NoRouteToHostException) return true;
            if (next instanceof android.system.ErrnoException errno && (errno.errno == android.system.OsConstants.ENETUNREACH
                    || errno.errno == android.system.OsConstants.EHOSTUNREACH || errno.errno == android.system.OsConstants.ENETDOWN
                    || errno.errno == android.system.OsConstants.ETIMEDOUT)) return true;
            if (next instanceof AndroidPluginManager.PluginFailure plugin && Set.of("ETIMEDOUT", "ESOCKETTIMEDOUT", "ECONNABORTED",
                    "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH").contains(plugin.code)) return true;
            if (next.getCause() != null) pending.add(next.getCause());
            Collections.addAll(pending, next.getSuppressed());
        }
        return false;
    }

    static NeteaseApi netease(Context context, String cookie) { return netease(context, cookie, () -> true); }
    static NeteaseApi netease(Context context, String cookie, BooleanSupplier allowed) {
        Context app = context.getApplicationContext();
        return new NeteaseApi(cookie, () -> !unreachable() && allowed.getAsBoolean()).observeNetwork(() -> {
            Request request = capture(app);
            return failure -> reportUnreachable(app, failure, request);
        });
    }

    static void onForeground(Context context) {
        if (LocalOnlyMode.manual(context)) return;
        synchronized (LOCK) {
            if (!unreachable || SystemClock.elapsedRealtime() - lastAttempt < COOLDOWN_MS) return;
        }
        retryConnectivity(context);
    }

    /** Bounded HEAD without session/cookie. The whole operation, including DNS, has a 3s deadline. */
    static CompletableFuture<Boolean> retryConnectivity(Context context) {
        Context app = context.getApplicationContext();
        final CompletableFuture<Boolean> result;
        final Request request;
        synchronized (LOCK) {
            request = capture(app);
            if (probe != null && !probe.isDone() && request.equals(probeRequest)) return probe;
            if (request.network == null) return CompletableFuture.completedFuture(false);
            lastAttempt = SystemClock.elapsedRealtime();
            result = new CompletableFuture<>(); probe = result; probeRequest = request;
        }
        AtomicReference<HttpURLConnection> connection = new AtomicReference<>();
        var deadline = DEADLINES.schedule(() -> {
            finishProbe(app, request, result, false);
            HttpURLConnection opened = connection.getAndSet(null);
            if (opened != null) opened.disconnect();
        }, PROBE_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        try {
            var running = PROBES.submit(() -> {
                HttpURLConnection opened = null;
                try {
                    if (result.isDone()) return;
                    opened = (HttpURLConnection) new URL("https://music.163.com/").openConnection();
                    connection.set(opened);
                    opened.setRequestMethod("HEAD"); opened.setInstanceFollowRedirects(false); opened.setUseCaches(false);
                    opened.setConnectTimeout(PROBE_TIMEOUT_MS); opened.setReadTimeout(PROBE_TIMEOUT_MS);
                    if (result.isDone()) return;
                    int status = opened.getResponseCode();
                    finishProbe(app, request, result, status >= 200 && status < 600);
                } catch (IOException failure) { finishProbe(app, request, result, false); }
                finally {
                    connection.compareAndSet(opened, null);
                    if (opened != null) opened.disconnect();
                }
            });
            result.whenComplete((value, failure) -> { deadline.cancel(false); if (!running.isDone()) running.cancel(true); });
        } catch (java.util.concurrent.RejectedExecutionException busy) {
            deadline.cancel(false);
            // A timed-out DNS lookup may still be unwinding; it is not evidence of an outage.
            result.completeExceptionally(new IOException("网络检查仍在结束，请稍后再试", busy));
        }
        return result;
    }

    private static void finishProbe(Context context, Request request, CompletableFuture<Boolean> result, boolean success) {
        synchronized (result) {
            if (result.isDone()) return;
            synchronized (LOCK) {
                if (current(context, request)) {
                    unreachable = !success; provenNetwork = success ? request.network : null; revision++;
                }
            }
            notifyChanged(context);
            result.complete(available(context));
        }
    }

    @Override public void close() {
        synchronized (LOCK) {
            LISTENERS.remove(listener);
            if (LISTENERS.isEmpty() && registeredManager != null) {
                registeredManager.unregisterNetworkCallback(callback); registeredManager = null; callback = null;
            }
        }
    }
}
