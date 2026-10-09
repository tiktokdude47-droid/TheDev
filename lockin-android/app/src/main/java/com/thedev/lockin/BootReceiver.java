package com.thedev.lockin;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Re-applies the lock after every reboot, in case anything drifted. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        LockPolicy policy = new LockPolicy(context);
        if (!policy.isLocked()) return;
        PendingResult result = goAsync();
        new Thread(() -> {
            try {
                policy.apply();
            } finally {
                result.finish();
            }
        }).start();
    }
}
