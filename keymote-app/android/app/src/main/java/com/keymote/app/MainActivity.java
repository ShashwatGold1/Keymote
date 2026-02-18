package com.keymote.app;

import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private PowerManager.WakeLock cpuWakeLock;
    private WifiManager.WifiLock wifiLock;
    private ConnectivityManager.NetworkCallback networkCallback;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GalleryQrScannerPlugin.class);
        registerPlugin(FloatingInputPlugin.class);
        super.onCreate(savedInstanceState);

        acquireLocks();
        requestBatteryOptimizationExemption();
        registerNetworkCallback();
    }

    /**
     * CRITICAL: Do NOT let the WebView pause JavaScript timers.
     * By default, Android calls webView.onPause() which freezes all JS timers/intervals.
     * This kills ping/pong heartbeats and WebRTC data channels.
     */
    @Override
    public void onPause() {
        // Call super but immediately resume the WebView's timers
        super.onPause();

        // Re-enable JS timers that super.onPause() just paused
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
        }
    }

    @Override
    public void onStop() {
        super.onStop();

        // Again: keep WebView timers running even when activity is fully stopped
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
        }
    }

    @Override
    public void onResume() {
        super.onResume();

        // Ensure timers are definitely running when coming back
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.resumeTimers();
        }
    }

    @Override
    public void onDestroy() {
        releaseLocks();
        unregisterNetworkCallback();
        super.onDestroy();
    }

    /**
     * Acquire CPU wake lock + WiFi lock.
     * CPU wake lock: keeps the CPU running when screen is off.
     * WiFi lock: prevents WiFi from being turned off in sleep mode.
     */
    private void acquireLocks() {
        // CPU partial wake lock — keeps CPU alive, screen can be off
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null && cpuWakeLock == null) {
            cpuWakeLock = pm.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "keymote:connection"
            );
            cpuWakeLock.acquire();
        }

        // WiFi lock — prevents WiFi from going to low-power mode
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm != null && wifiLock == null) {
            wifiLock = wm.createWifiLock(
                WifiManager.WIFI_MODE_FULL_HIGH_PERF,
                "keymote:wifi"
            );
            wifiLock.acquire();
        }
    }

    private void releaseLocks() {
        if (cpuWakeLock != null && cpuWakeLock.isHeld()) {
            cpuWakeLock.release();
            cpuWakeLock = null;
        }
        if (wifiLock != null && wifiLock.isHeld()) {
            wifiLock.release();
            wifiLock = null;
        }
    }

    /**
     * Request the user to disable battery optimization for this app.
     * This exempts the app from Doze mode — Android won't kill network
     * connections or defer jobs while the app is whitelisted.
     */
    private void requestBatteryOptimizationExemption() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        }
    }

    /**
     * Register a network callback to keep the network connection alive.
     * This tells Android we need persistent internet access,
     * preventing the system from dropping our connection during Doze.
     */
    private void registerNetworkCallback() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return;

        NetworkRequest request = new NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build();

        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                // Network available — WebRTC can work
            }

            @Override
            public void onLost(Network network) {
                // Network lost — WebView will detect this via heartbeat
            }
        };

        cm.registerNetworkCallback(request, networkCallback);
    }

    private void unregisterNetworkCallback() {
        if (networkCallback != null) {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                cm.unregisterNetworkCallback(networkCallback);
            }
            networkCallback = null;
        }
    }
}
