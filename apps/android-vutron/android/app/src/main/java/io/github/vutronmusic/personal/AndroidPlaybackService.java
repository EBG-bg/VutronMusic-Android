package io.github.vutronmusic.personal;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.BroadcastReceiver;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.MediaPlayer;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;
import org.json.JSONArray;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.io.File;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/** Android platform adapter for media playback while the Vue WebView is backgrounded. */
public final class AndroidPlaybackService extends Service {
    static final String ACTION_PLAY = "io.github.vutronmusic.personal.webshell.PLAY";
    static final String ACTION_PAUSE = "io.github.vutronmusic.personal.webshell.PAUSE";
    static final String ACTION_RESUME = "io.github.vutronmusic.personal.webshell.RESUME";
    static final String ACTION_STOP = "io.github.vutronmusic.personal.webshell.STOP";
    static final String ACTION_QUEUE = "io.github.vutronmusic.personal.webshell.QUEUE";
    static final String ACTION_NEXT = "io.github.vutronmusic.personal.webshell.NEXT";
    static final String ACTION_PREVIOUS = "io.github.vutronmusic.personal.webshell.PREVIOUS";
    private static final String ACTION_TIMER_WAKE = "io.github.vutronmusic.personal.webshell.TIMER_WAKE";
    private static final String CHANNEL = "vutron_android_playback";
    private static final String PLAYBACK_PREFS = "vutron_playback";
    private static final String LAST_TRACK_ID = "lastTrackId";
    private static final String LAST_POSITION = "lastPosition";
    private static final String LAST_DURATION = "lastDuration";
    private static final String LAST_TITLE = "lastTitle";
    private static final String LAST_ARTIST = "lastArtist";
    private static final String LAST_PLAYING = "lastPlaying";
    private static final String SLEEP_TIMER_DEADLINE = "sleepTimerDeadlineEpochMs";
    private static final String SLEEP_TIMER_PLAN = "sleepTimerPlanV2";
    private static final int NOTIFICATION_ID = 1201;
    private static final long RESOLVE_TIMEOUT_MS = 70_000L;
    private static final long MATCH_PREPARE_TIMEOUT_MS = 15_000L;
    private static final long MATCH_RECOVERY_TIMEOUT_MS = 24_000L;
    private static final long PLUGIN_RECOVERY_TIMEOUT_MS = 6_000L;
    private static final long RELAY_DIAGNOSTIC_TIMEOUT_MS = 1_500L;
    private static volatile AndroidPlaybackService activeInstance;
    private static final PlaybackRouteGuard routeGuard = new PlaybackRouteGuard();
    static final String ROUTE_EPOCH = "routeEpoch";
    static long routeEpoch() { return routeGuard.capture(); }
    private boolean noisyReceiverRegistered;
    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (destroyed || !AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) return;
            routeGuard.disconnected();
            // pause() clears focus-resume intent and pending URL/preparation playback.
            // Reconnecting an output never resumes; the next play action is explicit.
            pause();
        }
    };

    private MediaPlayer player;
    private MusicConnectivity connectivity;
    private MediaSession session;
    private AudioManager audio;
    private AudioFocusRequest focusRequest;
    private String title = BuildConfig.APP_DISPLAY_NAME;
    private String artist = "";
    private long trackId;
    private long duration;
    private float actualSpeed = 1f, actualPitch = 1f;
    private String tuningWarning = "";
    private PlaybackSegment segment = PlaybackSegment.of(null, 0);
    private boolean seeking;
    private int pendingSeekRelative, appliedSeekRelative;
    private int completedGeneration = -1;
    private boolean sleepStoppedAtTrackEnd;
    private Runnable segmentWatchdog, playerDeadline, urlDeadline;
    private Intent playerRequest;
    private int generation;
    private boolean playing;
    private boolean desiredPlayback;
    private boolean playerPrepared;
    private boolean remotePlayback;
    private boolean buffering;
    private final RemotePlaybackProgress remoteProgress = new RemotePlaybackProgress();
    private boolean destroyed;
    private boolean progressTickerStarted;
    private boolean urlLookupPending;
    private boolean resumeOnFocusGain;
    private float focusVolume = 1f;
    private JSONObject trackMetadata;
    // Resolved URL and provider headers remain memory-only until actual playback.
    private JSONObject cacheLocation;
    private int cacheEnqueuedGeneration = -1;
    private int pluginStartedGeneration = -1;
    private int pluginEndedGeneration = -1;
    private long lastPluginReportTime;
    private boolean lastPluginPlaying;
    private PlaybackSleepPlan sleepPlan = PlaybackSleepPlan.none();
    private volatile PlaybackAbLoop abLoop = PlaybackAbLoop.empty();
    private long trackFadeWindowMs;
    private float sleepGain = 1f;
    private Runnable abLoopWatchdog;
    private boolean sleepFadeScheduled;
    private final Runnable sleepFadeTick = () -> {
        sleepFadeScheduled=false;
        if(!destroyed)checkSleepTimer();
    };
    private PlaybackQueue.Snapshot queue;
    private Future<?> urlTask;
    private final NextTrackPrefetch nextPrefetch = new NextTrackPrefetch();
    private final NextTrackPrefetch.QueueSignature prefetchQueueSignature = new NextTrackPrefetch.QueueSignature();
    private final ExecutorService prefetchWorker = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable,"VutronNextAddress"); thread.setPriority(Thread.MIN_PRIORITY); return thread;
    });
    private Future<?> prefetchTask;
    private String prefetchAttempt = "";
    private String prefetchSession = "";
    private final PrefetchedSourceRetry prefetchedRetry = new PrefetchedSourceRetry();
    private Bitmap artwork;
    private String artworkUrl = "";
    private int artworkGeneration;
    private volatile HttpURLConnection artworkConnection;
    private Handler progressHandler;
    private final PluginPreparationWatch pluginPreparation = new PluginPreparationWatch(Executors.newSingleThreadExecutor(runnable ->
            new Thread(runnable, "VutronMediaStart")), action -> progressHandler.post(action));
    private final ExecutorService urlWorker = Executors.newFixedThreadPool(2);
    private final ExecutorService artworkWorker = Executors.newSingleThreadExecutor();
    private final PlaybackPublication publication = new PlaybackPublication();
    private final Runnable progressTicker = new Runnable() {
        @Override public void run() {
            if (destroyed) return;
            checkSleepTimer();
            AndroidLyricOverlayService.recoverIfEnabled(AndroidPlaybackService.this);
            long now = SystemClock.elapsedRealtime();
            sampleRemoteProgress(now);
            if (publication.checkpointDue(now, playing && playerPrepared && !waitingForAudio() && !seeking)) {
                persistPosition(); publish();
            }
            maybePrefetch();
            if (progressHandler != null) progressHandler.postDelayed(this, 1000L);
        }
    };

    private final AudioManager.OnAudioFocusChangeListener focusListener = change -> {
        if (change == AudioManager.AUDIOFOCUS_GAIN) {
            focusVolume = 1f;
            if (!applyEffectiveVolume()) return;
            boolean shouldResume = resumeOnFocusGain;
            resumeOnFocusGain = false;
            if (shouldResume) resume();
        } else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
            focusVolume = .2f;
            applyEffectiveVolume();
        } else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            boolean wasPlaying = playing || desiredPlayback;
            pause();
            resumeOnFocusGain = wasPlaying;
        } else if (change == AudioManager.AUDIOFOCUS_LOSS) {
            resumeOnFocusGain = false;
            pause();
        }
    };

    static boolean isActive() {
        AndroidPlaybackService service = activeInstance;
        return service != null && !service.destroyed;
    }

    static void enforceLocalOnly() {
        AndroidPlaybackService service = activeInstance;
        if (service == null || service.destroyed || service.progressHandler == null) return;
        HttpURLConnection connection = service.artworkConnection;
        if (connection != null) connection.disconnect();
        int requestGeneration = service.generation;
        service.progressHandler.post(() -> {
            if (service.destroyed || requestGeneration != service.generation || PluginMedia.networkAllowed(service, service.trackMetadata)) return;
            if (service.remotePlayback || service.urlLookupPending) service.stopPlayback(false);
        });
    }

    static void invalidatePluginSource(String pluginId) {
        AndroidPlaybackService service = activeInstance;
        if (service == null || service.destroyed || service.progressHandler == null) return;
        service.progressHandler.post(() -> {
            if (service.destroyed) return;
            JSONObject requested = service.queue == null ? null : service.queue.current();
            if (pluginId.equals(service.trackMetadata == null ? "" : service.trackMetadata.optString("pluginId"))
                    || requested != null && pluginId.equals(requested.optString("pluginId"))) service.stopPlayback(false);
        });
    }

    static int getMode(Context context) {
        return context.getSharedPreferences(PLAYBACK_PREFS, MODE_PRIVATE).getInt("mode", 0);
    }

    static void setMode(Context context, int mode) {
        if (mode < 0 || mode > 2) throw new IllegalArgumentException("播放模式无效");
        context.getSharedPreferences(PLAYBACK_PREFS, MODE_PRIVATE).edit().putInt("mode", mode).apply();
        invalidatePrefetchForPolicyChange();
    }

    interface QueueResult {
        void success(PlaybackQueue.Snapshot value);
        void failure(Exception error);
    }

    /** Serialize queue edits with native completion/skip callbacks on the media thread. */
    static void editQueue(Context context, String operation, int index, boolean upNext, JSONObject track, QueueResult result) {
        final long requestRoute = routeEpoch();
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                if ("select".equals(operation) && !routeGuard.accepts(requestRoute)) throw new java.io.IOException("播放请求已在耳机断开后取消");
                PlaybackQueue.Snapshot current = PlaybackQueue.load(context);
                boolean wasEmpty = current == null || current.count() == 0;
                AndroidPlaybackService service = activeInstance;
                boolean active = service != null && !service.destroyed;
                if (current == null) {
                    if (!"add".equals(operation) && !"append".equals(operation) && !"addMany".equals(operation) && !"appendMany".equals(operation) && !"undo".equals(operation)) throw new IllegalArgumentException("播放队列为空");
                    if ("undo".equals(operation)) current = null;
                    else
                    current = new PlaybackQueue.Snapshot(java.util.UUID.randomUUID().toString(), new org.json.JSONArray(), -1);
                }
                PlaybackQueue.Snapshot updated;
                boolean select = false;
                if ("add".equals(operation)) updated = current.appendNext(track);
                else if ("append".equals(operation)) updated = current.appendTail(track);
                else if ("addMany".equals(operation) || "appendMany".equals(operation)) updated = current.appendMany(track.getJSONArray("tracks"), "addMany".equals(operation));
                else if ("undo".equals(operation)) updated = PlaybackQueueUndo.restore(track.getString("undoToken"), current, System.currentTimeMillis());
                else if ("clearNext".equals(operation)) updated = current.clearNext();
                else if ("select".equals(operation)) {
                    if (upNext) updated = current.consumeNext(index);
                    else {
                        if (index < 0 || index >= current.count()) throw new IllegalArgumentException("播放队列索引无效");
                        updated = current.at(index);
                    }
                    select = true;
                } else if ("remove".equals(operation)) {
                    select = !upNext && index == current.index;
                    updated = current.remove(index, upNext);
                } else throw new IllegalArgumentException("队列操作无效");
                if ("clearNext".equals(operation) && current.upNext.length() == 0) { result.success(current); return; }
                PlaybackQueue.persist(context, updated);
                if ("undo".equals(operation)) PlaybackQueueUndo.discard(track.getString("undoToken"));
                if (active) { service.queue = updated; service.invalidatePrefetch(); }
                if (select || "undo".equals(operation) && wasEmpty) {
                    if (updated.count() == 0) {
                        if (active) service.stopPlayback(true);
                        else {
                            PlaybackQueue.clear(context);
                            context.getSharedPreferences(PLAYBACK_PREFS, MODE_PRIVATE).edit()
                                    .remove(LAST_TRACK_ID).remove(LAST_POSITION).remove(LAST_DURATION)
                                    .remove(LAST_TITLE).remove(LAST_ARTIST).remove("current_track").remove("error")
                                    .putLong("trackId", 0L).putInt("position", 0).putLong("duration", 0L)
                                    .putString("title", "").putString("artist", "").putBoolean("playing", false)
                                    .putBoolean("loading", false).putBoolean(LAST_PLAYING, false).apply();
                        }
                    } else if (active) {
                        boolean autoPlay = !"undo".equals(operation) && (!"remove".equals(operation) || service.desiredPlayback);
                        service.selectQueueTrack(false, autoPlay);
                    } else if ("select".equals(operation)) {
                        ContextCompat.startForegroundService(context, new Intent(context, AndroidPlaybackService.class)
                                .setAction(ACTION_QUEUE).putExtra("queueToken", updated.token).putExtra("restorePosition", false)
                                .putExtra(ROUTE_EPOCH, requestRoute));
                    } else {
                        context.getSharedPreferences(PLAYBACK_PREFS, MODE_PRIVATE).edit()
                                .putString("current_track", updated.current().toString())
                                .putLong(LAST_TRACK_ID, updated.current().optLong("id"))
                                .putLong("trackId", updated.current().optLong("id"))
                                .putString("title", updated.current().optString("name"))
                                .putString("artist", PlaybackRequest.artistText(updated.current()))
                                .putLong("duration", updated.current().optLong("duration", updated.current().optLong("dt", 0)))
                                .putString(LAST_TITLE, updated.current().optString("name"))
                                .putString(LAST_ARTIST, PlaybackRequest.artistText(updated.current()))
                                .putLong(LAST_DURATION, updated.current().optLong("duration", updated.current().optLong("dt", 0)))
                                .putInt(LAST_POSITION, 0).putInt("position", 0).putBoolean("playing", false)
                                .putBoolean(LAST_PLAYING, false).apply();
                    }
                }
                if ("remove".equals(operation) || "clearNext".equals(operation)) {
                    String undoToken = PlaybackQueueUndo.offer(current, updated, operation, index, upNext, System.currentTimeMillis());
                    new Handler(Looper.getMainLooper()).postDelayed(() -> PlaybackQueueUndo.discard(undoToken), 12000);
                }
                result.success(updated);
            } catch (Exception failure) { result.failure(failure); }
        });
    }

    static void reorderLocalQueue(Context context, String collectionId, org.json.JSONArray keys, QueueResult result) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                PlaybackQueue.Snapshot current = PlaybackQueue.load(context);
                if (current == null) { result.success(null); return; }
                PlaybackQueue.Snapshot next = current.reorderCollection(collectionId, keys);
                if (next == current) { result.success(current); return; }
                PlaybackQueue.persist(context, next);
                AndroidPlaybackService service = activeInstance;
                if (service != null && !service.destroyed) { service.queue = next; service.invalidatePrefetch(); service.publish(); }
                result.success(next);
            } catch (Exception error) { result.failure(error); }
        });
    }

    /** Returns false before any mutation when the caller has not confirmed stopping an affected track. */
    static java.util.concurrent.Future<Boolean> prepareLibraryRemoval(Context context,
            java.util.function.Predicate<JSONObject> removed, boolean stopConfirmed, boolean clearQueueWhenCurrent) {
        java.util.concurrent.FutureTask<Boolean> result = new java.util.concurrent.FutureTask<>(() -> {
                android.content.SharedPreferences preferences = context.getSharedPreferences(PLAYBACK_PREFS, MODE_PRIVATE);
                JSONObject current = new JSONObject(preferences.getString("current_track", "{}"));
                boolean affectsCurrent = removed.test(current);
                if (affectsCurrent && !stopConfirmed) return false;
                PlaybackQueue.Snapshot snapshot = PlaybackQueue.load(context);
                AndroidPlaybackService service = activeInstance;
                boolean active = service != null && !service.destroyed;
                if (active) service.invalidatePrefetch();
                if (affectsCurrent) {
                    if (active) service.stopPlayback(true);
                    else {
                        PlaybackQueue.clear(context);
                        preferences.edit().remove(LAST_TRACK_ID).remove(LAST_POSITION).remove(LAST_DURATION)
                                .remove(LAST_TITLE).remove(LAST_ARTIST).remove("current_track").remove("error")
                                .putLong("trackId", 0).putLong("duration", 0).putInt("position", 0)
                                .putString("title", "").putString("artist", "").putBoolean("playing", false)
                                .putBoolean("loading", false).putBoolean(LAST_PLAYING, false).apply();
                    }
                }
                if (snapshot != null) {
                    PlaybackQueue.Snapshot updated = snapshot.withoutMatching(removed);
                    if (affectsCurrent && clearQueueWhenCurrent || updated.count() == 0 && updated.upNext.length() == 0) {
                        PlaybackQueue.clear(context); if (active) service.queue = null;
                    } else { PlaybackQueue.persist(context, updated); if (active) service.queue = updated; }
                }
                return true;
        });
        new Handler(Looper.getMainLooper()).post(result);
        return result;
    }

    /** Apply the old personal edition's persistent track and playlist gains immediately. */
    public static void onVolumeSettingsChanged(Context context) {
        AndroidPlaybackService service = activeInstance;
        if (service == null || service.destroyed || service.progressHandler == null) return;
        service.progressHandler.post(() -> {
            if (!service.destroyed && activeInstance == service && service.applyEffectiveVolume()) service.publish();
        });
    }

    static void onPlaybackTuningChanged(Context context, Runnable completed) {
        AndroidPlaybackService service = activeInstance;
        if (service == null || service.destroyed) { completed.run(); return; }
        service.progressHandler.post(() -> {
            if (!service.destroyed) {
                service.invalidatePrefetch();
                service.persistPosition();
                if (service.playing) {service.applyTuning();service.applyEffectiveVolume();service.refreshSleepFade();}
                service.publish();
            }
            completed.run();
        });
    }

    static void invalidatePrefetchForPolicyChange() {
        AndroidPlaybackService service = activeInstance;
        if (service != null && !service.destroyed && service.progressHandler != null) {
            service.nextPrefetch.invalidate();
            service.progressHandler.post(service::invalidatePrefetch);
        }
    }

    private void invalidatePrefetch() {
        prefetchQueueSignature.clear();
        cancelPrefetchWork();
    }

    private void cancelPrefetchWork() {
        nextPrefetch.invalidate();
        if (prefetchTask != null) prefetchTask.cancel(true);
        prefetchTask = null; prefetchAttempt = ""; prefetchSession = "";
    }

    private void maybePrefetch() {
        if(abLoop.enabled)return;
        int mode = getMode(this);
        if (!playing || !remotePlayback || waitingForAudio() || seeking || queue == null || !PlaybackTuning.prefetch(this)
                || LocalOnlyMode.enabled(this) || !MusicConnectivity.wifi(this)
                || !NextTrackPrefetch.deterministic(mode,queue.count(),queue.upNext.length(),queue.insertedPlaying)) return;
        try {
            int position = relativePosition();
            if (position < 1500) return; // Current playback gets first access to bandwidth and the decoder.
            if (duration > 0 && duration - position > 30000 * actualSpeed) return; // Resolve within the short URL TTL.
            if (!prefetchQueueSignature.claim(queue.token,generation,mode,queue.count(),queue.upNext.length(),queue.index,queue.insertedPlaying)) return;
            cancelPrefetchWork();
            JSONObject selected = queue.peekNext(mode,true,0);
            if (selected == null || PluginMedia.isPlugin(selected) || !LocalLibraryIds.uri(selected).isEmpty() || selected.optBoolean("cached") || selected.optLong("id") == trackId) return;
            String key = NextTrackPrefetch.key(selected), queueToken = queue.token;
            String attempt = queueToken + ":" + generation + ":" + key;
            prefetchAttempt = attempt;
            int revision = nextPrefetch.revision();
            String cookie = SessionStore.load(this);
            prefetchSession = cookie;
            prefetchTask = prefetchWorker.submit(() -> {
                try {
                    java.util.function.BooleanSupplier allowed = () -> revision == nextPrefetch.revision() && cookie.equals(SessionStore.load(this))
                            && PlaybackTuning.prefetch(this) && !LocalOnlyMode.enabled(this) && MusicConnectivity.wifi(this);
                    if (!allowed.getAsBoolean() || AudioCache.find(this,selected.optLong("id")) != null
                            || LocalPlaybackResolver.match(this,selected) != null) return;
                    JSONObject location = PlaybackSourceResolver.resolve(this,selected.optLong("id"),ignored -> {},allowed);
                    if (!allowed.getAsBoolean()) return;
                    nextPrefetch.put(revision,key,queueToken,location,SystemClock.elapsedRealtime());
                    if (allowed.getAsBoolean()) ArtworkCache.enqueue(this, ArtworkSource.coverUrl(selected));
                    LyricRepository.prewarm(this, selected.optLong("id"), allowed);
                } catch (Exception ignored) { /* Opportunistic; normal playback still resolves and reports its own errors. */ }
            });
        } catch (Exception ignored) { /* No user-facing failure or automatic retry for a queue snapshot. */ }
    }

    private void applyTuning() {
        if (player == null || !playerPrepared) return;
        float speed = PlaybackTuning.speed(this), pitch = PlaybackTuning.pitch(this);
        tuningWarning = "";
        try {
            player.setPlaybackParams(new android.media.PlaybackParams().allowDefaults().setSpeed(speed).setPitch(pitch));
            actualSpeed = player.getPlaybackParams().getSpeed(); actualPitch = player.getPlaybackParams().getPitch();
        } catch (IllegalArgumentException | IllegalStateException unsupported) {
            try {
                player.setPlaybackParams(new android.media.PlaybackParams().allowDefaults().setSpeed(speed).setPitch(1f));
                actualSpeed = player.getPlaybackParams().getSpeed(); actualPitch = 1f;
                tuningWarning = "当前设备或音频不支持该变调，已使用原调";
            } catch (IllegalArgumentException | IllegalStateException unsupportedSpeed) {
                try { player.setPlaybackParams(new android.media.PlaybackParams().allowDefaults().setSpeed(1f).setPitch(1f)); }
                catch (IllegalArgumentException | IllegalStateException ignored) { }
                actualSpeed = 1f; actualPitch = 1f; tuningWarning = "当前设备或音频不支持倍速，已回退 1.0×";
            }
        }
        resetSleepFade();
    }

    /** Starts or replaces the original wall-clock timer. */
    static long setSleepTimer(Context context, long durationMs) {
        setSleepTimer(context,"duration",durationMs,0,0);
        return readSleepPlan(context).deadline;
    }

    static void setSleepTimer(Context context,String mode,long durationMs,int tracks,int fadeSeconds) {
        AndroidPlaybackService service=activeInstance;
        String key=service!=null&&!service.destroyed&&service.playerPrepared&&service.duration>0?PlaybackVolume.trackKey(service.trackMetadata):"";
        PlaybackSleepPlan next=PlaybackSleepPlan.create(mode,durationMs,tracks,fadeSeconds,System.currentTimeMillis(),key,
                service!=null&&!service.destroyed&&service.abLoop.enabled);
        saveSleepPlan(context,next);
        ContextCompat.startForegroundService(context,new Intent(context,AndroidPlaybackService.class).setAction(ACTION_TIMER_WAKE));
    }

    private static PlaybackSleepPlan readSleepPlan(Context context) {
        android.content.SharedPreferences prefs=context.getSharedPreferences(PLAYBACK_PREFS,Context.MODE_PRIVATE);
        JSONObject value=null;String raw=prefs.getString(SLEEP_TIMER_PLAN,"");
        if(!raw.isEmpty())try{value=new JSONObject(raw);}catch(Exception invalid){Log.w("VutronPlayback","Invalid sleep timer state");}
        return PlaybackSleepPlan.read(value,prefs.getLong(SLEEP_TIMER_DEADLINE,0));
    }

    private static void saveSleepPlan(Context context,PlaybackSleepPlan plan) {
        android.content.SharedPreferences.Editor editor=context.getSharedPreferences(PLAYBACK_PREFS,Context.MODE_PRIVATE).edit();
        if(plan.active())editor.putString(SLEEP_TIMER_PLAN,plan.json(System.currentTimeMillis()).toString());else editor.remove(SLEEP_TIMER_PLAN);
        if(plan.deadline>0)editor.putLong(SLEEP_TIMER_DEADLINE,plan.deadline);else editor.remove(SLEEP_TIMER_DEADLINE);
        editor.apply();
        AndroidPlaybackService service=activeInstance;
        if(service!=null&&!service.destroyed&&service.progressHandler!=null) {
            if(Looper.myLooper()==Looper.getMainLooper())service.onSleepPlanChanged(plan);
            else service.progressHandler.post(()->{if(!service.destroyed)service.onSleepPlanChanged(plan);});
        }
    }

    static void clearSleepTimer(Context context) {
        saveSleepPlan(context,PlaybackSleepPlan.none());
        AndroidPlaybackService service=activeInstance;
        if(service!=null&&!service.destroyed&&service.progressHandler!=null)service.progressHandler.post(service::onSleepTimerCleared);
    }

    private void onSleepPlanChanged(PlaybackSleepPlan plan) {
        sleepPlan=plan;resetSleepFade();applyEffectiveVolume();
    }

    private void onSleepTimerCleared() {
        if (player == null && !urlLookupPending && !sleepPlan.active()) { stopForeground(true);stopSelf(); }
    }

    static JSONObject sleepTimerSnapshot(Context context) {
        PlaybackSleepPlan plan=readSleepPlan(context);long now=System.currentTimeMillis();
        if(plan.expires(now)) {
            AndroidPlaybackService service=activeInstance;
            if(service!=null&&!service.destroyed)service.progressHandler.post(service::expireSleepTimer);
            else ContextCompat.startForegroundService(context,new Intent(context,AndroidPlaybackService.class).setAction(ACTION_TIMER_WAKE));
        } else if(plan.deadline>now&&!isActive()) {
            try{ContextCompat.startForegroundService(context,new Intent(context,AndroidPlaybackService.class).setAction(ACTION_TIMER_WAKE));}
            catch(RuntimeException ignored){ }
        }
        return plan.json(now);
    }

    static long sleepTimerRemainingMs(Context context) { return sleepTimerSnapshot(context).optLong("remainingMs"); }

    /** Current-session points only; no media URI, queue or user gain is persisted. */
    static JSONObject abLoopSnapshot() {
        AndroidPlaybackService service=activeInstance;
        if(service==null||service.destroyed||!service.playerPrepared)return PlaybackAbLoop.empty().json();
        try{return service.abLoop.json().put("positionMs",service.relativePosition());}
        catch(Exception invalid){throw new IllegalStateException("读取当前歌曲位置失败",invalid);}
    }

    /** The playback sampler can read immutable loop metadata without touching MediaPlayer. */
    static JSONObject abPlaybackSnapshot(){
        AndroidPlaybackService service=activeInstance;
        return service==null||service.destroyed||!service.playerPrepared?PlaybackAbLoop.empty().json():service.abLoop.json();
    }

    static JSONObject setAbLoop(String expected,String action,Long start,Long end,Boolean enabled) {
        if(!"set".equals(action)&&!"clear".equals(action))throw new IllegalArgumentException("A/B 循环操作无效");
        AndroidPlaybackService service=activeInstance;
        if(service==null||service.destroyed||!service.playerPrepared)throw new IllegalArgumentException("歌曲尚未准备好，暂时无法设置 A/B 循环");
        service.abLoop=service.abLoop.forTrack(PlaybackVolume.trackKey(service.trackMetadata),service.trackId,service.duration)
                .update(expected,"clear".equals(action),start,end,enabled,service.sleepPlan.byTrack());
        service.cancelAbLoopWatchdog();
        service.invalidatePrefetch();
        if(service.abLoop.enabled) {
            int position=service.relativePosition();
            if(position<service.abLoop.startMs||position>=service.abLoop.endMs)service.requestSeek((int)service.abLoop.startMs);
            else service.armAbLoopWatchdog(service.generation);
        }
        return abLoopSnapshot();
    }

    static void seek(Context context, int positionMs) {
        invalidatePrefetchForPolicyChange();
        AndroidPlaybackService service = activeInstance;
        int target = Math.max(0, positionMs);
        if (service != null && !service.destroyed) {
            service.progressHandler.post(() -> {
                if (service.player != null && service.playerPrepared) {
                    try {
                        int bounded = service.duration > 0 ? Math.min(target, (int) service.duration) : target;
                        service.requestSeek((int)service.abLoop.boundedSeek(bounded));
                    } catch (IllegalStateException ignored) { }
                }
            });
            return;
        }
        context.getSharedPreferences(PLAYBACK_PREFS, MODE_PRIVATE).edit()
                .putInt(LAST_POSITION, target).putInt("position", target).apply();
    }

    @Override public void onCreate() {
        super.onCreate();
        activeInstance = this;
        progressHandler = new Handler(Looper.getMainLooper());
        sleepPlan = readSleepPlan(this);
        try {
            connectivity = new MusicConnectivity(this, () -> {
                if (destroyed) return;
                invalidatePrefetchForPolicyChange();
                try { LocalOnlyMode.updateConnectivity(this, MusicConnectivity.available(this)); }
                catch (Exception failure) { Log.w("VutronNetwork", "Background network policy update failed", failure); }
            });
            LocalOnlyMode.updateConnectivity(this, MusicConnectivity.available(this));
        } catch (RuntimeException | java.io.IOException failure) { Log.w("VutronNetwork", "Background network observer unavailable", failure); }
        try { queue = PlaybackQueue.load(this); }
        catch (Exception failure) { Log.w("VutronPlayback", "Could not restore the playback queue", failure); }
        audio = getSystemService(AudioManager.class);
        ContextCompat.registerReceiver(this, noisyReceiver, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED);
        noisyReceiverRegistered = true;
        NotificationManager notifications = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) notifications.createNotificationChannel(new NotificationChannel(CHANNEL, BuildConfig.APP_DISPLAY_NAME + " 播放", NotificationManager.IMPORTANCE_LOW));
        AudioAttributes attributes = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build();
        session = new MediaSession(this, "VutronMusicAndroid");
        session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setPlaybackToLocal(attributes);
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { resumeOrRestore(); }
            @Override public void onPause() { pause(); }
            @Override public void onSkipToNext() { changeSong(1); }
            @Override public void onSkipToPrevious() { changeSong(-1); }
            @Override public void onSeekTo(long value) { seek(AndroidPlaybackService.this, (int) Math.min(Integer.MAX_VALUE, Math.max(0, value))); }
            @Override public void onStop() { stopPlayback(true); stopSelf(); }
        });
        session.setActive(true);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        // Every foreground-service intent, including a cold notification Stop,
        // must promote before it may stop or schedule idle housekeeping.
        startForeground(NOTIFICATION_ID, notification());
        if (!ACTION_STOP.equals(action) && !progressTickerStarted) {
            progressTickerStarted = true;
            // The posted tick runs after this command has established player or
            // URL-lookup state. A tick posted from onCreate could stop the fresh
            // service before onStartCommand and trigger the Android FGS timeout.
            progressHandler.post(progressTicker);
        }
        if (intent != null && intent.hasExtra(ROUTE_EPOCH) && !routeGuard.accepts(intent.getLongExtra(ROUTE_EPOCH, -1))) {
            if (!playing && !desiredPlayback) pause();
            return START_NOT_STICKY;
        }
        if (ACTION_QUEUE.equals(action)) {
            try {
                PlaybackQueue.Snapshot requested = PlaybackQueue.load(this);
                if (requested != null && requested.token.equals(intent.getStringExtra("queueToken"))) {
                    queue = requested;
                    selectQueueTrack(intent.getBooleanExtra("restorePosition", true), true, intent.getIntExtra("resumePosition", -1));
                }
            } catch (Exception failure) {
                Log.w("VutronPlayback", "Could not load the selected queue", failure);
                publishError("无法读取播放队列");
            }
        }
        else if (ACTION_PLAY.equals(action)) startTrack(intent);
        else if (ACTION_PAUSE.equals(action)) pause();
        else if (ACTION_RESUME.equals(action)) resumeOrRestore();
        else if (ACTION_NEXT.equals(action)) changeSong(1);
        else if (ACTION_PREVIOUS.equals(action)) changeSong(-1);
        else if (ACTION_STOP.equals(action)) { stopPlayback(true); stopSelf(startId); }
        else if (ACTION_TIMER_WAKE.equals(action)) checkSleepTimer();
        return START_NOT_STICKY;
    }

    private void changeSong(int direction) {
        if (queue == null || queue.count() == 0 && queue.upNext.length() == 0) return;
        if (direction > 0) advanceQueue(false);
        else {
            queue = queue.move(-1);
            selectQueueTrack(false);
        }
    }

    private void advanceQueue(boolean automatic) {
        if (queue == null || queue.count() == 0 && queue.upNext.length() == 0) return;
        try {
            PlaybackQueue.Snapshot latest = PlaybackQueue.load(this);
            if (latest == null || !latest.token.equals(queue.token)) return;
            queue = latest;
            if (queue.upNext.length()==0 && queue.index==queue.count()-1) {
                JSONObject radio = null;
                for (int i=queue.index; i>=0; i--) {
                    JSONObject candidate=queue.songs.optJSONObject(i);
                    if (candidate!=null && "personalFM".equals(candidate.optString("pluginSourceMethod"))) { radio=candidate; break; }
                }
                if (radio!=null) { refillPluginRadio(radio); return; }
            }
            int random = queue.count() > 1 ? java.util.concurrent.ThreadLocalRandom.current().nextInt(queue.count() - 1) : 0;
            PlaybackQueue.Snapshot next = queue.next(getMode(this), automatic, random);
            // Consuming inserts changes the durable history and pending list together.
            if (next.songs != queue.songs || next.upNext != queue.upNext) PlaybackQueue.persist(this, next);
            queue = next;
            selectQueueTrack(false);
        } catch (Exception failure) {
            Log.w("VutronPlayback", "Could not persist the next-up queue", failure);
            publishError("无法保存插队播放状态");
        }
    }

    /** Keep queue ownership in this service so screen-off completion needs no WebView. */
    private void selectQueueTrack(boolean restorePosition) {
        selectQueueTrack(restorePosition, true);
    }

    private void refillPluginRadio(JSONObject radio) throws Exception {
        final JSONObject previous = new JSONObject(radio.toString());
        final String expectedQueue = queue.token;
        persistPosition(); releasePlayer(); cancelUrlTask();
        final int token = ++generation;
        playing=false; desiredPlayback=true;
        beginUrlLookup(token, RESOLVE_TIMEOUT_MS, "radio_resolve"); publish();
        urlTask=urlWorker.submit(() -> {
            try {
                String id=previous.getString("pluginId");
                String account=previous.getString("pluginAccountScope");
                if (!account.equals(AndroidPluginManager.accountScope(this,id))) throw new java.io.IOException("私人电台账号已变化");
                JSONObject result=AndroidPluginManager.callScoped(this,id,"personalFM",new JSONObject(),account);
                if (!account.equals(AndroidPluginManager.accountScope(this,id))) throw new java.io.IOException("私人电台账号已变化");
                JSONArray incoming=result.optJSONArray("data");
                if (result.optInt("code")!=200 || incoming==null || incoming.length()==0) throw new java.io.IOException("私人电台暂时没有返回下一批歌曲");
                JSONArray normalized=new JSONArray();
                for(int i=0;i<incoming.length();i++) {
                    JSONObject track=PluginTrackAdapter.track(id,incoming.getJSONObject(i),account).put("pluginSourceMethod","personalFM");
                    normalized.put(track);
                }
                progressHandler.post(() -> {
                    if (!finishUrlLookup(token)) return;
                    try {
                        PlaybackQueue.Snapshot current=PlaybackQueue.load(this);
                        if(current==null || !current.token.equals(expectedQueue)) { desiredPlayback=false;publish();return; }
                        if (!account.equals(AndroidPluginManager.accountScope(this,id))) throw new java.io.IOException("私人电台账号已变化");
                        JSONArray rows=new JSONArray(); int start=Math.max(0,current.count()-100);
                        for(int i=start;i<current.count();i++) rows.put(current.songs.getJSONObject(i));
                        int last=rows.length()-1;
                        for(int i=0;i<normalized.length();i++) rows.put(normalized.getJSONObject(i));
                        queue=new PlaybackQueue.Snapshot(java.util.UUID.randomUUID().toString(),rows,last,current.upNext);
                        PlaybackQueue.persist(this,queue);
                        queue=queue.next(0,false,0);PlaybackQueue.persist(this,queue);selectQueueTrack(false);
                    } catch(Exception failure){publishError("无法接续私人电台");}
                });
            } catch(Exception failure) {progressHandler.post(() -> {if(finishUrlLookup(token)){publishError("私人电台下一批读取失败，请重试");}});}
        });
    }

    private void selectQueueTrack(boolean restorePosition, boolean autoPlay) {
        selectQueueTrack(restorePosition, autoPlay, -1);
    }

    private void selectQueueTrack(boolean restorePosition, boolean autoPlay, int requestedPosition) {
        if (queue == null || queue.current() == null) return;
        persistPosition();
        android.content.SharedPreferences saved = getSharedPreferences(PLAYBACK_PREFS, MODE_PRIVATE);
        JSONObject selected = queue.current();
        final JSONObject prefetched = !LocalOnlyMode.enabled(this) && PlaybackTuning.prefetch(this) && MusicConnectivity.wifi(this) && prefetchSession.equals(SessionStore.load(this))
                ? nextPrefetch.take(NextTrackPrefetch.key(selected),queue.token,SystemClock.elapsedRealtime()) : null;
        invalidatePrefetch();
        long id = selected.optLong("id");
        int position = requestedPosition >= 0 ? requestedPosition : restorePosition && saved.getLong(LAST_TRACK_ID, 0L) == id
                ? saved.getInt(LAST_POSITION, 0) : 0;
        cancelUrlTask();
        releasePlayer();
        final int token = ++generation;
        playing = false;
        desiredPlayback = autoPlay;
        resumeOnFocusGain = false;
        beginUrlLookup(token, RESOLVE_TIMEOUT_MS, "resolve");
        trackId = id;
        sleepStoppedAtTrackEnd=false;
        trackMetadata = selected;
        abLoop=PlaybackAbLoop.empty();
        PlaybackSleepPlan retained=sleepPlan.onTrack(PlaybackVolume.trackKey(selected));
        if(retained!=sleepPlan)saveSleepPlan(this,retained);
        title = selected.optString("name", BuildConfig.APP_DISPLAY_NAME);
        artist = PlaybackRequest.artistText(selected);
        duration = selected.optLong("duration", selected.optLong("dt", 0));
        PlaybackQueue.cursor(this, queue);
        saved.edit().putString("current_track", selected.toString()).putLong(LAST_TRACK_ID, id)
                .putInt(LAST_POSITION, position).putInt("position", position).putLong(LAST_DURATION, duration)
                .putString(LAST_TITLE, title).putString(LAST_ARTIST, artist).putBoolean(LAST_PLAYING, autoPlay)
                .remove("error").remove("errorCode").remove("errorDetail").apply();
        loadArtwork(rememberedArtwork());
        publish();
        urlTask = urlWorker.submit(() -> {
            try {
                Intent prepared = PlaybackRequest.prepare(this, selected, autoPlay,prefetched).putExtra("resumePosition", position);
                progressHandler.post(() -> {
                    if (finishUrlLookup(token)) startTrack(prepared);
                });
            } catch (Exception failure) {
                Log.w("VutronPlayback", "Could not resolve the selected queue track", failure);
                progressHandler.post(() -> {
                    if (finishUrlLookup(token))
                        publishError(PlaybackFailure.from(failure, "resolve", true, MusicConnectivity.available(this)));
                });
            }
        });
    }

    private void beginUrlLookup(int token, long timeout, String stage) {
        beginUrlLookup(token, timeout, PlaybackFailure.timedOut(stage, timeout));
    }

    private void beginUrlLookup(int token, long timeout, PlaybackFailure onTimeout) {
        urlLookupPending = true;
        urlDeadline = () -> {
            if (!destroyed && token == generation && urlLookupPending)
                publishError(onTimeout);
        };
        progressHandler.postDelayed(urlDeadline, timeout);
    }

    private void clearUrlLookup() {
        if (urlDeadline != null) progressHandler.removeCallbacks(urlDeadline);
        urlDeadline = null;
        urlTask = null;
        urlLookupPending = false;
    }

    /** Prevent completed work (including timed-out lookups) from starting a player later. */
    private boolean finishUrlLookup(int token) {
        if (destroyed || token != generation || !urlLookupPending) return false;
        clearUrlLookup();
        return true;
    }

    private void cancelUrlTask() {
        if (urlTask != null) urlTask.cancel(true);
        clearUrlLookup();
    }

    private void checkSleepTimer() {
        if (!sleepPlan.active()) {
            if (player == null && !urlLookupPending) onSleepTimerCleared();
            return;
        }
        if (sleepPlan.expires(System.currentTimeMillis())) expireSleepTimer();
        else refreshSleepFade();
    }

    private void expireSleepTimer() {
        if(!sleepPlan.expires(System.currentTimeMillis()))return;
        expireSleepPlan();
    }

    private void expireSleepPlan() {
        if (player != null || urlLookupPending) {
            // Stop sound/late preparation first. Clearing the plan restores the
            // normal gain and must never briefly amplify the still-playing tail.
            pause();
            saveSleepPlan(this,PlaybackSleepPlan.none());
        } else {
            android.content.SharedPreferences preferences = getSharedPreferences(PLAYBACK_PREFS, MODE_PRIVATE);
            preferences.edit().putBoolean(LAST_PLAYING, false).putBoolean("playing", false).apply();
            playing = false;desiredPlayback=false;
            saveSleepPlan(this,PlaybackSleepPlan.none());
            stopForeground(true);
            stopSelf();
        }
    }

    private void startTrack(Intent intent) {
        invalidatePrefetch();
        String url = intent.getStringExtra("url");
        boolean remote = url != null && (url.startsWith("http://") || url.startsWith("https://"));
        JSONObject requestedMetadata;
        try { requestedMetadata = new JSONObject(intent.getStringExtra("track") == null ? "{}" : intent.getStringExtra("track")); }
        catch (Exception invalid) { requestedMetadata = new JSONObject(); }
        if (remote && !PluginMedia.networkAllowed(this, requestedMetadata)) {
            publishError(PlaybackFailure.of("offline")); return;
        }
        if (!isSupportedSource(url)) {
            publishError(PlaybackFailure.of("source_unavailable")); return;
        }
        // Keep the old song's position before replacing its player. The next
        // start can use this value when the requested track is the same.
        persistPosition();
        android.content.SharedPreferences saved = getSharedPreferences(PLAYBACK_PREFS, MODE_PRIVATE);
        long requestedTrackId = intent.getLongExtra("trackId", 0L);
        long savedTrackId = saved.getLong(LAST_TRACK_ID, saved.getLong("trackId", 0L));
        int savedPosition = saved.getInt(LAST_POSITION, saved.getInt("position", 0));
        final int resumePosition = intent.hasExtra("resumePosition") ? intent.getIntExtra("resumePosition", 0)
                : savedTrackId == requestedTrackId && savedPosition > 0 ? savedPosition : 0;
        long catalogueDuration = requestedMetadata.optLong("duration");
        final long expectedDuration = catalogueDuration > 0 ? catalogueDuration : requestedMetadata.optLong("dt");

        // A previous decode/network failure must not remain visible after the
        // user starts a different track.
        saved.edit().remove("error").remove("errorCode").remove("errorDetail").apply();
        releasePlayer();
        playing = false;
        int token = ++generation;
        title = intent.getStringExtra("title"); if (title == null) title = BuildConfig.APP_DISPLAY_NAME;
        artist = intent.getStringExtra("artist"); if (artist == null) artist = "";
        trackId = requestedTrackId;
        sleepStoppedAtTrackEnd=false;
        trackMetadata = readTrackMetadata(intent, requestedTrackId);
        String currentKey=PlaybackVolume.trackKey(trackMetadata);
        abLoop=abLoop.forTrack(currentKey,trackId,0);
        PlaybackSleepPlan retained=sleepPlan.onTrack(currentKey);
        if(retained!=sleepPlan)saveSleepPlan(this,retained);
        cacheLocation = readCacheLocation(intent);
        String requestedArtwork = intent.getStringExtra("coverUrl");
        if (requestedArtwork == null || requestedArtwork.isBlank()) requestedArtwork = rememberedArtwork();
        loadArtwork(requestedArtwork);
        desiredPlayback = intent.getBooleanExtra("autoPlay", true);
        saved.edit().putString("current_track", trackMetadata.toString())
                .putLong(LAST_TRACK_ID, trackId).putInt(LAST_POSITION, resumePosition)
                .putLong(LAST_DURATION, duration).putString(LAST_TITLE, title).putString(LAST_ARTIST, artist)
                .putBoolean(LAST_PLAYING, desiredPlayback).apply();
        playerPrepared = false;
        remotePlayback = remote;
        MediaPlayer candidate = new MediaPlayer(); player = candidate; playerRequest = intent;
        String setupStage = "player_setup";
        try {
            candidate.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
            candidate.setOnPreparedListener(prepared -> {
                if (destroyed || player != prepared || token != generation) return;
                cancelPlayerDeadline();
                if (remotePlayback && !PluginMedia.networkAllowed(this, trackMetadata)) {
                    publishError(PlaybackFailure.of("offline")); return;
                }
                try {
                    int decodedDuration = Math.max(0, prepared.getDuration());
                    if ((!matcherSource(intent).isEmpty() || isPluginMediaAttempt(intent)) && RemotePlaybackProgress.obviouslyTruncated(expectedDuration, decodedDuration)) {
                        failPlayer(intent, token, PlaybackFailure.incompleteStream(), true);
                        return;
                    }
                    segment = PlaybackSegment.of(trackMetadata, decodedDuration);
                    playerPrepared = true;
                    duration = segment.length;
                    abLoop=abLoop.forTrack(PlaybackVolume.trackKey(trackMetadata),trackId,duration);
                    resetSleepFade();
                    if (segment.needsInitialSeek(resumePosition)) requestSeek(resumePosition);
                    else finishPreparedPlayback(token);
                } catch (RuntimeException invalid) {
                    failPlayer(intent, token, PlaybackFailure.from(invalid, "prepare", remotePlayback, MusicConnectivity.available(this)), remotePlayback);
                }
            });
            candidate.setOnSeekCompleteListener(seeked -> {
                if (destroyed || player != seeked || token != generation || !seeking) return;
                try {
                    if (pendingSeekRelative != appliedSeekRelative) {
                        appliedSeekRelative = pendingSeekRelative;
                        seeked.seekTo(segment.absolute(appliedSeekRelative));
                        armSeekDeadline(token);
                        return;
                    }
                    cancelPlayerDeadline();
                    seeking = false;
                    finishPreparedPlayback(token);
                } catch (IllegalArgumentException | IllegalStateException invalid) { seeking = false; publishError(PlaybackFailure.of("seek")); }
            });
            candidate.setOnCompletionListener(completed -> {
                if (!destroyed && player == completed && token == generation) {
                    completeTrack(token);
                }
            });
            candidate.setOnInfoListener((reporting, what, extra) -> {
                if (destroyed || player != reporting || token != generation) return false;
                if (what == MediaPlayer.MEDIA_INFO_BUFFERING_START || what == MediaPlayer.MEDIA_INFO_BUFFERING_END) {
                    boolean began = !buffering && what == MediaPlayer.MEDIA_INFO_BUFFERING_START;
                    buffering = what == MediaPlayer.MEDIA_INFO_BUFFERING_START;
                    if (began) invalidatePrefetch();
                    resetSleepFade();applyEffectiveVolume();
                    if (buffering) cancelAbLoopWatchdog();
                    else {armAbLoopWatchdog(token);refreshSleepFade();}
                    persistPosition();
                    publish();
                }
                return false;
            });
            candidate.setOnErrorListener((failed, what, extra) -> {
                if (player != failed || token != generation || destroyed) return true;
                PlaybackFailure failure = PlaybackFailure.media(what, extra, remotePlayback, MusicConnectivity.available(this));
                boolean pluginMedia = isPluginMediaAttempt(intent);
                if (pluginMedia) failure = failure.atStage(!playerPrepared ? "prepare" : seeking ? "seek" : "audio_progress");
                failPlayer(intent, token, failure, PlaybackFailure.isMediaSourceFailure(what, extra)
                        || what == MediaPlayer.MEDIA_ERROR_UNKNOWN && extra == 0 && (!matcherSource(intent).isEmpty() || pluginMedia));
                return true;
            });
            setupStage = "set_data_source";
            if (url.startsWith("content://") || url.startsWith("file://")) {
                candidate.setDataSource(this, Uri.parse(url));
            } else if (url.startsWith("http://") || url.startsWith("https://")) {
                PluginMedia.requireOnline(this,trackMetadata);
                candidate.setDataSource(this, Uri.parse(url), sourceHeaders(intent));
            } else {
                candidate.setDataSource(url);
            }
            publish();
            long prepareTimeout = matcherSource(intent).isEmpty() && !isPluginMediaAttempt(intent) ? 25_000L : MATCH_PREPARE_TIMEOUT_MS;
            armPlayerDeadline(token, prepareTimeout, PlaybackFailure.timedOut("prepare", prepareTimeout), remotePlayback);
            setupStage = "prepare_async";
            candidate.prepareAsync();
            watchPluginPreparation(intent, token);
        } catch (Exception error) {
            Log.w("VutronPlayback", "Could not prepare the selected media: " + error.getClass().getSimpleName());
            failPlayer(intent, token, PlaybackFailure.from(error, setupStage, remotePlayback, MusicConnectivity.available(this)),
                    error instanceof java.io.IOException || isPluginMediaAttempt(intent) && error instanceof IllegalArgumentException);
        }
    }

    private void watchPluginPreparation(Intent request, int token) {
        if (!remotePlayback || !isPluginMediaAttempt(request) || !desiredPlayback || !request.getBooleanExtra("watchStartFailure", false)) return;
        EmbeddedSources.MediaStartWatch watch = EmbeddedSources.openMediaStartWatch(request.getStringExtra("url"));
        if (watch == null) return;
        pluginPreparation.start(watch::awaitFailure, watch::close, relay -> {
            if (destroyed || token != generation || request != playerRequest || playerPrepared || seeking || !desiredPlayback) return;
            String code = LocalOnlyMode.manual(this) ? "offline" : MusicConnectivity.available(this) ? "source_io" : "network";
            failPlayer(request, token, PlaybackFailure.of(code).atStage("prepare"), "source_io".equals(code), relay);
        });
    }

    private void cancelPlayerDeadline() {
        pluginPreparation.cancel();
        if (playerDeadline != null) progressHandler.removeCallbacks(playerDeadline);
        playerDeadline = null;
    }

    private void armPlayerDeadline(int token, long millis, PlaybackFailure failure, boolean sourceFailure) {
        cancelPlayerDeadline();
        playerDeadline = () -> {
            playerDeadline = null;
            if (!destroyed && generation == token && player != null)
                failPlayer(playerRequest, token, failure, sourceFailure);
        };
        progressHandler.postDelayed(playerDeadline, millis);
    }

    private boolean waitingForAudio() { return buffering || remoteProgress.waiting(); }

    private void sampleRemoteProgress(long now) {
        if (!remoteProgress.active() || !playing || !playerPrepared || seeking || player == null) return;
        final int nativePosition;
        try { nativePosition = Math.max(0, player.getCurrentPosition()); }
        catch (IllegalStateException expired) {
            failPlayer(playerRequest, generation, PlaybackFailure.from(expired, "audio_progress", true, MusicConnectivity.available(this)), true);
            return;
        }
        boolean wasWaiting = waitingForAudio();
        boolean started = remoteProgress.started();
        RemotePlaybackProgress.Sample result = remoteProgress.sample(now, nativePosition);
        if (result == RemotePlaybackProgress.Sample.TIMED_OUT) {
            failPlayer(playerRequest, generation, PlaybackFailure.timedOut(started ? "audio_progress" : "first_audio"), true);
            return;
        }
        if (result == RemotePlaybackProgress.Sample.ADVANCING) {
            buffering = false;
            if (!started) confirmPlaybackStart(generation, segment.relative(nativePosition));
        }
        if (wasWaiting != waitingForAudio()) {
            if (waitingForAudio()) { invalidatePrefetch(); cancelAbLoopWatchdog(); }
            else if (abLoopWatchdog == null) armAbLoopWatchdog(generation);
            refreshSleepFade(); persistPosition(); publish();
        }
    }

    private String matcherSource(Intent request) {
        String source = remotePlayback && request != null ? request.getStringExtra("matcherSource") : null;
        return source == null ? "" : source;
    }

    private static boolean isPluginMediaAttempt(Intent request) {
        return request != null && request.getIntExtra("pluginMediaAttempt", 0) > 0;
    }

    private void armSeekDeadline(int token) {
        armPlayerDeadline(token, 10_000L, PlaybackFailure.of("seek"), !matcherSource(playerRequest).isEmpty() || isPluginMediaAttempt(playerRequest));
    }

    private void failPlayer(Intent failedRequest, int token, PlaybackFailure failure, boolean sourceFailure) {
        failPlayer(failedRequest, token, failure, sourceFailure, "");
    }

    private void failPlayer(Intent failedRequest, int token, PlaybackFailure failure, boolean sourceFailure, String observedRelay) {
        if (destroyed || token != generation || failedRequest != playerRequest) return;
        if (remotePlayback && isPluginMediaAttempt(failedRequest)) {
            diagnosePluginFailure(failedRequest, failure, sourceFailure, observedRelay);
        } else if (failedRequest == null || !retryFailedSource(failedRequest, token, failure, sourceFailure)) publishError(failure);
    }

    private void diagnosePluginFailure(Intent failed, PlaybackFailure failure, boolean sourceFailure, String observedRelay) {
        final int attempt = failed.getIntExtra("pluginMediaAttempt", 1);
        final int total = Math.max(attempt, failed.getIntExtra("pluginMediaTotal", attempt));
        final String[] candidates = failed.getStringArrayExtra("pluginMediaCandidates");
        final boolean retry = sourceFailure && desiredPlayback && candidates != null && candidates.length > 0
                && attempt < total && MusicConnectivity.available(this) && PluginMedia.networkAllowed(this, trackMetadata);
        final String history = failed.getStringExtra("pluginMediaHistory");
        final PlaybackFailure fallback = failure.withRelayReason(observedRelay).atAttempt(attempt, total, observedRelay).afterAttempts(history);
        if (!retry && !observedRelay.isEmpty()) { publishError(fallback); return; }
        final JSONObject selected = trackMetadata; // PlaybackRequest takes its own copy before resolving.
        final boolean autoPlay = desiredPlayback;
        persistPosition();
        final int resumePosition = getSharedPreferences(PLAYBACK_PREFS, MODE_PRIVATE).getInt(LAST_POSITION, 0);
        invalidatePrefetch(); releasePlayer(); playing = false;
        final int recoveryToken = ++generation;
        beginUrlLookup(recoveryToken, retry ? PLUGIN_RECOVERY_TIMEOUT_MS : RELAY_DIAGNOSTIC_TIMEOUT_MS, fallback);
        publish();
        urlTask = urlWorker.submit(() -> {
            PlaybackFailure detailed = fallback;
            if (observedRelay.isEmpty()) {
                String relay = EmbeddedSources.mediaStatus(failed.getStringExtra("url"));
                detailed = failure.withRelayReason(relay).atAttempt(attempt, total, relay).afterAttempts(history);
            }
            if (retry && !Thread.currentThread().isInterrupted()) try {
                PluginMedia.requireOnline(this, selected);
                Intent fresh = PlaybackRequest.preparePluginBackup(this, selected, autoPlay, failed)
                        .putExtra("resumePosition", resumePosition).putExtra("pluginMediaHistory", detailed.diagnostic);
                progressHandler.post(() -> { if (finishUrlLookup(recoveryToken)) startTrack(fresh); });
                return;
            } catch (Exception unavailable) {
                boolean connected = MusicConnectivity.available(this);
                detailed = (PluginMedia.networkAllowed(this, selected)
                        ? PlaybackFailure.from(unavailable, "resolve_backup", true, connected)
                        : PlaybackFailure.of("offline").atStage("resolve_backup"))
                        .afterAttempts(detailed.diagnostic);
            }
            PlaybackFailure result = detailed;
            progressHandler.post(() -> { if (finishUrlLookup(recoveryToken)) publishError(result); });
        });
    }

    private boolean retryFailedSource(Intent failedRequest, int failedToken, PlaybackFailure failure, boolean sourceFailure) {
        if (destroyed || failedToken != generation || !MusicConnectivity.available(this) || !PluginMedia.networkAllowed(this, trackMetadata)) return false;
        if (failedRequest.getBooleanExtra("sourceRecovery", false)) return false;
        String matchedSource = matcherSource(failedRequest);
        boolean matched = !matchedSource.isEmpty();
        boolean alternate = sourceFailure && matched && SourceSettings.autoMatch(this);
        boolean prefetched = !matched && prefetchedRetry.claim(generation, failedToken,
                failedRequest.getBooleanExtra("usedPrefetchedSource", false), true);
        boolean compatible = !prefetched && !matched && sourceFailure && (remotePlayback && "netease".equals(trackMetadata.optString("playbackSource"))
                || trackMetadata.optBoolean("playbackCached") && !PluginMedia.isPlugin(trackMetadata));
        if (!prefetched && !compatible && !alternate) return false;
        // Keep the selection, queue and position; recovery never changes account or evicts a user's cache.
        final JSONObject selected;
        try { selected = new JSONObject(trackMetadata.toString()); }
        catch (Exception invalidTrack) { return false; }
        android.content.SharedPreferences saved = getSharedPreferences(PLAYBACK_PREFS,MODE_PRIVATE);
        int remembered = saved.getInt(LAST_POSITION,0);
        if (playerPrepared) try { remembered = relativePosition(); } catch (IllegalStateException expiredPlayer) { }
        final int resumePosition = remembered;
        final boolean autoPlay = desiredPlayback;
        final String cookie = SessionStore.load(this);
        cancelUrlTask(); invalidatePrefetch(); releasePlayer();
        final int retryToken = ++generation;
        playing = false;
        beginUrlLookup(retryToken, alternate ? MATCH_RECOVERY_TIMEOUT_MS : RESOLVE_TIMEOUT_MS, "source_recovery");
        saved.edit().putInt(LAST_POSITION,resumePosition).putInt("position",resumePosition)
                .remove("error").remove("errorCode").remove("errorDetail").apply();
        publish();
        urlTask = urlWorker.submit(() -> {
            try {
                PluginMedia.requireOnline(this, selected);
                if (!cookie.equals(SessionStore.load(this))) throw new java.io.IOException("登录状态已变化，请重新播放");
                Intent fresh = (prefetched ? PlaybackRequest.prepare(this, selected, autoPlay)
                        : PlaybackRequest.prepareRecovery(this, selected, autoPlay, cookie, alternate ? matchedSource : ""))
                        .putExtra("resumePosition", resumePosition);
                if (!cookie.equals(SessionStore.load(this))) throw new java.io.IOException("登录状态已变化，请重新播放");
                progressHandler.post(() -> {
                    if (!finishUrlLookup(retryToken)) return;
                    if (!cookie.equals(SessionStore.load(this))) { publishError("登录状态已变化，请重新播放"); return; }
                    startTrack(fresh);
                });
            } catch (Exception unavailable) {
                Log.w("VutronPlayback", "Playback source recovery failed: " + unavailable.getClass().getSimpleName());
                progressHandler.post(() -> {
                    if (!finishUrlLookup(retryToken)) return;
                    boolean connected = MusicConnectivity.available(this);
                    if (alternate && unavailable instanceof EmbeddedSources.NoMatch && connected && !LocalOnlyMode.enabled(this)
                            && SourceSettings.autoMatch(this) && cookie.equals(SessionStore.load(this)))
                        publishError(PlaybackFailure.noOtherMatch(matchedSource, failure));
                    else if (prefetched || alternate) publishError(PlaybackFailure.from(unavailable, "resolve", true, connected));
                    else publishError(failure);
                });
            }
        });
        return true;
    }

    private void requestSeek(int relative) {
        if (player == null || !playerPrepared) return;
        sleepStoppedAtTrackEnd=false;
        pendingSeekRelative = (int)Math.max(0, Math.min(Math.max(0, duration-1), relative));
        if (seeking) return;
        remoteProgress.pause();
        buffering = false;
        try {
            if (playing) player.pause();
            playing = false;
            cancelSegmentWatchdog();
            cancelAbLoopWatchdog();cancelSleepFade();
            seeking = true;
            appliedSeekRelative = pendingSeekRelative;
            player.seekTo(segment.absolute(appliedSeekRelative));
            armSeekDeadline(generation);
            persistPosition(); publish();
        } catch (IllegalArgumentException | IllegalStateException invalid) {
            seeking = false;
            publishError(PlaybackFailure.of("seek"));
        }
    }

    private void finishPreparedPlayback(int token) {
        if (destroyed || token != generation || player == null || !playerPrepared || seeking) return;
        if (!applyEffectiveVolume()) return;
        if (!desiredPlayback) { playing = false; persistPosition(); publish(); return; }
        if (!requestFocus()) { publishError(PlaybackFailure.of("audio_focus")); return; }
        applyTuning();
        if(!applyEffectiveVolume())return;
        if(completedGeneration==token)completedGeneration=-1;
        if (remotePlayback && !remoteProgress.active())
            remoteProgress.start(SystemClock.elapsedRealtime(), Math.max(0, player.getCurrentPosition()));
        player.start(); playing = true;
        if (!remotePlayback) confirmPlaybackStart(token, relativePosition());
        armSegmentWatchdog(token);armAbLoopWatchdog(token);refreshSleepFade(); persistPosition(); publish();
    }

    private void completeTrack(int token) {
        if(token!=generation||seeking)return;
        if(abLoop.enabled){if(desiredPlayback&&playerPrepared)requestSeek((int)abLoop.startMs);return;}
        if (completedGeneration == token) return;
        completedGeneration = token;
        remoteProgress.stop();
        cancelPlayerDeadline(); cancelSegmentWatchdog();
        cancelAbLoopWatchdog();cancelSleepFade();
        if(desiredPlayback&&sleepPlan.byTrack()) {
            PlaybackSleepPlan next=sleepPlan.completed();
            if(!next.active()){sleepStoppedAtTrackEnd=true;expireSleepPlan();return;}
            saveSleepPlan(this,next);
        }
        if (player != null && playerPrepared) try { if (player.isPlaying()) player.pause(); } catch (IllegalStateException ignored) { }
        playing = false; clearResumePosition();
        if (desiredPlayback && queue != null && queue.count() > 0) advanceQueue(true);
        else { desiredPlayback = false; publish(); }
    }

    private void armSegmentWatchdog(int token) {
        cancelSegmentWatchdog();
        if (!segment.cue || !playing) return;
        segmentWatchdog = new Runnable() {
            @Override public void run() {
                if (destroyed || generation != token || !playing || seeking || player == null) return;
                try {
                    if (player.getCurrentPosition() >= segment.start + segment.length) { completeTrack(token); return; }
                    progressHandler.postDelayed(this, 200);
                } catch (IllegalStateException expired) { publishError("分轨播放状态失效"); }
            }
        };
        progressHandler.postDelayed(segmentWatchdog, 200);
    }

    private void cancelSegmentWatchdog() {
        if (progressHandler != null && segmentWatchdog != null) progressHandler.removeCallbacks(segmentWatchdog);
        segmentWatchdog = null;
    }

    private void armAbLoopWatchdog(int token) {
        cancelAbLoopWatchdog();
        if(!abLoop.enabled||!playing||!playerPrepared||seeking||buffering)return;
        abLoopWatchdog=new Runnable(){@Override public void run(){
            if(abLoopWatchdog!=this||destroyed||token!=generation||!playing||seeking||!abLoop.enabled||player==null)return;
            try {
                int position=relativePosition();
                if(abLoop.atEnd(position)){
                    if (remoteProgress.active() && !remoteProgress.started()) sampleRemoteProgress(SystemClock.elapsedRealtime());
                    if (token == generation && playing) requestSeek((int)abLoop.startMs);
                    return;
                }
                long remaining=(long)Math.ceil((abLoop.endMs-position)/Math.max(.01f,actualSpeed));
                progressHandler.postDelayed(this,Math.max(16,Math.min(100,remaining)));
            }catch(IllegalStateException invalid){publishError(PlaybackFailure.of("seek"));}
        }};
        progressHandler.postDelayed(abLoopWatchdog,16);
    }

    private void cancelAbLoopWatchdog(){
        if(progressHandler!=null&&abLoopWatchdog!=null)progressHandler.removeCallbacks(abLoopWatchdog);
        abLoopWatchdog=null;
    }

    private long remainingTrackWallMs(){
        if(!playerPrepared||player==null)return 0;
        try{return (long)Math.ceil(Math.max(0,duration-relativePosition())/Math.max(.01f,actualSpeed));}
        catch(IllegalStateException invalid){return 0;}
    }

    private void cancelSleepFade(){
        if(progressHandler!=null&&sleepFadeScheduled)progressHandler.removeCallbacks(sleepFadeTick);
        sleepFadeScheduled=false;sleepGain=1f;
    }

    private void resetSleepFade(){
        cancelSleepFade();
        trackFadeWindowMs=Math.min(sleepPlan.fadeSeconds*1000L,remainingTrackWallMs());
    }

    private float currentSleepGain(){
        if(!desiredPlayback||!playerPrepared||seeking||waitingForAudio())return 1f;
        return sleepPlan.gain(System.currentTimeMillis(),remainingTrackWallMs(),trackFadeWindowMs);
    }

    private void refreshSleepFade(){
        float next=currentSleepGain();
        if(Math.abs(next-sleepGain)>.00001f){sleepGain=next;applyEffectiveVolume();}
        if(next<1f&&sleepPlan.active()&&playing&&!waitingForAudio()&&!seeking&&!sleepFadeScheduled){
            sleepFadeScheduled=true;progressHandler.postDelayed(sleepFadeTick,50);
        }
    }

    private int relativePosition() {
        if (seeking) return pendingSeekRelative;
        return player == null ? 0 : segment.relative(player.getCurrentPosition());
    }

    private static boolean isSupportedSource(String url) {
        if (url == null || url.trim().isEmpty()) return false;
        return url.startsWith("https://") || url.startsWith("http://")
                || url.startsWith("content://") || url.startsWith("file://")
                || new File(url).isFile();
    }

    private static JSONObject readCacheLocation(Intent intent) {
        String raw = intent.getStringExtra("cacheLocation");
        if (raw == null || raw.isEmpty()) return null;
        try { return new JSONObject(raw); }
        catch (org.json.JSONException invalid) {
            Log.w("VutronPlayback", "Could not read the resolved automatic cache location");
            return null;
        }
    }

    /** Cache and report starts only after playback, not while resolving or waiting on a remote stream. */
    private void confirmPlaybackStart(int token, int position) {
        if (destroyed || !playing || token != generation) return;
        if (cacheLocation != null && cacheEnqueuedGeneration != token) {
            cacheEnqueuedGeneration = token;
            AudioCache.enqueue(this, trackMetadata, cacheLocation);
        }
        if (pluginStartedGeneration != token && PluginMedia.isPlugin(trackMetadata)) {
            pluginStartedGeneration = token;
            lastPluginReportTime = SystemClock.elapsedRealtime(); lastPluginPlaying = true;
            PluginPlaybackReporter.report(this, trackMetadata, "start", position, duration, true);
        }
    }

    /** Keep the selected queue row's stable volume keys when its URI is resolved elsewhere. */
    private JSONObject readTrackMetadata(Intent intent, long requestedTrackId) {
        String raw = intent.getStringExtra("track");
        if (raw == null || raw.isEmpty()) raw = getSharedPreferences(PLAYBACK_PREFS, MODE_PRIVATE)
                .getString("current_track", "");
        try {
            JSONObject metadata = new JSONObject(raw == null ? "{}" : raw);
            if (metadata.optLong("id", requestedTrackId) == requestedTrackId) {
                metadata.put("id", requestedTrackId);
                return metadata;
            }
        } catch (org.json.JSONException invalid) {
            Log.w("VutronPlayback", "Could not read the current track's saved metadata", invalid);
        }
        JSONObject metadata = new JSONObject();
        try { metadata.put("id", requestedTrackId); }
        catch (org.json.JSONException impossible) { throw new IllegalArgumentException(impossible); }
        return metadata;
    }

    /** Retain provider-required request headers such as Referer and User-Agent. */
    private static Map<String, String> sourceHeaders(Intent intent) throws org.json.JSONException {
        String raw = intent.getStringExtra("sourceHeaders");
        Map<String, String> headers = new HashMap<>();
        if (raw == null || raw.trim().isEmpty()) return headers;
        JSONObject values = new JSONObject(raw);
        Iterator<String> names = values.keys();
        while (names.hasNext()) {
            String name = names.next();
            headers.put(name, values.getString(name));
        }
        return headers;
    }

    private boolean applyEffectiveVolume() {
        if (player == null || !playerPrepared) return true;
        float gain = PlaybackVolume.trackPercent(this, trackMetadata)
                * PlaybackVolume.playlistPercent(this, trackMetadata) / 10000f * focusVolume * currentSleepGain();
        try {
            player.setVolume(gain, gain);
            return true;
        } catch (IllegalStateException expired) {
            Log.w("VutronPlayback", "Could not update the current playback volume", expired);
            publishError("播放器状态已失效，请重新播放歌曲");
            return false;
        }
    }

    private boolean requestFocus() {
        focusVolume = 1f;
        if (Build.VERSION.SDK_INT >= 26) {
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                    .setOnAudioFocusChangeListener(focusListener).build();
            return audio.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        }
        return audio.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
                == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
    }

    private void pause() {
        pluginPreparation.cancel();
        remoteProgress.pause();
        buffering = false;
        invalidatePrefetch();
        cancelSegmentWatchdog();
        cancelAbLoopWatchdog();cancelSleepFade();
        resumeOnFocusGain = false;
        if (player == null) {
            cancelUrlTask();
            generation++;
            desiredPlayback = false;
            getSharedPreferences(PLAYBACK_PREFS, MODE_PRIVATE).edit()
                    .putBoolean(LAST_PLAYING, false).putBoolean("playing", false).apply();
            playing = false;
            publish();
            if (sleepTimerRemainingMs(this) <= 0L) {
                stopForeground(true);
                stopSelf();
            }
            return;
        }
        if (playerPrepared) {
            if (!seeking) cancelPlayerDeadline();
            try { if (player.isPlaying()) player.pause(); }
            catch (IllegalStateException expired) { Log.w("VutronPlayback", "Could not pause the prepared player", expired); }
        }
        playing = false;
        desiredPlayback = false;
        applyEffectiveVolume();
        persistPosition(); publish();
    }

    private void resumeOrRestore() {
        if (player != null) {
            // resume() also records intent while prepareAsync is pending.
            // Otherwise pause -> play during preparation stays paused forever.
            resume();
            return;
        }
        if (urlLookupPending || destroyed) return;
        if (queue != null && queue.count() > 0) { selectQueueTrack(true); return; }
        android.content.SharedPreferences state = getSharedPreferences(PLAYBACK_PREFS, MODE_PRIVATE);
        long savedTrackId = state.getLong(LAST_TRACK_ID, state.getLong("trackId", 0L));
        if (savedTrackId <= 0) return;
        desiredPlayback = true;
        state.edit().putBoolean(LAST_PLAYING, true).apply();
        int token = ++generation;
        beginUrlLookup(token, RESOLVE_TIMEOUT_MS, "resolve"); publish();
        urlTask = urlWorker.submit(() -> {
            try {
                Intent intent = PlaybackRequest.prepare(this, PlaybackRequest.remembered(this), true);
                progressHandler.post(() -> {
                    if (finishUrlLookup(token)) startTrack(intent);
                });
            } catch (Exception error) {
                progressHandler.post(() -> {
                    if (finishUrlLookup(token)) publishError(PlaybackFailure.from(error, "resolve", true, MusicConnectivity.available(this)));
                });
            }
        });
    }

    private void resume() {
        resumeOnFocusGain = false;
        if (remotePlayback && !PluginMedia.networkAllowed(this, trackMetadata)) { publishError("已切换为本地模式"); return; }
        desiredPlayback = true;
        if (player == null) { resumeOrRestore(); return; }
        if (!playerPrepared || seeking) { persistPosition(); return; }
        if(abLoop.enabled) {
            try {
                int position=relativePosition();
                if(position<abLoop.startMs||position>=abLoop.endMs){requestSeek((int)abLoop.startMs);return;}
            }catch(IllegalStateException invalid){publishError(PlaybackFailure.of("seek"));return;}
        }
        if(sleepStoppedAtTrackEnd) {
            sleepStoppedAtTrackEnd=false;
            // A whole-file MediaPlayer restarts after completion; a CUE player
            // is merely paused at its segment boundary and must seek back.
            if(segment.cue){requestSeek(0);return;}
        }
        if (!requestFocus()) return;
        if (!applyEffectiveVolume()) return;
        try { finishPreparedPlayback(generation); }
        catch (IllegalStateException ignored) { publishError("播放器尚未准备完成"); }
    }

    private void stopPlayback() {
        stopPlayback(false);
    }

    private void stopPlayback(boolean clearRemembered) {
        invalidatePrefetch();
        generation++;
        cancelUrlTask();
        cancelAbLoopWatchdog();cancelSleepFade();abLoop=PlaybackAbLoop.empty();
        sleepStoppedAtTrackEnd=false;
        artworkGeneration++;
        if (clearRemembered || !destroyed && sleepPlan.byTrack()) clearSleepTimer(this);
        persistPosition();
        releasePlayer(); playing = false; desiredPlayback = false; trackId = 0; duration = 0;
        resumeOnFocusGain = false;
        focusVolume = 1f;
        artwork = null; artworkUrl = "";
        if (audio != null) {
            if (Build.VERSION.SDK_INT >= 26 && focusRequest != null) audio.abandonAudioFocusRequest(focusRequest);
            else audio.abandonAudioFocus(focusListener);
        }
        publish();
        if (clearRemembered) clearRememberedPlayback();
        stopForeground(true);
    }

    private void releasePlayer() {
        if (playerPrepared && pluginStartedGeneration==generation && pluginEndedGeneration!=generation && PluginMedia.isPlugin(trackMetadata)) {
            pluginEndedGeneration=generation;
            int position;
            try {position=relativePosition();} catch(Exception expired){position=0;}
            PluginPlaybackReporter.report(this,trackMetadata,"end",position,duration,false);
        }
        cancelSegmentWatchdog();cancelAbLoopWatchdog();cancelSleepFade();cancelPlayerDeadline(); seeking = false;
        MediaPlayer old = player; player = null; playerRequest = null;
        playerPrepared = false;
        remotePlayback = false;
        buffering = false;
        remoteProgress.stop();
        cacheLocation = null;
        if (old != null) try { old.release(); } catch (RuntimeException ignored) { }
    }

    private void publishError(String message) {
        publishError(PlaybackFailure.legacy(message));
    }

    private void publishError(PlaybackFailure failure) {
        cancelUrlTask();
        playing = false;
        desiredPlayback = false;
        persistPosition();
        releasePlayer();
        getSharedPreferences(PLAYBACK_PREFS, MODE_PRIVATE).edit().putString("error", failure.message)
                .putString("errorCode", failure.code).putString("errorDetail", failure.diagnostic).apply();
        publish();
    }

    /** Persist the current media position without requiring a UI event. */
    private void persistPosition() {
        android.content.SharedPreferences preferences = getSharedPreferences(PLAYBACK_PREFS, MODE_PRIVATE);
        android.content.SharedPreferences.Editor saved = preferences.edit();
        int position = trackId == preferences.getLong(LAST_TRACK_ID, 0L) ? preferences.getInt(LAST_POSITION, 0) : 0;
        if (player != null && playerPrepared) {
            try { position = relativePosition(); } catch (IllegalStateException ignored) { }
        } else if (trackId == preferences.getLong(LAST_TRACK_ID, 0L)) {
            position = preferences.getInt(LAST_POSITION, 0);
        }
        if (trackId > 0) {
            saved.putLong(LAST_TRACK_ID, trackId).putInt(LAST_POSITION, position)
                    .putLong(LAST_DURATION, duration).putString(LAST_TITLE, title)
                    .putString(LAST_ARTIST, artist).putBoolean(LAST_PLAYING, desiredPlayback);
        }
        long now = SystemClock.elapsedRealtime();
        saved.putInt("position", position).putLong("positionElapsedRealtime", now).apply();
        if (playerPrepared) PlaylistProgress.save(this, trackMetadata, position, duration);
        if (playerPrepared && pluginStartedGeneration == generation && PluginMedia.isPlugin(trackMetadata) && (now-lastPluginReportTime>=15000 || lastPluginPlaying!=playing)) {
            lastPluginReportTime=now;lastPluginPlaying=playing;
            PluginPlaybackReporter.report(this,trackMetadata,"progress",position,duration,playing);
        }
        publication.checkpointSaved(now);
    }

    private void clearResumePosition() {
        getSharedPreferences(PLAYBACK_PREFS, MODE_PRIVATE).edit()
                .putInt(LAST_POSITION, 0).putBoolean(LAST_PLAYING, false).apply();
    }

    private void clearRememberedPlayback() {
        PlaybackQueue.clear(this);
        queue = null;
        getSharedPreferences(PLAYBACK_PREFS, MODE_PRIVATE).edit()
                .remove(LAST_TRACK_ID).remove(LAST_POSITION).remove(LAST_DURATION)
                .remove(LAST_TITLE).remove(LAST_ARTIST).remove("error").remove("current_track").putBoolean(LAST_PLAYING, false)
                .putLong("trackId", 0L).putInt("position", 0).putBoolean("playing", false)
                .apply();
    }


    private void publish() {
        int position = 0;
        if (player != null && playerPrepared) {
            try { position = relativePosition(); } catch (IllegalStateException ignored) { }
        } else if (trackId > 0) {
            position = getSharedPreferences(PLAYBACK_PREFS, MODE_PRIVATE).getInt(LAST_POSITION, 0);
        }
        boolean metadataChanged = publication.metadataChanged(trackId, title, artist, duration, artwork);
        if (session != null) {
            if (metadataChanged) {
                MediaMetadata.Builder metadata = new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title)
                        .putString(MediaMetadata.METADATA_KEY_ARTIST, artist).putLong(MediaMetadata.METADATA_KEY_DURATION, duration);
                if (artwork != null && !artwork.isRecycled()) {
                    metadata.putBitmap(MediaMetadata.METADATA_KEY_ART, artwork);
                    metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork);
                }
                session.setMetadata(metadata.build());
            }
            int state = urlLookupPending || (waitingForAudio() && playing) || seeking ? PlaybackState.STATE_BUFFERING : playing ? PlaybackState.STATE_PLAYING
                    : trackId > 0 ? PlaybackState.STATE_PAUSED : PlaybackState.STATE_STOPPED;
            session.setPlaybackState(new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
                    | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_STOP | PlaybackState.ACTION_SKIP_TO_NEXT
                    | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO)
                    .setState(state, position, playing && !waitingForAudio() ? actualSpeed : 0f, SystemClock.elapsedRealtime()).build());
        }
        getSharedPreferences(PLAYBACK_PREFS, MODE_PRIVATE).edit().putBoolean("playing", playing)
                .putFloat("playbackRate", actualSpeed).putFloat("playbackPitch",actualPitch).putString("tuningWarning",tuningWarning)
                .putBoolean("tuningApplied", playerPrepared)
                .putBoolean("loading", urlLookupPending || player != null && !playerPrepared && desiredPlayback)
                .putBoolean("buffering", waitingForAudio() && playing)
                .putLong("trackId", trackId).putString("title", title).putString("artist", artist)
                .putLong("duration", duration).putInt("position", position)
                .putLong("positionElapsedRealtime", SystemClock.elapsedRealtime())
                .putString("playbackQuality", urlLookupPending ? "" : PlaybackQuality.describe(trackMetadata))
                .putInt("trackVolumePercent", PlaybackVolume.trackPercent(this, trackMetadata))
                .putInt("playlistVolumePercent", PlaybackVolume.playlistPercent(this, trackMetadata)).apply();
        if ((trackId > 0 || playing || player != null || urlLookupPending)
                && publication.notificationChanged(playing || urlLookupPending, playing || desiredPlayback))
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification());
    }

    private Notification notification() {
        Notification.Builder builder = (Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this)).setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(title).setContentText(artist.isEmpty() ? BuildConfig.APP_DISPLAY_NAME : artist)
                .setContentIntent(PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class)
                        .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP),
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
                .setVisibility(Notification.VISIBILITY_PUBLIC).setCategory(Notification.CATEGORY_TRANSPORT)
                .setOngoing(playing || urlLookupPending).setOnlyAlertOnce(true)
                .addAction(android.R.drawable.ic_media_previous, "上一首", action(ACTION_PREVIOUS, 1))
                .addAction(playing || desiredPlayback ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                        playing || desiredPlayback ? "暂停" : "播放", action(playing || desiredPlayback ? ACTION_PAUSE : ACTION_RESUME, 2))
                .addAction(android.R.drawable.ic_media_next, "下一首", action(ACTION_NEXT, 3))
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "停止", action(ACTION_STOP, 4));
        if (artwork != null && !artwork.isRecycled()) builder.setLargeIcon(artwork);
        return builder.setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2)).build();
    }

    private String rememberedArtwork() {
        String raw = getSharedPreferences(PLAYBACK_PREFS, MODE_PRIVATE).getString("current_track", "");
        if (raw == null || raw.isEmpty()) return "";
        try {
            JSONObject metadata = new JSONObject(raw);
            String local = metadata.optString("picLocalUri", "").trim();
            if (local.isEmpty()) local = metadata.optString("coverLocalUri", "").trim();
            return local.isEmpty() ? ArtworkSource.coverUrl(metadata) : local;
        } catch (Exception ignored) { return ""; }
    }

    private void loadArtwork(String source) {
        artworkGeneration++;
        int token = artworkGeneration;
        artworkUrl = source == null ? "" : source.trim();
        artwork = null;
        if (artworkUrl.isEmpty()) { publish(); return; }
        final String requested = artworkUrl;
        final String fallback = ArtworkSource.coverUrl(trackMetadata);
        final String plugin = trackMetadata == null ? "" : trackMetadata.optString("pluginId");
        final JSONObject pluginContext = trackMetadata == null ? null : trackMetadata.optJSONObject("pluginSourceContext");
        if (plugin.isEmpty()) ArtworkCache.enqueue(this, fallback.isEmpty() ? requested : fallback);
        artworkWorker.execute(() -> {
            Bitmap decoded;
            if (!plugin.isEmpty()) {
                try { decoded = decodeArtwork(PluginArtwork.resolve(this,plugin,fallback.isEmpty()?requested:fallback,pluginContext)); }
                catch (Exception failure) { Log.w("VutronPlayback","Plugin notification artwork unavailable: "+failure.getClass().getSimpleName()); return; }
            } else {
                decoded = decodeArtwork(requested);
                if (decoded == null && !fallback.isEmpty() && !fallback.equals(requested)) decoded = decodeArtwork(fallback);
            }
            final Bitmap loaded = decoded;
            if (loaded == null || destroyed) return;
            progressHandler.post(() -> {
                if (destroyed || token != artworkGeneration) { loaded.recycle(); return; }
                artwork = loaded;
                publish();
            });
        });
    }

    private Bitmap decodeArtwork(String source) {
        HttpURLConnection connection = null;
        try {
            if (source.startsWith("https://") || source.startsWith("http://")) {
                source = ArtworkCache.resolve(this, source);
                if (source.isEmpty()) return null;
            }
            byte[] bytes;
            if (source.startsWith("data:image/")) bytes = ArtworkCache.inlineArtworkData(source);
            else if (source.startsWith("file://") || source.startsWith("content://")) {
                InputStream sourceInput = source.startsWith("file://")
                        ? new java.io.FileInputStream(new File(Uri.parse(source).getPath()))
                        : getContentResolver().openInputStream(Uri.parse(source));
                try (InputStream input = sourceInput; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    if (input == null) return null;
                    copyImage(input, output);
                    bytes = output.toByteArray();
                }
            } else if (source.startsWith("https://") || source.startsWith("http://")) {
                LocalOnlyMode.requireOnline(this);
                connection = (HttpURLConnection) new URL(ArtworkSource.requestUrl(source)).openConnection();
                artworkConnection = connection;
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(12000);
                connection.setInstanceFollowRedirects(true);
                connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36");
                connection.setRequestProperty("Referer", "https://music.163.com/");
                LocalOnlyMode.requireOnline(this);
                if (connection.getResponseCode() < 200 || connection.getResponseCode() >= 300) return null;
                try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    copyImage(input, output);
                    bytes = output.toByteArray();
                }
            } else return null;

            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = 1;
            while (bounds.outWidth / options.inSampleSize > 512 || bounds.outHeight / options.inSampleSize > 512)
                options.inSampleSize *= 2;
            options.inPreferredConfig = Bitmap.Config.RGB_565;
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        } catch (Exception ignored) { return null; }
        finally {
            if (connection != null) connection.disconnect();
            if (artworkConnection == connection) artworkConnection = null;
        }
    }

    private static void copyImage(InputStream input, ByteArrayOutputStream output) throws java.io.IOException {
        byte[] buffer = new byte[8192];
        int count;
        int total = 0;
        while ((count = input.read(buffer)) != -1) {
            total += count;
            if (total > 8 * 1024 * 1024) throw new java.io.IOException("Artwork exceeds its size limit");
            output.write(buffer, 0, count);
        }
    }

    private PendingIntent action(String action, int requestCode) {
        Intent intent = new Intent(this, AndroidPlaybackService.class).setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return PendingIntent.getForegroundService(this, requestCode, intent, flags);
        }
        return PendingIntent.getService(this, requestCode, intent, flags);
    }

    @Override public void onDestroy() {
        if (noisyReceiverRegistered) { unregisterReceiver(noisyReceiver); noisyReceiverRegistered = false; }
        invalidatePrefetch(); prefetchWorker.shutdownNow();
        destroyed = true;
        if (connectivity != null) try { connectivity.close(); } catch (RuntimeException ignored) { }
        connectivity = null;
        if (progressHandler != null) progressHandler.removeCallbacks(progressTicker);
        persistPosition();
        stopPlayback();
        pluginPreparation.close();
        urlWorker.shutdownNow();
        artworkWorker.shutdownNow();
        if (session != null) { session.setActive(false); session.release(); }
        if (activeInstance == this) activeInstance = null;
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
