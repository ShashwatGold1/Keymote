package com.keymote.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

@CapacitorPlugin(name = "FloatingInput")
public class FloatingInputPlugin extends Plugin {

    private boolean pendingPermissionRequest = false;

    @PluginMethod()
    public void hasOverlayPermission(PluginCall call) {
        JSObject result = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            result.put("hasPermission", Settings.canDrawOverlays(getContext()));
        } else {
            result.put("hasPermission", true);
        }
        call.resolve(result);
    }

    @PluginMethod()
    public void requestOverlayPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (!Settings.canDrawOverlays(getContext())) {
                pendingPermissionRequest = true;
                Intent intent = new Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + getContext().getPackageName())
                );
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
        }
        call.resolve();
    }

    @PluginMethod()
    public void startOverlay(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(getContext())) {
            call.reject("Overlay permission not granted");
            return;
        }

        // Extract WS relay info from JS call
        JSONArray ipsArray = call.getArray("ips", new JSArray());
        int port = call.getInt("port", 0);

        if (port <= 0) {
            call.reject("No relay port provided");
            return;
        }

        // Convert JSONArray to String[]
        String[] ips;
        try {
            ips = new String[ipsArray.length()];
            for (int i = 0; i < ipsArray.length(); i++) {
                ips[i] = ipsArray.getString(i);
            }
        } catch (Exception e) {
            call.reject("Invalid IPs array");
            return;
        }

        Intent intent = new Intent(getContext(), FloatingInputService.class);
        intent.putExtra(FloatingInputService.EXTRA_IPS, ips);
        intent.putExtra(FloatingInputService.EXTRA_PORT, port);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }

        call.resolve();
    }

    @PluginMethod()
    public void stopOverlay(PluginCall call) {
        Intent intent = new Intent(getContext(), FloatingInputService.class);
        getContext().stopService(intent);
        call.resolve();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();

        if (pendingPermissionRequest) {
            pendingPermissionRequest = false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Settings.canDrawOverlays(getContext())) {
                JSObject data = new JSObject();
                data.put("granted", true);
                notifyListeners("overlayPermissionGranted", data);
            }
        }
    }
}
