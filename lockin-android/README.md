# LockIn: one-year porn blocker for Android

LockIn becomes your phone's **device owner**, the same Android mechanism companies use to lock down work phones. Once you activate it, it blocks porn and can't be undone for **365 days**. There is no unlock code. When the year is up, you tap *Check if the year is over* and the app checks the real date over the internet before it releases the lock.

Requires Android 10 or newer.

## What the lock does

- Forces all internet lookups through the **CleanBrowsing Family** DNS filter, which blocks adult sites, proxy and VPN sites, and forces SafeSearch.
- In Chrome: blocks adult sites, turns off incognito and Chrome's own secure DNS, and forces SafeSearch and YouTube Restricted Mode.
- Stops you from changing Private DNS, VPN, or date and time settings, and keeps automatic time switched on.
- Stops you from factory resetting from Settings, booting into safe mode, using USB debugging, or adding users.
- Stops LockIn from being uninstalled or turned off.
- Restarts the year if you wipe LockIn's app data.

## Setup (about 10 minutes, needs a computer)

1. **Get the APK.** In GitHub, open **Actions → Build LockIn APK**, pick the latest run, and download the `LockIn-apk` artifact. Unzip it to get `app-debug.apk`.
2. **Remove every account from the phone for now**: Settings → Accounts (Google, Samsung, and any others). Android won't accept a device owner while accounts exist. Your data stays on the phone, and you'll add the accounts back in step 7.
3. Turn on **Developer options** (tap *Build number* 7 times) and then **USB debugging**.
4. Install the [Android platform tools](https://developer.android.com/tools/releases/platform-tools) on your computer and connect the phone.
5. Run:
   ```
   adb install app-debug.apk
   adb shell dpm set-device-owner com.thedev.lockin/.AdminReceiver
   ```
6. Open LockIn, read the screen, type the confirmation phrase, and tap **Activate 1-year lock**.
7. Add your accounts back.

If you change your mind *before activating*, tap **Remove LockIn** and uninstall it normally.

## Limits

- **A factory reset from recovery mode** (hardware buttons) still wipes the phone and removes LockIn. Stock Android can't block that, but it erases everything on the phone, which is a strong deterrent.
- Browsers other than Chrome that have their own encrypted DNS turned on (for example, Firefox with a custom DNS-over-HTTPS provider) can get around the DNS filter. If that tempts you, just use Chrome.
- On some manufacturer ROMs (Xiaomi and others), extra steps are needed before `dpm set-device-owner` works.
- You can't change the date, time, or time zone by hand while the lock is on, but automatic time and time zone keep working.
