package io.github.vutronmusic.personal;

import android.app.Activity;
import android.os.Bundle;

/** Direct notification target: Android dismisses the shade without a service trampoline. */
public final class LyricNotificationActionActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        AndroidLyricOverlayService.temporaryHide(this, LyricVisibility.TEMPORARY_HIDE_MS);
        finish();
    }
}
