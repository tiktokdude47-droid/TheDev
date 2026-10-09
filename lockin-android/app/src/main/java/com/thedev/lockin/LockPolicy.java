package com.thedev.lockin;

import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.os.UserManager;

/** Everything the lock turns on, and the only code path that turns it off. */
public final class LockPolicy {
    public static final long LOCK_DURATION_MS = 365L * 24 * 60 * 60 * 1000;

    /** CleanBrowsing Family filter: blocks adult sites, proxies/VPN sites, and forces SafeSearch. */
    public static final String FILTER_DNS_HOST = "family-filter-dns.cleanbrowsing.org";

    private static final String CHROME = "com.android.chrome";
    private static final String KEY_ACTIVATED_AT = "activated_at";

    private static final String[] RESTRICTIONS = {
            UserManager.DISALLOW_CONFIG_PRIVATE_DNS,   // can't change the filtering DNS
            UserManager.DISALLOW_CONFIG_VPN,           // can't tunnel around the DNS
            UserManager.DISALLOW_CONFIG_DATE_TIME,     // can't fake the clock
            UserManager.DISALLOW_FACTORY_RESET,        // can't reset from Settings
            UserManager.DISALLOW_SAFE_BOOT,            // can't boot without this app
            UserManager.DISALLOW_DEBUGGING_FEATURES,   // can't use adb to remove it
            UserManager.DISALLOW_ADD_USER,             // can't make an unfiltered user
            UserManager.DISALLOW_USER_SWITCH,
            UserManager.DISALLOW_ADD_MANAGED_PROFILE,
    };

    private final Context context;
    private final DevicePolicyManager dpm;
    private final ComponentName admin;
    private final SharedPreferences prefs;

    public LockPolicy(Context context) {
        this.context = context.getApplicationContext();
        this.dpm = this.context.getSystemService(DevicePolicyManager.class);
        this.admin = AdminReceiver.component(this.context);
        this.prefs = this.context.createDeviceProtectedStorageContext()
                .getSharedPreferences("lock", Context.MODE_PRIVATE);
    }

    public SharedPreferences prefs() {
        return prefs;
    }

    public boolean isDeviceOwner() {
        return dpm.isDeviceOwnerApp(context.getPackageName());
    }

    /**
     * Locked if an activation time is stored, or if the restrictions are in
     * place without one (app data was wiped) — in that case the year restarts.
     */
    public boolean isLocked() {
        if (prefs.contains(KEY_ACTIVATED_AT)) return true;
        if (isDeviceOwner() && dpm.getUserRestrictions(admin)
                .getBoolean(UserManager.DISALLOW_CONFIG_PRIVATE_DNS, false)) {
            prefs.edit().putLong(KEY_ACTIVATED_AT, System.currentTimeMillis()).commit();
            return true;
        }
        return false;
    }

    public long unlockAt() {
        return prefs.getLong(KEY_ACTIVATED_AT, 0) + LOCK_DURATION_MS;
    }

    /** Starts the year. Call off the main thread. Returns null on success, else an error message. */
    public String activate(long trustedNow) {
        String error = apply();
        if (error != null) return error;
        prefs.edit().putLong(KEY_ACTIVATED_AT, trustedNow).commit();
        return null;
    }

    /** Applies (or re-applies) every restriction. Call off the main thread. */
    public String apply() {
        int dns = dpm.setGlobalPrivateDnsModeSpecifiedHost(admin, FILTER_DNS_HOST);
        if (dns != DevicePolicyManager.PRIVATE_DNS_SET_NO_ERROR) {
            return "Could not set the filtering DNS (error " + dns + "). Check your internet connection and try again.";
        }
        for (String restriction : RESTRICTIONS) {
            dpm.addUserRestriction(admin, restriction);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            dpm.setAutoTimeEnabled(admin, true);
            dpm.setAutoTimeZoneEnabled(admin, true);
        }
        dpm.setUninstallBlocked(admin, context.getPackageName(), true);
        dpm.setApplicationRestrictions(admin, CHROME, chromePolicy());
        return null;
    }

    /** Chrome enterprise policies: no incognito, no private DNS-over-HTTPS bypass, adult filter on. */
    private static Bundle chromePolicy() {
        Bundle b = new Bundle();
        b.putInt("SafeSitesFilterBehavior", 1);
        b.putBoolean("ForceGoogleSafeSearch", true);
        b.putInt("ForceYouTubeRestrict", 1);
        b.putInt("IncognitoModeAvailability", 1);
        b.putString("DnsOverHttpsMode", "off");
        return b;
    }

    /** Removes everything. Only callable once the trusted clock says the year is over. */
    public boolean releaseIfExpired(long trustedNow) {
        if (trustedNow < unlockAt()) return false;
        for (String restriction : RESTRICTIONS) {
            dpm.clearUserRestriction(admin, restriction);
        }
        dpm.setGlobalPrivateDnsModeOpportunistic(admin);
        dpm.setApplicationRestrictions(admin, CHROME, new Bundle());
        dpm.setUninstallBlocked(admin, context.getPackageName(), false);
        prefs.edit().clear().commit();
        dpm.clearDeviceOwnerApp(context.getPackageName());
        return true;
    }

    /** Before activation only: give up device-owner status so the app can be uninstalled. */
    public void removeBeforeActivation() {
        if (isLocked()) return;
        dpm.setUninstallBlocked(admin, context.getPackageName(), false);
        dpm.clearDeviceOwnerApp(context.getPackageName());
    }
}
