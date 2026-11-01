package io.github.vutronmusic.personal;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 7001;
    private static final String APPEARANCE_PREFERENCES = "vutron_system_appearance";

    @Override protected void onCreate(android.os.Bundle state) {
        registerPlugin(VutronMusicPlugin.class);
        super.onCreate(state);
        restoreSystemAppearance();
        if (android.os.Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
        }
    }

    @Override public void onResume() {
        super.onResume();
        restoreSystemAppearance();
        if (!android.provider.Settings.canDrawOverlays(this)) return;
        android.content.SharedPreferences preferences = getSharedPreferences("lyric_overlay", MODE_PRIVATE);
        boolean pending = preferences.getBoolean("pending_enable", false);
        if (!pending && !LyricOverlaySettings.enabled(this)) return;
        preferences.edit().putBoolean("pending_enable", false).apply();
        LyricOverlaySettings.enabled(this, true);
        androidx.core.content.ContextCompat.startForegroundService(this,
                new android.content.Intent(this, AndroidLyricOverlayService.class)
                        .setAction(AndroidLyricOverlayService.ACTION_SHOW));
    }

    /** Called on the UI thread with the resolved Vue theme. */
    void setSystemAppearance(boolean dark) {
        getSharedPreferences(APPEARANCE_PREFERENCES, MODE_PRIVATE).edit().putBoolean("dark", dark).apply();
        applySystemAppearance(dark);
    }

    private void restoreSystemAppearance() {
        boolean systemDark = (getResources().getConfiguration().uiMode
                & android.content.res.Configuration.UI_MODE_NIGHT_MASK)
                == android.content.res.Configuration.UI_MODE_NIGHT_YES;
        applySystemAppearance(getSharedPreferences(APPEARANCE_PREFERENCES, MODE_PRIVATE).getBoolean("dark", systemDark));
    }

    @SuppressWarnings("deprecation")
    private void applySystemAppearance(boolean dark) {
        android.view.Window window = getWindow();
        int background = dark ? android.graphics.Color.rgb(34, 34, 34) : android.graphics.Color.WHITE;
        // Capacitor keeps system-bar/cutout margins around the WebView. The
        // native surface behind those margins must also follow the page theme.
        window.getDecorView().setBackgroundColor(background);
        androidx.core.view.WindowInsetsControllerCompat bars =
                androidx.core.view.WindowCompat.getInsetsController(window, window.getDecorView());
        bars.setAppearanceLightStatusBars(!dark);
        bars.setAppearanceLightNavigationBars(!dark);
        if (android.os.Build.VERSION.SDK_INT < 35) {
            window.setStatusBarColor(background);
            window.setNavigationBarColor(background);
        }
    }
}
