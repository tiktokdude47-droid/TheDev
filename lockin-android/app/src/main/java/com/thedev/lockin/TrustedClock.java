package com.thedev.lockin;

import android.content.SharedPreferences;

import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Time that can't be faked by changing the phone's clock: it comes from the
 * Date header of well-known HTTPS servers, and never moves backwards.
 */
public final class TrustedClock {
    private static final String[] SOURCES = {
            "https://www.google.com/generate_204",
            "https://www.cloudflare.com/",
            "https://www.microsoft.com/",
    };
    private static final String KEY_LAST_SEEN = "last_trusted_time";

    private TrustedClock() {}

    /** Returns trusted epoch millis, or -1 if no server could be reached. Call off the main thread. */
    public static long now(SharedPreferences prefs) {
        long network = -1;
        for (String source : SOURCES) {
            network = fetch(source);
            if (network > 0) break;
        }
        if (network <= 0) return -1;
        long lastSeen = prefs.getLong(KEY_LAST_SEEN, 0);
        long trusted = Math.max(network, lastSeen);
        prefs.edit().putLong(KEY_LAST_SEEN, trusted).commit();
        return trusted;
    }

    private static long fetch(String source) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(source).openConnection();
            conn.setRequestMethod("HEAD");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setUseCaches(false);
            conn.connect();
            conn.getResponseCode();
            return conn.getDate();
        } catch (Exception e) {
            return -1;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
