package com.thedev.lockin;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.text.DateFormat;
import java.util.Date;

public class MainActivity extends Activity {
    private static final String CONFIRM_PHRASE = "I COMMIT FOR ONE YEAR";

    private LockPolicy policy;
    private LinearLayout root;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        policy = new LockPolicy(this);
        ScrollView scroll = new ScrollView(this);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(20);
        root.setPadding(pad, pad, pad, pad);
        scroll.addView(root);
        setContentView(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        render();
    }

    private void render() {
        root.removeAllViews();
        title("LockIn");
        if (!policy.isDeviceOwner()) {
            renderSetup();
        } else if (policy.isLocked()) {
            renderLocked();
        } else {
            renderReady();
        }
    }

    private void renderSetup() {
        text("Setup needed. LockIn has to be the phone's device owner, which you can only set from a computer:");
        text("1. Remove every account from this phone for now (Settings > Accounts, including Google and Samsung). You can add them back afterwards.\n"
                + "2. Turn on Developer options and USB debugging.\n"
                + "3. Connect the phone to a computer and run:");
        mono("adb shell dpm set-device-owner com.thedev.lockin/.AdminReceiver");
        text("4. Open LockIn again.");
    }

    private void renderReady() {
        text("When you activate, for 365 days:");
        text("• All internet traffic uses the CleanBrowsing Family DNS filter, which blocks porn, proxies and VPN sites and forces SafeSearch.\n"
                + "• Chrome blocks adult sites and has incognito mode and its own secure DNS switched off.\n"
                + "• You can't change Private DNS, VPN or date and time settings.\n"
                + "• You can't factory reset from Settings, boot into safe mode, add users or use USB debugging.\n"
                + "• LockIn can't be uninstalled or turned off.");
        text("There is no unlock code. The lock lifts only after 365 days, checked against internet time, so changing the phone's clock won't work.");
        text("Type \"" + CONFIRM_PHRASE + "\" to confirm:");
        EditText confirm = new EditText(this);
        confirm.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        root.addView(confirm);
        Button activate = button("Activate 1-year lock");
        activate.setOnClickListener(v -> {
            if (!CONFIRM_PHRASE.equals(confirm.getText().toString().trim())) {
                toastDialog("The phrase doesn't match.");
                return;
            }
            activate.setEnabled(false);
            activate.setText("Activating…");
            new Thread(() -> {
                long now = TrustedClock.now(policy.prefs());
                String error = now < 0
                        ? "Couldn't reach the internet to get the real time. Connect and try again."
                        : policy.activate(now);
                main.post(() -> {
                    if (error != null) toastDialog(error);
                    render();
                });
            }).start();
        });
        Button remove = button("Remove LockIn (only works before activation)");
        remove.setOnClickListener(v -> {
            policy.removeBeforeActivation();
            render();
        });
    }

    private void renderLocked() {
        long unlockAt = policy.unlockAt();
        long daysLeft = Math.max(0, (unlockAt - System.currentTimeMillis() + 86_399_999L) / 86_400_000L);
        TextView big = text(daysLeft + " days left");
        big.setTextSize(TypedValue.COMPLEX_UNIT_SP, 34);
        big.setGravity(Gravity.CENTER);
        text("Locked. It unlocks on " + DateFormat.getDateInstance(DateFormat.LONG).format(new Date(unlockAt))
                + ", checked against internet time.");
        Button check = button("Check if the year is over");
        check.setOnClickListener(v -> {
            check.setEnabled(false);
            new Thread(() -> {
                long now = TrustedClock.now(policy.prefs());
                String message;
                if (now < 0) {
                    message = "Couldn't reach the internet to check the real time.";
                } else if (policy.releaseIfExpired(now)) {
                    message = "The year is over. Everything is unlocked, and you can now uninstall LockIn.";
                } else {
                    message = "Not yet. Keep going.";
                }
                main.post(() -> {
                    toastDialog(message);
                    render();
                });
            }).start();
        });
        new Thread(policy::apply).start();
    }

    private TextView text(String s) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        t.setPadding(0, dp(6), 0, dp(6));
        root.addView(t);
        return t;
    }

    private void title(String s) {
        TextView t = text(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 28);
    }

    private void mono(String s) {
        TextView t = text(s);
        t.setTypeface(android.graphics.Typeface.MONOSPACE);
        t.setTextIsSelectable(true);
    }

    private Button button(String label) {
        Button b = new Button(this);
        b.setText(label);
        root.addView(b);
        return b;
    }

    private void toastDialog(String message) {
        new AlertDialog.Builder(this).setMessage(message).setPositiveButton("OK", null).show();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
