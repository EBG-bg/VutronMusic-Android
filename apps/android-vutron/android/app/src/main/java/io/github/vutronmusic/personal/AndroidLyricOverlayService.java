package io.github.vutronmusic.personal;

import android.animation.ValueAnimator;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.hardware.input.InputManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.Settings;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.util.Log;
import android.view.Gravity;
import android.view.Choreographer;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;

import org.json.JSONObject;

import java.util.Objects;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Floating lyric surface for the Capacitor shell; it follows the native player's persisted clock. */
public final class AndroidLyricOverlayService extends Service {
    static final String ACTION_SHOW = "io.github.vutronmusic.personal.webshell.SHOW_LYRICS";
    static final String ACTION_HIDE = "io.github.vutronmusic.personal.webshell.HIDE_LYRICS";
    static final String ACTION_TEMPORARY_HIDE = "io.github.vutronmusic.personal.webshell.TEMPORARY_HIDE_LYRICS";
    static final String ACTION_RESTORE = "io.github.vutronmusic.personal.webshell.RESTORE_LYRICS";
    private static final String CHANNEL = "vutron_android_lyrics";
    private static final String TAG = "VutronLyricsOverlay";
    private static final String HIDDEN_UNTIL = "web_hidden_until";
    private static final long WINDOW_CHECK_MS = 2000L;
    private static volatile AndroidLyricOverlayService active;
    private static long nextServiceRecoveryAt;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService lyricWorker = Executors.newSingleThreadExecutor();
    private WindowManager windows;
    private WindowManager.LayoutParams windowParams;
    private LyricTrackLayout root;
    private TimedLyricView original;
    private TimedLyricView translation;
    private TimedLyricView nextLine;
    private LyricRepository.Lyrics lyrics;
    private long lyricTrackId;
    private long lyricGeneration;
    private final LyricVisibility visibility = new LyricVisibility();
    private long nextWindowRetryAt;
    private int windowFailures;
    private long nextValidationAt;
    private boolean loadingLyrics;
    private String lyricSongKey = "";
    private final LyricFrameClock clock = new LyricFrameClock();
    private Choreographer choreographer;
    private boolean frameScheduled;
    private long lyricDuration;
    private long lyricOffset;
    private boolean estimateWords;
    private boolean showTranslation;
    private boolean showNextLine;
    private boolean interactive;
    private boolean lastPlaying;
    private boolean destroyed;
    private int appliedStyleHash = Integer.MIN_VALUE;
    private boolean settingsRefreshScheduled;
    private String lyricTitle = "";
    private final LyricLineTransition lineTransition = new LyricLineTransition();
    private float lyricPlaybackRate = 1f;
    private LyricRepository.Lyrics previewLyrics;
    private int previewLineIndex = Integer.MIN_VALUE;
    private String previewText = "";

    /** Apply bridge previews on the next UI frame without waiting for the 100ms state poll. */
    static void refreshSettings() {
        AndroidLyricOverlayService service = active;
        if (service == null || service.destroyed) return;
        service.handler.post(() -> {
            if (service.destroyed || service.settingsRefreshScheduled) return;
            service.settingsRefreshScheduled = true;
            service.choreographer.postFrameCallback(ignored -> {
                service.settingsRefreshScheduled = false;
                if (!service.destroyed) service.updateText();
            });
        });
    }

    private final Choreographer.FrameCallback lyricFrame = frameTimeNanos -> {
        frameScheduled = false;
        if (!canAnimate()) { finishLineTransition(); return; }
        // Same separation as the original LyricLine animations: metadata is sampled
        // separately; highlighting and long-line motion advance on every display frame.
        long now = SystemClock.elapsedRealtime();
        renderLyrics(clock.positionAt(now), now);
        scheduleFrame();
    };

    private boolean canAnimate() {
        return !destroyed && lastPlaying && lyrics != null && !lyrics.original.lines.isEmpty()
                && root != null && root.isAttachedToWindow() && root.isShown()
                && interactive;
    }

    private void scheduleFrame() {
        if (choreographer == null || frameScheduled || !canAnimate()) return;
        frameScheduled = true;
        choreographer.postFrameCallback(lyricFrame);
    }

    private void stopFrames() {
        if (choreographer != null && frameScheduled) choreographer.removeFrameCallback(lyricFrame);
        frameScheduled = false;
        finishLineTransition();
        lineTransition.reset();
    }

    static boolean isRunning() {
        AndroidLyricOverlayService service = active;
        return service != null && !service.destroyed;
    }

    static long temporaryHiddenRemainingMs(Context context) {
        long deadline = context.getSharedPreferences("lyric_overlay", MODE_PRIVATE).getLong(HIDDEN_UNTIL, 0);
        return Math.max(0, deadline - System.currentTimeMillis());
    }

    static void temporaryHide(Context context, long durationMs) {
        context.getSharedPreferences("lyric_overlay", MODE_PRIVATE).edit()
                .putLong(HIDDEN_UNTIL, System.currentTimeMillis() + Math.max(1000L, Math.min(300_000L, durationMs))).apply();
        AndroidLyricOverlayService service = active;
        if (service != null && !service.destroyed) service.handler.post(() -> { service.detachWindow(); service.updateNotification(); });
    }

    static void restoreNow(Context context) {
        context.getSharedPreferences("lyric_overlay", MODE_PRIVATE).edit().remove(HIDDEN_UNTIL).apply();
        AndroidLyricOverlayService service = active;
        if (service != null && !service.destroyed) service.handler.post(() -> {
            service.visibility.preview(SystemClock.elapsedRealtime());
            service.nextWindowRetryAt = 0;
            service.updateText();
            service.updateNotification();
        });
    }

    /** Playback service restores an unexpectedly lost overlay, without resetting manual hiding. */
    static void recoverIfEnabled(Context context) {
        android.content.SharedPreferences state = context.getSharedPreferences("vutron_playback", MODE_PRIVATE);
        if (!LyricVisibility.shouldRecoverService(state.getBoolean("playing", false), state.getBoolean("loading", false))) return;
        if (isRunning() || !LyricOverlaySettings.enabled(context) || !Settings.canDrawOverlays(context)) return;
        long now = SystemClock.elapsedRealtime();
        if (now < nextServiceRecoveryAt) return;
        nextServiceRecoveryAt = now + 10_000L;
        try { androidx.core.content.ContextCompat.startForegroundService(context,
                new Intent(context, AndroidLyricOverlayService.class).setAction(ACTION_SHOW)); }
        catch (RuntimeException unavailable) { Log.w(TAG, "Overlay service recovery deferred", unavailable); }
    }

    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            if (destroyed) return;
            updateText();
            handler.postDelayed(this, 100L);
        }
    };

    private final Runnable windowCheck = new Runnable() {
        @Override public void run() {
            if (destroyed) return;
            updateText();
            if (root != null && root.isAttachedToWindow() && shouldDisplay()
                    && SystemClock.elapsedRealtime() >= nextWindowRetryAt) {
                try {
                    windows.updateViewLayout(root, windowParams);
                    root.requestLayout(); root.invalidate();
                    windowFailures = 0; nextWindowRetryAt = 0;
                } catch (RuntimeException unavailable) { retryWindow(unavailable); }
            }
            updateNotification();
            handler.postDelayed(this, WINDOW_CHECK_MS);
        }
    };

    @Override public void onCreate() {
        super.onCreate();
        active = this;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(new NotificationChannel(CHANNEL, BuildConfig.APP_DISPLAY_NAME + " 歌词", NotificationManager.IMPORTANCE_LOW));
            startForeground(1907, notification());
        }
        windows = getSystemService(WindowManager.class);
        choreographer = Choreographer.getInstance();
        handler.post(ticker);
        handler.post(windowCheck);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            android.content.SharedPreferences state = getSharedPreferences("vutron_playback", MODE_PRIVATE);
            if (!LyricVisibility.shouldRecoverService(state.getBoolean("playing", false), state.getBoolean("loading", false))) {
                stopSelf(startId);
                return START_NOT_STICKY;
            }
        }
        if (intent != null && ACTION_HIDE.equals(intent.getAction())) {
            LyricOverlaySettings.enabled(this, false);
            getSharedPreferences("lyric_overlay", MODE_PRIVATE).edit().remove(HIDDEN_UNTIL).apply();
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        if (!Settings.canDrawOverlays(this)) {
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        if (!LyricOverlaySettings.enabled(this)) { stopSelf(startId); return START_NOT_STICKY; }
        if (intent != null && ACTION_TEMPORARY_HIDE.equals(intent.getAction())) temporaryHide(this, 30_000L);
        else if (intent != null && ACTION_RESTORE.equals(intent.getAction())) restoreNow(this);
        updateText();
        return START_STICKY;
    }

    private Notification notification() {
        boolean hidden = temporaryHiddenRemainingMs(this) > 0;
        String status;
        if (hidden) status = "歌词已临时隐藏，播放中到时恢复";
        else if (!LyricOverlaySettings.locked(this)) status = "拖动调整位置；锁定后默认允许点击下方";
        else if (LyricOverlaySettings.touchPassthroughPriority(this)) status = "已锁定并优先下方点击；仍无法点击时请临时隐藏";
        else status = "已锁定并保留完整不透明度；可能阻止下方点击";
        return (Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this)).setSmallIcon(android.R.drawable.ic_menu_info_details)
                .setContentTitle(BuildConfig.APP_DISPLAY_NAME + " 桌面歌词").setContentText(status)
                .setOngoing(true).setOnlyAlertOnce(true)
                .setContentIntent(PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
                .addAction(android.R.drawable.ic_menu_view, hidden ? "立即恢复" : "恢复显示", notificationAction(ACTION_RESTORE, 11))
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "无法点击？隐藏 30 秒", notificationAction(ACTION_TEMPORARY_HIDE, 12))
                .addAction(android.R.drawable.ic_delete, "关闭歌词", notificationAction(ACTION_HIDE, 13)).build();
    }

    private PendingIntent notificationAction(String action, int request) {
        if (ACTION_TEMPORARY_HIDE.equals(action)) {
            return PendingIntent.getActivity(this, request, new Intent(this, LyricNotificationActionActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION),
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }
        return PendingIntent.getService(this, request, new Intent(this, AndroidLyricOverlayService.class).setAction(action),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void updateNotification() {
        if (!destroyed) getSystemService(NotificationManager.class).notify(1907, notification());
    }

    private boolean shouldDisplay() {
        android.content.SharedPreferences state = getSharedPreferences("vutron_playback", MODE_PRIVATE);
        long id = state.getLong("trackId", 0L);
        if (id <= 0) id = state.getLong("lastTrackId", 0L);
        long deadline = getSharedPreferences("lyric_overlay", MODE_PRIVATE).getLong(HIDDEN_UNTIL, 0);
        return visibility.visible(state.getBoolean("playing", false), state.getBoolean("loading", false), id > 0,
                SystemClock.elapsedRealtime(), System.currentTimeMillis(), deadline);
    }

    private void detachWindow() {
        stopFrames();
        if (root == null || windows == null || !root.isAttachedToWindow() && root.getParent() == null) return;
        try { windows.removeViewImmediate(root); }
        catch (RuntimeException alreadyRemoved) { Log.d(TAG, "Lyric window already detached"); }
    }

    private void retryWindow(RuntimeException unavailable) {
        windowFailures = Math.min(5, windowFailures + 1);
        nextWindowRetryAt = SystemClock.elapsedRealtime() + windowFailures * WINDOW_CHECK_MS;
        Log.w(TAG, "Lyric window temporarily unavailable; retry scheduled", unavailable);
    }

    private void ensureWindow() {
        if (SystemClock.elapsedRealtime() < nextWindowRetryAt) return;
        if (root == null) { createWindow(); return; }
        try {
            if (!root.isAttachedToWindow()) windows.addView(root, windowParams);
            root.setVisibility(View.VISIBLE);
        } catch (RuntimeException unavailable) {
            retryWindow(unavailable);
        }
    }

    private void createWindow() {
        if (root != null || windows == null) return;
        root = new LyricTrackLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        original = new TimedLyricView(this);
        translation = new TimedLyricView(this, false, true);
        nextLine = new TimedLyricView(this, true, false);
        root.addView(original, new LinearLayout.LayoutParams(-1, -2));
        root.addView(translation, new LinearLayout.LayoutParams(-1, -2));
        root.addView(nextLine, new LinearLayout.LayoutParams(-1, -2));
        root.setOnTouchListener(new DragWindow());

        int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        int flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED;
        int screenWidth = getResources().getDisplayMetrics().widthPixels;
        windowParams = new WindowManager.LayoutParams(Math.min(dp(360), Math.max(dp(180), screenWidth - dp(24))),
                -2, type, flags, PixelFormat.TRANSLUCENT);
        windowParams.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        windowParams.y = getSharedPreferences("lyric_overlay", MODE_PRIVATE).getInt("web_y", dp(112));
        windowParams.x = getSharedPreferences("lyric_overlay", MODE_PRIVATE).getInt("web_x", 0);
        applyOverlayStyle(true);
        try { windows.addView(root, windowParams); }
        catch (RuntimeException unavailable) { retryWindow(unavailable); }
    }

    private void applyOverlayStyle(boolean force) {
        if (root == null || original == null || translation == null || nextLine == null) return;
        boolean locked = LyricOverlaySettings.locked(this);
        boolean touchPriority = LyricOverlaySettings.touchPassthroughPriority(this);
        int fontSize = LyricOverlaySettings.fontSize(this);
        int playedColor = LyricOverlaySettings.playedColor(this);
        int unplayedColor = LyricOverlaySettings.unplayedColor(this);
        int backgroundColor = LyricOverlaySettings.backgroundColor(this);
        boolean shadow = LyricOverlaySettings.shadowEnabled(this);
        int shadowColor = LyricOverlaySettings.shadowColor(this);
        int shadowRadius = LyricOverlaySettings.shadowRadius(this);
        int styleHash = Objects.hash(locked, touchPriority, fontSize, playedColor, unplayedColor,
                backgroundColor, shadow, shadowColor, shadowRadius);
        if (!force && styleHash == appliedStyleHash) return;
        appliedStyleHash = styleHash;
        finishLineTransition();

        GradientDrawable background = new GradientDrawable();
        background.setColor(backgroundColor);
        background.setCornerRadius(dp(18));
        root.setBackground(background);
        root.setFadeSpace(Math.max(dp(12), Math.round(fontSize * getResources().getDisplayMetrics().scaledDensity * .55f))
                + (shadow ? dp(shadowRadius) : 0));
        original.setLyricSize(fontSize);
        translation.setLyricSize(Math.max(12, fontSize - 7));
        original.setColors(playedColor, unplayedColor);
        translation.setColors(playedColor, unplayedColor);
        original.setLyricShadow(shadow, dpFloat(shadowRadius), shadowColor);
        translation.setLyricShadow(shadow, dpFloat(shadowRadius), shadowColor);
        nextLine.setLyricSize(Math.max(13, fontSize - 5));
        nextLine.setColors(unplayedColor, unplayedColor);
        nextLine.setLyricShadow(shadow, dpFloat(shadowRadius), shadowColor);
        windowParams.flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED;
        if (locked) windowParams.flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        windowParams.alpha = locked && touchPriority ? lockedWindowOpacity() : 1f;
        if (root.isAttachedToWindow()) {
            try { windows.updateViewLayout(root, windowParams); } catch (RuntimeException ignored) { }
        }
    }

    private float lockedWindowOpacity() {
        if (Build.VERSION.SDK_INT < 31) return 1f;
        InputManager input = getSystemService(InputManager.class);
        if (input == null) {
            Log.w(TAG, "Touch opacity limit unavailable; hiding locked surface until unlocked");
            return 0f;
        }
        final float limit;
        try { limit = input.getMaximumObscuringOpacityForTouch(); }
        catch (RuntimeException unavailable) {
            Log.w(TAG, "Touch opacity limit could not be read; hiding locked surface until unlocked", unavailable);
            return 0f;
        }
        if (!Float.isFinite(limit) || limit < 0f || limit > 1f) {
            Log.w(TAG, "Invalid touch opacity limit; hiding locked surface until unlocked");
            return 0f;
        }
        return LyricOverlaySettings.windowOpacity(true, true, limit);
    }

    private void updateText() {
        if (!LyricOverlaySettings.enabled(this) || !Settings.canDrawOverlays(this)) { stopSelf(); return; }
        if (!shouldDisplay()) { detachWindow(); return; }
        ensureWindow();
        if (root == null || !root.isAttachedToWindow()) return;
        applyOverlayStyle(false);
        android.content.SharedPreferences state = getSharedPreferences("vutron_playback", MODE_PRIVATE);
        boolean playing = state.getBoolean("playing", false) && !state.getBoolean("buffering", false);
        long id = state.getLong("trackId", 0L);
        if (id <= 0) id = state.getLong("lastTrackId", 0L);
        long storedPosition = state.getInt("position", state.getInt("lastPosition", 0));
        long duration = state.getLong("duration", state.getLong("lastDuration", 0L));
        long now = SystemClock.elapsedRealtime();
        PowerManager power = getSystemService(PowerManager.class);
        interactive = power == null || power.isInteractive();
        lyricPlaybackRate = state.getFloat("playbackRate", 1f);
        clock.update(id, storedPosition, state.getLong("positionElapsedRealtime", 0L), playing, duration, now, lyricPlaybackRate);
        lastPlaying = playing;
        lyricDuration = duration;
        float animatorScale = Settings.Global.getFloat(getContentResolver(), Settings.Global.ANIMATOR_DURATION_SCALE, 1f);
        lineTransition.configure(LyricOverlaySettings.motionPreference(this), animatorScale, LyricOverlaySettings.reducedMotion(this),
                Build.VERSION.SDK_INT < 26 || ValueAnimator.areAnimatorsEnabled());
        if (!lineTransition.enabled() || !playing || !interactive) finishLineTransition();

        root.setVisibility(View.VISIBLE);

        JSONObject song = currentSong(state);
        lyricTitle = state.getString("title", "");
        if (!hasLyricText(lyricTitle)) lyricTitle = song.optString("name", "");
        lyricOffset = LyricOverlaySettings.lyricOffsetMs(this, song);
        estimateWords = LyricOverlaySettings.estimatedWordTiming(this);
        boolean nextTranslation = LyricOverlaySettings.translation(this), nextPreview = LyricOverlaySettings.nextLine(this);
        if (showTranslation != nextTranslation || showNextLine != nextPreview) {
            finishLineTransition();
            lineTransition.reset();
        }
        showTranslation = nextTranslation;
        showNextLine = nextPreview;
        String songKey = LyricOverlaySettings.trackIdentity(song) + "|" + LyricOverlaySettings.remoteLyricId(song);
        if (id != lyricTrackId || !songKey.equals(lyricSongKey)) {
            lyricSongKey = songKey;
            nextValidationAt = 0;
            loadLyricsForTrack(id, state);
        } else if (!loadingLyrics && now >= nextValidationAt) {
            nextValidationAt = now + 30_000;
            validateLyrics(song, lyricGeneration);
        }
        if (lyrics == null || lyrics.original.lines.isEmpty()) {
            showLyricRows(lyricTitle, "", "", -1, clock.positionAt(now), now, false);
            original.setProgress(0);
            stopFrames();
            return;
        }
        renderLyrics(clock.positionAt(now), now);
        if (canAnimate()) scheduleFrame();
        else stopFrames();
    }

    private void renderLyrics(long position, long now) {
        if (lyrics == null || lyrics.original.lines.isEmpty()) return;

        long effectiveTime = LyricTimeline.adjustedTime(position, lyricOffset);
        int index = lyrics.original.indexAt(effectiveTime);
        String nextText = nextLineText(index);
        if (index < 0 || index >= lyrics.original.lines.size()
                || !hasLyricText(lyrics.original.lines.get(index).text)) {
            // Loading, lead-ins and explicit instrumental rows all keep a visible title.
            showLyricRows(lyricTitle, "", nextText, -1, effectiveTime, now, true);
            original.setProgress(0);
            advanceLineTransition(now);
            return;
        }

        LyricTimeline.Line line = lyrics.original.lines.get(index);
        long nextTime = index + 1 < lyrics.original.lines.size()
                ? lyrics.original.lines.get(index + 1).time : lyricDuration;
        if (line.duration > 0) nextTime = line.time + line.duration;
        if (nextTime <= line.time) nextTime = line.time + 3000;
        String translatedText = showTranslation ? lyrics.translationAt(index) : "";
        if (!hasLyricText(translatedText)) translatedText = "";
        showLyricRows(line.text, translatedText, nextText, index, effectiveTime, now, true);
        boolean estimate = estimateWords;
        original.setProgress(line.displayCharacters(effectiveTime, nextTime, estimate));
        boolean progressive = !line.words.isEmpty() || estimate;

        if (!translatedText.isEmpty()) {
            int translatedIndex = lyrics.translation.indexAt(line.time);
            if (translatedIndex >= 0 && translatedIndex < lyrics.translation.lines.size()
                    && lyrics.translation.lines.get(translatedIndex).time == line.time
                    && lyrics.translation.lines.get(translatedIndex).text.equals(translatedText)) {
                LyricTimeline.Line translatedLine = lyrics.translation.lines.get(translatedIndex);
                long translatedEnd = translatedIndex + 1 < lyrics.translation.lines.size()
                        ? lyrics.translation.lines.get(translatedIndex + 1).time : nextTime;
                if (translatedEnd <= translatedLine.time) translatedEnd = nextTime;
                translation.setProgress(translatedLine.words.isEmpty()
                        ? progressive ? translatedText.length() * clampFraction(effectiveTime, line.time, nextTime) : translatedText.length()
                        : translatedLine.highlightedCharacters(effectiveTime, translatedEnd));
            } else {
                translation.setProgress(progressive ? translatedText.length() * clampFraction(effectiveTime, line.time, nextTime)
                        : translatedText.length());
            }
        }
        advanceLineTransition(now);
    }

    private String nextLineText(int index) {
        if (!showNextLine) return "";
        if (previewLyrics != lyrics || previewLineIndex != index) {
            previewLyrics = lyrics;
            previewLineIndex = index;
            previewText = "";
            for (int next = Math.max(0, index + 1); next < lyrics.original.lines.size(); next++) {
                String text = lyrics.original.lines.get(next).text;
                if (hasLyricText(text)) { previewText = text; break; }
            }
        }
        return previewText;
    }

    private void showLyricRows(String text, String translatedText, String nextText, int index,
                               long position, long now, boolean allowTransition) {
        boolean textChanged = !original.text.equals(text) || !translation.text.equals(translatedText)
                || !nextLine.text.equals(nextText);
        LyricLineTransition.Change change = lineTransition.show(lyrics, index, position, now, lyricPlaybackRate,
                textChanged, allowTransition && canAnimate() && hasLyricText(original.text));
        if (change == LyricLineTransition.Change.NONE) { updateRowVisibility(); return; }
        // Discard the previous outgoing snapshot before taking the next; no stacked seek ghosts.
        finishTextTransitions();
        boolean animate = change == LyricLineTransition.Change.SCROLL;
        original.setLyricText(text, animate);
        translation.setLyricText(translatedText, animate);
        nextLine.setLyricText(nextText, animate);
        updateRowVisibility();
        root.invalidate();
    }

    private void advanceLineTransition(long now) {
        if (!lineTransition.running()) return;
        if (!lineTransition.advance(now)) { finishTextTransitions(); return; }
        root.invalidate();
    }

    private void finishLineTransition() {
        lineTransition.finish();
        finishTextTransitions();
    }

    private void finishTextTransitions() {
        if (original != null) original.finishTextTransition();
        if (translation != null) translation.finishTextTransition();
        if (nextLine != null) nextLine.finishTextTransition();
        updateRowVisibility();
        if (root != null) root.invalidate();
    }

    private void updateRowVisibility() {
        // Keep slots through untranslated/instrumental/last rows; toggling a setting is an explicit layout change.
        if (translation != null) translation.setVisibility(showTranslation && lyrics != null
                && !lyrics.translation.lines.isEmpty() ? View.VISIBLE : View.GONE);
        if (nextLine != null) nextLine.setVisibility(showNextLine && lyrics != null
                && !lyrics.original.lines.isEmpty() ? View.VISIBLE : View.GONE);
    }

    private static boolean hasLyricText(String text) {
        if (text == null) return false;
        for (int offset = 0; offset < text.length();) {
            int point = text.codePointAt(offset);
            if (!Character.isWhitespace(point) && !Character.isSpaceChar(point)) return true;
            offset += Character.charCount(point);
        }
        return false;
    }

    private void loadLyricsForTrack(long id, android.content.SharedPreferences state) {
        lyricTrackId = id;
        lyrics = null;
        stopFrames();
        previewLyrics = null;
        previewLineIndex = Integer.MIN_VALUE;
        previewText = "";
        long generation = ++lyricGeneration;
        JSONObject song = currentSong(state);
        loadingLyrics = true;
        nextValidationAt = SystemClock.elapsedRealtime() + 30_000;
        lyricWorker.execute(() -> {
            try {
                LyricRepository.Lyrics loaded = LyricRepository.loadForTrack(this, song);
                long remoteId = LyricOverlaySettings.remoteLyricId(song);
                if (!loaded.local && remoteId > 0 && LyricRepository.hasValidationWifi(this)) {
                    try {
                        LyricRepository.Lyrics refreshed = LyricRepository.revalidateOnWifi(this, remoteId);
                        if (refreshed != null) loaded = refreshed;
                    } catch (java.io.IOException deferred) { Log.d(TAG, "Wi-Fi lyric refresh deferred; keeping cached lyrics"); }
                }
                LyricRepository.Lyrics result = loaded;
                handler.post(() -> {
                    if (!destroyed && generation == lyricGeneration) { lyrics = result; loadingLyrics = false; }
                });
            } catch (Exception unavailable) {
                Log.w(TAG, "Lyrics unavailable: " + unavailable.getClass().getSimpleName());
                handler.post(() -> { if (generation == lyricGeneration) loadingLyrics = false; });
            }
        });
    }

    private void validateLyrics(JSONObject song, long generation) {
        long id = LyricOverlaySettings.remoteLyricId(song);
        if (id <= 0 || lyrics != null && lyrics.local || !LyricOverlaySettings.wifiValidation(this) || !LyricRepository.hasValidationWifi(this)) return;
        loadingLyrics = true;
        lyricWorker.execute(() -> {
            try {
                LyricRepository.Lyrics refreshed = LyricRepository.revalidateOnWifi(this, id);
                handler.post(() -> {
                    if (!destroyed && generation == lyricGeneration) {
                        if (refreshed != null) lyrics = refreshed;
                        loadingLyrics = false;
                    }
                });
            } catch (java.io.IOException unavailable) {
                Log.d(TAG, "Wi-Fi lyric validation deferred; keeping offline copy");
                handler.post(() -> { if (generation == lyricGeneration) loadingLyrics = false; });
            }
        });
    }

    private static float clampFraction(long position, long start, long end) {
        if (end <= start) return 0f;
        return Math.max(0f, Math.min(1f, (float) (position - start) / (end - start)));
    }

    private JSONObject currentSong(android.content.SharedPreferences state) {
        try { return new JSONObject(state.getString("current_track", "{}")); }
        catch (Exception ignored) { return new JSONObject(); }
    }

    @Override public void onDestroy() {
        destroyed = true;
        stopFrames();
        lyricGeneration++;
        handler.removeCallbacks(ticker);
        handler.removeCallbacks(windowCheck);
        lyricWorker.shutdownNow();
        if (root != null && windows != null) try { windows.removeView(root); } catch (RuntimeException ignored) { }
        root = null;
        if (active == this) active = null;
        stopForeground(true);
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private float dpFloat(int value) { return value * getResources().getDisplayMetrics().density; }

    private final class DragWindow implements View.OnTouchListener {
        private float downX, downY;
        private int startX, startY;
        private boolean moved;

        @Override public boolean onTouch(View view, MotionEvent event) {
            if (LyricOverlaySettings.locked(AndroidLyricOverlayService.this)) return false;
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downX = event.getRawX(); downY = event.getRawY();
                    startX = windowParams.x; startY = windowParams.y; moved = false;
                    return true;
                case MotionEvent.ACTION_MOVE:
                    float dx = event.getRawX() - downX, dy = event.getRawY() - downY;
                    if (Math.abs(dx) + Math.abs(dy) > dp(4)) moved = true;
                    if (moved) {
                        windowParams.x = startX + Math.round(dx);
                        windowParams.y = Math.max(0, startY + Math.round(dy));
                        try { windows.updateViewLayout(root, windowParams); } catch (RuntimeException ignored) { }
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                    if (moved) getSharedPreferences("lyric_overlay", MODE_PRIVATE).edit()
                            .putInt("web_x", windowParams.x).putInt("web_y", windowParams.y).apply();
                    return true;
                default: return true;
            }
        }
    }

    /** Clip and soften the whole lyric track, never the individual moving rows. */
    private final class LyricTrackLayout extends LinearLayout {
        private final Paint edgeMask = new Paint();
        private int fadeSpace;

        LyricTrackLayout(Context context) {
            super(context);
            setClipChildren(false);
            setClipToPadding(false);
            edgeMask.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.DST_IN));
        }

        void setFadeSpace(int pixels) {
            if (fadeSpace == pixels) return;
            fadeSpace = pixels;
            setPadding(dp(16), pixels + dp(4), dp(16), pixels + dp(4));
            rebuildMask();
        }

        private void rebuildMask() {
            if (getHeight() <= 0) return;
            float edge = Math.min(.45f, (float) fadeSpace / getHeight());
            edgeMask.setShader(new LinearGradient(0, 0, 0, getHeight(),
                    new int[]{Color.TRANSPARENT, Color.WHITE, Color.WHITE, Color.TRANSPARENT},
                    new float[]{0f, edge, 1f - edge, 1f}, Shader.TileMode.CLAMP));
        }

        @Override protected void onSizeChanged(int width, int height, int oldWidth, int oldHeight) {
            super.onSizeChanged(width, height, oldWidth, oldHeight);
            rebuildMask();
        }

        float travel() { return Math.max(1, getHeight() - getPaddingTop() - getPaddingBottom()); }

        @Override protected void dispatchDraw(Canvas canvas) {
            if (!lineTransition.running()) { drawRows(canvas, false); return; }
            int save = canvas.saveLayer(0, 0, getWidth(), getHeight(), null);
            drawPhase(canvas, true);
            drawPhase(canvas, false);
            canvas.drawRect(0, 0, getWidth(), getHeight(), edgeMask);
            canvas.restoreToCount(save);
        }

        private void drawPhase(Canvas canvas, boolean outgoing) {
            float progress = lineTransition.progress();
            float opacity = outgoing ? LyricLineTransition.outgoingOpacity(progress) : LyricLineTransition.incomingOpacity(progress);
            if (opacity <= 0f) return;
            // Composite the entire sentence group so explicit shadow alpha fades with the glyphs.
            int save = canvas.saveLayerAlpha(0, 0, getWidth(), getHeight(), Math.round(opacity * 255));
            canvas.translate(0, outgoing ? LyricLineTransition.outgoingOffset(progress, travel())
                    : LyricLineTransition.incomingOffset(progress, travel()));
            drawRows(canvas, outgoing);
            canvas.restoreToCount(save);
        }

        private void drawRows(Canvas canvas, boolean outgoing) {
            original.drawRow(canvas, outgoing);
            translation.drawRow(canvas, outgoing);
            nextLine.drawRow(canvas, outgoing);
        }
    }

    /** Smoothly reveals timed text and scrolls long lines to keep the active words visible. */
    private final class TimedLyricView extends View {
        private final TextPaint textPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
        private String text = "";
        private StaticLayout layout;
        private StaticLayout outgoingLayout;
        private float outgoingProgress;
        private boolean transitioning;
        private float progress;
        private float textSizePx;
        private int playedColor = LyricOverlaySettings.DEFAULT_PLAYED_COLOR;
        private int unplayedColor = LyricOverlaySettings.DEFAULT_UNPLAYED_COLOR;
        private int lastContentWidth = -1;
        private final Path reveal = new Path();
        private final boolean preview;
        private final boolean translated;
        private LyricRepository.Lyrics capacityLyrics;
        private int capacityWidth = -1;
        private int capacityHeight;

        TimedLyricView(Context context) {
            this(context, false, false);
        }

        TimedLyricView(Context context, boolean preview, boolean translated) {
            super(context);
            this.preview = preview;
            this.translated = translated;
            textPaint.setTypeface(Typeface.create("sans-serif", preview ? Typeface.NORMAL : Typeface.BOLD));
            setPadding(0, dp(3), 0, dp(3));
            setWillNotDraw(false);
        }

        void setLyricText(String value, boolean animate) {
            String next = value == null ? "" : value;
            boolean changed = !text.equals(next);
            if (changed && lyrics == null) capacityWidth = -1;
            boolean needsMeasure = capacityLyrics != lyrics || capacityWidth < 0;
            if (needsMeasure) requestLayout();
            if (!changed && !animate) return;
            if (animate) {
                ensureLayout(getWidth() - getPaddingLeft() - getPaddingRight());
                outgoingLayout = layout;
                outgoingProgress = progress;
                transitioning = outgoingLayout != null || hasLyricText(next);
            }
            text = next;
            setContentDescription(next);
            progress = 0;
            if (changed) {
                layout = null;
                lastContentWidth = -1;
            }
            invalidate();
        }

        void finishTextTransition() {
            if (!transitioning) return;
            outgoingLayout = null;
            transitioning = false;
            invalidate();
        }

        void setLyricSize(int sp) {
            float next = sp * getResources().getDisplayMetrics().scaledDensity;
            if (textSizePx == next) return;
            textSizePx = next;
            textPaint.setTextSize(next);
            layout = null;
            lastContentWidth = -1;
            capacityWidth = -1;
            requestLayout();
            invalidate();
        }

        void setColors(int played, int unplayed) {
            playedColor = played;
            unplayedColor = unplayed;
            invalidate();
        }

        void setLyricShadow(boolean enabled, float radius, int color) {
            if (enabled && radius > 0) textPaint.setShadowLayer(radius, 0, dp(1), color);
            else textPaint.clearShadowLayer();
            invalidate();
        }

        void setProgress(float value) {
            float next = Math.max(0f, Math.min(text.length(), value));
            if (Math.abs(progress - next) < .0001f) return;
            progress = next;
            if (root != null) root.invalidate();
        }

        private void ensureLayout(int contentWidth) {
            if (contentWidth <= 0 || text.isEmpty()) { layout = null; return; }
            if (layout != null && contentWidth == lastContentWidth) return;
            layout = buildTextLayout(text, contentWidth);
            lastContentWidth = contentWidth;
        }

        private StaticLayout buildTextLayout(String value, int contentWidth) {
            int layoutWidth = contentWidth;
            if (!preview && value.indexOf('\n') < 0) layoutWidth = Math.max(contentWidth, (int) Math.ceil(textPaint.measureText(value)));
            return StaticLayout.Builder.obtain(value, 0, value.length(), textPaint, layoutWidth)
                    .setAlignment(Layout.Alignment.ALIGN_CENTER)
                    .setIncludePad(false)
                    .setBreakStrategy(android.graphics.text.LineBreaker.BREAK_STRATEGY_SIMPLE)
                    .setHyphenationFrequency(Layout.HYPHENATION_FREQUENCY_NONE)
                    .build();
        }

        private void ensureCapacity(int contentWidth) {
            if (capacityLyrics == lyrics && capacityWidth == contentWidth) return;
            capacityLyrics = lyrics;
            capacityWidth = contentWidth;
            capacityHeight = buildTextLayout("Ag", contentWidth).getHeight();
            if (layout != null) capacityHeight = Math.max(capacityHeight, layout.getHeight());
            if (lyrics == null) return;
            // One scan per track/font/width. No outgoing/current max or shrinking at sentence boundaries.
            LyricTimeline timeline = translated ? lyrics.translation : lyrics.original;
            for (LyricTimeline.Line line : timeline.lines) {
                if (hasLyricText(line.text)) capacityHeight = Math.max(capacityHeight, buildTextLayout(line.text, contentWidth).getHeight());
            }
            if (!preview && !translated && hasLyricText(lyricTitle)) {
                capacityHeight = Math.max(capacityHeight, buildTextLayout(lyricTitle, contentWidth).getHeight());
            }
        }

        @Override protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
            int width = MeasureSpec.getSize(widthMeasureSpec);
            if (MeasureSpec.getMode(widthMeasureSpec) == MeasureSpec.UNSPECIFIED) width = dp(320);
            int contentWidth = Math.max(1, width - getPaddingLeft() - getPaddingRight());
            ensureLayout(contentWidth);
            ensureCapacity(contentWidth);
            int height = capacityHeight + getPaddingTop() + getPaddingBottom();
            setMeasuredDimension(resolveSize(width, widthMeasureSpec), resolveSize(height, heightMeasureSpec));
        }

        @Override protected void onSizeChanged(int width, int height, int oldWidth, int oldHeight) {
            super.onSizeChanged(width, height, oldWidth, oldHeight);
            if (oldWidth > 0 && width != oldWidth) finishLineTransition();
        }

        @Override protected void onDetachedFromWindow() {
            stopFrames();
            super.onDetachedFromWindow();
        }

        void drawRow(Canvas canvas, boolean outgoing) {
            if (getVisibility() != View.VISIBLE) return;
            int viewportWidth = getWidth() - getPaddingLeft() - getPaddingRight();
            ensureLayout(viewportWidth);
            StaticLayout textLayout = outgoing ? outgoingLayout : layout;
            if (textLayout == null) return;
            int save = canvas.save();
            canvas.translate(getLeft(), getTop());
            // One parent clip and one common offset; no per-row vertical clipping or centering.
            canvas.clipRect(getPaddingLeft(), -root.getHeight(), getWidth() - getPaddingRight(), root.getHeight() * 2f);
            drawTextLayout(canvas, textLayout, outgoing ? outgoingProgress : progress);
            canvas.restoreToCount(save);
        }

        private void drawTextLayout(Canvas canvas, StaticLayout textLayout, float characterPosition) {
            int viewportWidth = getWidth() - getPaddingLeft() - getPaddingRight();
            float scroll = 0;
            if (textLayout.getWidth() > viewportWidth) {
                float focus = horizontalAt(textLayout, characterPosition);
                scroll = Math.max(0f, Math.min(textLayout.getWidth() - viewportWidth, focus - viewportWidth / 2f));
            }
            int save = canvas.save();
            canvas.translate(getPaddingLeft() - scroll, getPaddingTop());
            textPaint.setColor(unplayedColor);
            textLayout.draw(canvas);
            Path reveal = revealPath(textLayout, characterPosition);
            if (reveal != null && !reveal.isEmpty()) {
                int revealSave = canvas.save();
                canvas.clipPath(reveal);
                textPaint.setColor(playedColor);
                textLayout.draw(canvas);
                canvas.restoreToCount(revealSave);
            }
            canvas.restoreToCount(save);
        }

        private Path revealPath(StaticLayout textLayout, float characterPosition) {
            CharSequence text = textLayout.getText();
            int length = text.length();
            if (length == 0 || characterPosition <= 0) return null;
            Path path = reveal;
            path.rewind();
            if (characterPosition >= length) {
                path.addRect(0, 0, textLayout.getWidth(), textLayout.getHeight(), Path.Direction.CW);
                return path;
            }
            int index = (int) characterPosition;
            if (index > 0 && index < length && Character.isHighSurrogate(text.charAt(index - 1))
                    && Character.isLowSurrogate(text.charAt(index))) index--;
            int line = textLayout.getLineForOffset(index);
            for (int i = 0; i < line; i++) path.addRect(0, textLayout.getLineTop(i),
                    textLayout.getWidth(), textLayout.getLineBottom(i), Path.Direction.CW);
            float edge = horizontalAt(textLayout, characterPosition);
            float top = textLayout.getLineTop(line), bottom = textLayout.getLineBottom(line);
            if (textLayout.getParagraphDirection(line) >= 0) path.addRect(0, top, Math.max(0, edge), bottom, Path.Direction.CW);
            else path.addRect(Math.min(textLayout.getWidth(), edge), top, textLayout.getWidth(), bottom, Path.Direction.CW);
            return path;
        }

        private float horizontalAt(StaticLayout textLayout, float characterPosition) {
            CharSequence text = textLayout.getText();
            float bounded = Math.max(0f, Math.min(text.length(), characterPosition));
            int first = (int) bounded;
            if (first >= text.length()) return textLayout.getPrimaryHorizontal(text.length());
            if (first > 0 && Character.isLowSurrogate(text.charAt(first)) && Character.isHighSurrogate(text.charAt(first - 1))) first--;
            int end = first + Character.charCount(Character.codePointAt(text, first));
            float fraction = (bounded - first) / (end - first);
            float startX = textLayout.getPrimaryHorizontal(first), endX = textLayout.getPrimaryHorizontal(end);
            if (textLayout.getLineForOffset(first) != textLayout.getLineForOffset(end)) {
                int line = textLayout.getLineForOffset(first);
                endX = textLayout.getParagraphDirection(line) >= 0 ? textLayout.getLineRight(line) : textLayout.getLineLeft(line);
            }
            return startX + (endX - startX) * fraction;
        }
    }
}
