package io.github.vutronmusic.personal;

import android.app.Activity;
import android.app.Dialog;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Looper;
import android.text.InputFilter;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.Arrays;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/** Native, non-persistent input for an account backup. Only call from the library worker. */
final class BackupPasswordPrompt {
    private BackupPasswordPrompt() { }

    static char[] request(Activity activity, boolean creating, String language) throws InterruptedException {
        if (Looper.myLooper() == Looper.getMainLooper()) throw new IllegalStateException("Password prompt requires a worker");
        CountDownLatch finished = new CountDownLatch(1);
        AtomicBoolean closed = new AtomicBoolean();
        AtomicReference<Dialog> visible = new AtomicReference<>();
        AtomicReference<char[]> result = new AtomicReference<>();
        if (activity == null) throw new CancellationException();
        activity.runOnUiThread(() -> {
            if (closed.get() || activity.isFinishing() || activity.isDestroyed()) { finished.countDown(); return; }
            Dialog dialog = build(activity, creating, language, result);
            visible.set(dialog);
            dialog.setOnDismissListener(ignored -> finished.countDown());
            try { dialog.show(); }
            catch (WindowManager.BadTokenException unavailable) { finished.countDown(); }
        });
        try {
            while (!finished.await(300, TimeUnit.MILLISECONDS)) {
                if (activity.isFinishing() || activity.isDestroyed()) throw new CancellationException();
            }
            char[] value = result.getAndSet(null);
            if (value == null) throw new CancellationException();
            return value;
        } finally {
            closed.set(true);
            activity.runOnUiThread(() -> {
                Dialog dialog = visible.getAndSet(null);
                if (dialog != null && dialog.isShowing()) dialog.dismiss();
                char[] abandoned = result.getAndSet(null);
                if (abandoned != null) Arrays.fill(abandoned, '\0');
            });
        }
    }

    private static Dialog build(Activity activity, boolean creating, String language, AtomicReference<char[]> result) {
        boolean en = "en".equals(language), hant = "zht".equals(language);
        boolean night = (activity.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        boolean dark = activity.getSharedPreferences("vutron_system_appearance", Activity.MODE_PRIVATE).getBoolean("dark", night);
        int surface = dark ? 0xff232529 : Color.WHITE, ink = dark ? 0xfff2f4f6 : 0xff222529;
        int muted = dark ? 0xffc3c6ca : 0xff52565a, field = dark ? 0xff35383c : 0xffeff1f2, accent = dark ? 0xff6bd8d3 : 0xff007873;
        Dialog dialog = new Dialog(activity, dark ? android.R.style.Theme_Material_Dialog_NoActionBar : android.R.style.Theme_Material_Light_Dialog_NoActionBar);
        Window window = dialog.getWindow();
        window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE | WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
        ScrollView scroll = new ScrollView(dialog.getContext());
        scroll.setBackground(rounded(surface, dp(activity, 22)));
        LinearLayout panel = new LinearLayout(dialog.getContext());
        panel.setOrientation(LinearLayout.VERTICAL);
        int inset = dp(activity, 22);
        panel.setPadding(inset, inset, inset, inset);
        scroll.addView(panel);
        TextView title = new TextView(dialog.getContext());
        title.setText(creating ? en ? "Set backup password" : hant ? "設定備份密碼" : "设置备份密码" : en ? "Unlock backup" : hant ? "解鎖帳號備份" : "解锁账号备份");
        title.setTextSize(19); title.setTextColor(ink); title.setTypeface(Typeface.DEFAULT, Typeface.BOLD); panel.addView(title);
        TextView hint = new TextView(dialog.getContext());
        hint.setText(creating ? en ? "Use at least 8 characters. You’ll need this password to restore your accounts." : hant ? "至少 8 個字元。恢復帳號時需要這組密碼。" : "至少 8 个字符。恢复账号时需要这组密码。" : en ? "Enter the password used to export these accounts." : hant ? "請輸入匯出帳號時設定的密碼。" : "请输入导出账号时设置的密码。");
        hint.setTextColor(muted); hint.setTextSize(14); gap(panel, hint, 8);
        EditText first = password(panel, en ? "Backup password" : hant ? "備份密碼" : "备份密码", ink, muted, field);
        EditText repeated = creating ? password(panel, en ? "Confirm password" : hant ? "確認密碼" : "确认密码", ink, muted, field) : null;
        first.setImeOptions(first.getImeOptions() | (creating ? EditorInfo.IME_ACTION_NEXT : EditorInfo.IME_ACTION_DONE));
        if (repeated != null) repeated.setImeOptions(repeated.getImeOptions() | EditorInfo.IME_ACTION_DONE);
        LinearLayout actions = new LinearLayout(dialog.getContext());
        actions.setGravity(Gravity.END); gap(panel, actions, 16);
        Button cancel = button(actions, en ? "Cancel" : "取消", muted, field);
        cancel.setOnClickListener(v -> dialog.cancel());
        Button confirm = button(actions, creating ? en ? "Continue" : hant ? "繼續" : "继续" : en ? "Unlock" : hant ? "解鎖" : "解锁", dark ? Color.BLACK : Color.WHITE, accent);
        confirm.setOnClickListener(v -> {
            char[] chars = characters(first);
            char[] again = repeated == null ? null : characters(repeated);
            if (chars.length < BackupAccountCipher.MIN_PASSWORD) {
                Arrays.fill(chars, '\0'); first.setError(en ? "Use at least 8 characters" : hant ? "至少 8 個字元" : "至少 8 个字符"); first.requestFocus();
            } else if (again != null && !Arrays.equals(chars, again)) {
                Arrays.fill(chars, '\0'); repeated.setError(en ? "Passwords do not match" : hant ? "兩次密碼不同" : "两次密码不同"); repeated.requestFocus();
            } else {
                result.set(chars); dialog.dismiss();
            }
            if (again != null) Arrays.fill(again, '\0');
        });
        (repeated == null ? first : repeated).setOnEditorActionListener((v, action, event) -> {
            if (action != EditorInfo.IME_ACTION_DONE) return false;
            confirm.performClick(); return true;
        });
        dialog.setContentView(scroll);
        scroll.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener() {
            @Override public void onViewAttachedToWindow(View v) { }
            @Override public void onViewDetachedFromWindow(View v) {
                first.getText().clear(); if (repeated != null) repeated.getText().clear();
            }
        });
        int available = activity.getWindow().getDecorView().getWidth();
        if (available <= 0) available = activity.getResources().getDisplayMetrics().widthPixels;
        window.setLayout(Math.min(dp(activity, 440), Math.max(dp(activity, 180), available - dp(activity, 40))), WindowManager.LayoutParams.WRAP_CONTENT);
        first.requestFocus();
        return dialog;
    }

    private static char[] characters(EditText field) {
        char[] chars = new char[field.length()]; field.getText().getChars(0, chars.length, chars, 0); return chars;
    }
    private static EditText password(LinearLayout parent, String label, int ink, int muted, int surface) {
        EditText field = new EditText(parent.getContext());
        field.setSingleLine(true); field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        field.setSaveEnabled(false); field.setSaveFromParentEnabled(false); field.setFreezesText(false);
        if (Build.VERSION.SDK_INT >= 26) {
            field.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
            field.setImeOptions(EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING);
        }
        field.setFilters(new InputFilter[]{new InputFilter.LengthFilter(BackupAccountCipher.MAX_PASSWORD)});
        field.setHint(label); field.setTextSize(16); field.setTextColor(ink); field.setHintTextColor(muted);
        field.setTypeface(Typeface.DEFAULT); field.setMinHeight(dp(parent.getContext(), 48));
        field.setBackground(rounded(surface, dp(parent.getContext(), 11)));
        field.setPadding(dp(parent.getContext(), 12), 0, dp(parent.getContext(), 12), 0); gap(parent, field, 10); return field;
    }
    private static Button button(LinearLayout parent, String label, int ink, int surface) {
        Button b = new Button(parent.getContext()); b.setText(label); b.setTextColor(ink); b.setAllCaps(false); b.setTextSize(15);
        b.setBackground(rounded(surface, dp(parent.getContext(), 12))); b.setMinHeight(dp(parent.getContext(), 44));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-2, -2); params.setMarginStart(dp(parent.getContext(), 8)); parent.addView(b, params); return b;
    }
    private static void gap(LinearLayout parent, View child, int top) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = dp(parent.getContext(), top); parent.addView(child, params);
    }
    private static GradientDrawable rounded(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable(); drawable.setColor(color); drawable.setCornerRadius(radius); return drawable;
    }
    private static int dp(android.content.Context context, int value) { return Math.round(context.getResources().getDisplayMetrics().density * value); }
}
