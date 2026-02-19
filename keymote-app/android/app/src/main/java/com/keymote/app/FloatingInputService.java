package com.keymote.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.text.Editable;
import android.text.TextWatcher;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.Toast;

import androidx.core.app.NotificationCompat;

import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;
import org.json.JSONObject;

import java.net.URI;

/**
 * Floating overlay input service — runs in a separate process (:overlay).
 * Connects directly to the Desktop's WebSocket relay server.
 * Survives app kill from recents because it runs in its own process.
 *
 * Text path: Overlay/Notification → WebSocket → Desktop keyboard injector
 * No WebView or P2P dependency.
 */
public class FloatingInputService extends Service {

    private static final String TAG = "FloatingInput";
    private static final String CHANNEL_ID = "keymote_overlay_silent";
    private static final int NOTIFICATION_ID = 2;

    // SharedPreferences key (matches Capacitor's WebView localStorage bridge)
    public static final String PREFS_NAME = "keymote_overlay";
    public static final String PREF_WS_IPS = "ws_ips";
    public static final String PREF_WS_PORT = "ws_port";

    // Intent extras for starting
    public static final String EXTRA_IPS = "ips";
    public static final String EXTRA_PORT = "port";

    private WindowManager windowManager;
    private View bubbleView;
    private View panelView;
    private WindowManager.LayoutParams bubbleParams;
    private WindowManager.LayoutParams panelParams;
    private boolean isExpanded = false;

    // WebSocket
    private WebSocketClient wsClient;
    private String[] wsIPs;
    private int wsPort;
    private boolean wsConnected = false;
    private Handler mainHandler;
    private int reconnectAttempts = 0;
    private static final int MAX_RECONNECT_DELAY = 30000;

    // Real-time sync tracking
    private String lastSentText = "";
    private boolean ignoreTextChange = false;

    // Bubble position before expand (to restore on collapse)
    private int savedBubbleX, savedBubbleY;

    // Drag tracking
    private int initialX, initialY;
    private float initialTouchX, initialTouchY;
    private static final int CLICK_THRESHOLD = 10;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "FloatingInputService onCreate (pid=" + android.os.Process.myPid() + ")");
        mainHandler = new Handler(Looper.getMainLooper());
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);

        startAsForeground();

        try {
            createBubble();
            createPanel();
        } catch (Exception e) {
            Log.e(TAG, "Failed to create overlay views: " + e.getMessage());
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Extract WS relay info from intent or SharedPreferences
        if (intent != null && intent.hasExtra(EXTRA_PORT)) {
            wsIPs = intent.getStringArrayExtra(EXTRA_IPS);
            wsPort = intent.getIntExtra(EXTRA_PORT, 0);

            // Persist for restart after kill
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            prefs.edit()
                    .putString(PREF_WS_IPS, String.join(",", wsIPs))
                    .putInt(PREF_WS_PORT, wsPort)
                    .apply();
        } else {
            // Recover from SharedPreferences (service restarted by OS)
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            String ipsStr = prefs.getString(PREF_WS_IPS, null);
            wsPort = prefs.getInt(PREF_WS_PORT, 0);
            if (ipsStr != null) {
                wsIPs = ipsStr.split(",");
            }
        }

        if (wsIPs != null && wsPort > 0) {
            connectWebSocket();
        }

        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Service survives because it's in a separate process
        Log.d(TAG, "App task removed — overlay service continues in :overlay process");
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        disconnectWebSocket();
        if (bubbleView != null) {
            try {
                windowManager.removeView(bubbleView);
            } catch (Exception ignored) {
            }
        }
        if (panelView != null) {
            try {
                windowManager.removeView(panelView);
            } catch (Exception ignored) {
            }
        }
        super.onDestroy();
    }

    // --- WebSocket Connection ---

    // Fixed port matching desktop's overlay relay — used as fallback
    private static final int FIXED_OVERLAY_PORT = 38745;

    // Generation counter: prevents stale callbacks from old WebSocket clients
    // from interfering with the current connection attempt
    private int wsGeneration = 0;
    private Runnable pendingReconnect = null;

    private void connectWebSocket() {
        if (wsIPs == null || wsIPs.length == 0)
            return;

        // Use fixed port if stored port is 0 or invalid
        if (wsPort <= 0) {
            wsPort = FIXED_OVERLAY_PORT;
        }

        // If already connected, don't reconnect
        if (wsClient != null && wsConnected) {
            Log.d(TAG, "Already connected, skipping reconnect");
            return;
        }

        // Cancel any pending reconnect
        cancelPendingReconnect();

        // Close existing client (increment generation to ignore its callbacks)
        disconnectWebSocket();

        // Try first IP (usually the main LAN IP)
        tryConnectToIP(0);
    }

    private void tryConnectToIP(int ipIndex) {
        if (wsIPs == null || ipIndex >= wsIPs.length) {
            Log.w(TAG, "All IPs failed, scheduling reconnect");
            scheduleReconnect();
            return;
        }

        String ip = wsIPs[ipIndex].trim();
        String url = "ws://" + ip + ":" + wsPort;
        Log.d(TAG, "Connecting to: " + url + " (gen=" + wsGeneration + ")");

        final int gen = wsGeneration; // Capture current generation

        try {
            wsClient = new WebSocketClient(new URI(url)) {
                @Override
                public void onOpen(ServerHandshake handshake) {
                    if (gen != wsGeneration) return; // Stale callback
                    Log.d(TAG, "WebSocket connected to " + url);
                    wsConnected = true;
                    reconnectAttempts = 0;
                    mainHandler.post(() -> updateStatusDot(true));
                }

                @Override
                public void onMessage(String message) {
                    if (gen != wsGeneration) return;
                    Log.d(TAG, "WS message: " + message);
                }

                @Override
                public void onClose(int code, String reason, boolean remote) {
                    if (gen != wsGeneration) return; // Stale — ignore
                    Log.d(TAG, "WebSocket closed: code=" + code + " reason=" + reason + " remote=" + remote);
                    wsConnected = false;
                    mainHandler.post(() -> {
                        if (gen != wsGeneration) return;
                        updateStatusDot(false);
                        scheduleReconnect();
                    });
                }

                @Override
                public void onError(Exception ex) {
                    if (gen != wsGeneration) return; // Stale — ignore
                    Log.w(TAG, "WebSocket error on " + ip + ": " + ex.getMessage());
                    wsConnected = false;
                    mainHandler.post(() -> {
                        if (gen != wsGeneration) return;
                        updateStatusDot(false);
                        tryConnectToIP(ipIndex + 1);
                    });
                }
            };
            wsClient.setConnectionLostTimeout(10);
            wsClient.connect();

            // Timeout: if not connected within 8s, move to next IP
            mainHandler.postDelayed(() -> {
                if (gen != wsGeneration) return;
                if (!wsConnected && wsClient != null) {
                    Log.w(TAG, "Connection timeout for " + url);
                    try { wsClient.close(); } catch (Exception ignored) {}
                    tryConnectToIP(ipIndex + 1);
                }
            }, 8000);
        } catch (Exception e) {
            Log.e(TAG, "Failed to create WS client: " + e.getMessage());
            tryConnectToIP(ipIndex + 1);
        }
    }

    private void disconnectWebSocket() {
        wsGeneration++; // Invalidate all callbacks from current/old client
        if (wsClient != null) {
            try {
                wsClient.close();
            } catch (Exception ignored) {
            }
            wsClient = null;
        }
        wsConnected = false;
    }

    private void cancelPendingReconnect() {
        if (pendingReconnect != null) {
            mainHandler.removeCallbacks(pendingReconnect);
            pendingReconnect = null;
        }
    }

    private void scheduleReconnect() {
        cancelPendingReconnect();
        reconnectAttempts++;
        int delay = Math.min(2000 * reconnectAttempts, MAX_RECONNECT_DELAY);
        Log.d(TAG, "Reconnecting in " + delay + "ms (attempt " + reconnectAttempts + ")");
        pendingReconnect = this::connectWebSocket;
        mainHandler.postDelayed(pendingReconnect, delay);
    }

    private void sendTextViaWebSocket(String text) {
        if (wsClient != null && wsConnected) {
            try {
                JSONObject msg = new JSONObject();
                msg.put("type", "text");
                msg.put("text", text);
                wsClient.send(msg.toString());
                Log.d(TAG, "Sent text via WS: " + text.length() + " chars");
            } catch (Exception e) {
                Log.e(TAG, "Failed to send text: " + e.getMessage());
            }
        } else {
            mainHandler.post(() -> Toast.makeText(this, "Not connected to desktop", Toast.LENGTH_SHORT).show());
        }
    }

    // --- Real-time Text Sync (matches app input field behavior) ---

    private void syncTextDiff(String newText) {
        int commonLen = getCommonPrefixLength(newText, lastSentText);
        int backspacesNeeded = lastSentText.length() - commonLen;
        String newChars = newText.substring(commonLen);

        // Send backspaces for deleted characters
        for (int i = 0; i < backspacesNeeded; i++) {
            sendKeyViaWebSocket("Backspace");
        }

        // Send new characters
        if (newChars.length() > 0) {
            sendTextViaWebSocket(newChars);
        }

        lastSentText = newText;
    }

    private int getCommonPrefixLength(String a, String b) {
        int len = Math.min(a.length(), b.length());
        for (int i = 0; i < len; i++) {
            if (a.charAt(i) != b.charAt(i))
                return i;
        }
        return len;
    }

    private void sendKeyViaWebSocket(String key) {
        if (wsClient != null && wsConnected) {
            try {
                JSONObject msg = new JSONObject();
                msg.put("type", "key");
                msg.put("key", key);
                wsClient.send(msg.toString());
            } catch (Exception e) {
                Log.e(TAG, "Failed to send key: " + e.getMessage());
            }
        }
    }

    // --- Minimal Foreground Notification (required by Android for foreground
    // services) ---

    private void startAsForeground() {
        createNotificationChannel();
        Notification notification = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            Log.e(TAG, "startForeground failed: " + e.getMessage());
            try {
                startForeground(NOTIFICATION_ID, notification);
            } catch (Exception e2) {
                Log.e(TAG, "startForeground fallback also failed: " + e2.getMessage());
            }
        }
    }

    private Notification buildNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Keymote")
                .setContentText("Overlay active")
                .setSmallIcon(R.drawable.ic_stat_connected)
                .setOngoing(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Keymote Overlay",
                    NotificationManager.IMPORTANCE_MIN);
            channel.setDescription("Required for overlay service");
            channel.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    // --- Overlay UI ---

    private int getOverlayType() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
        }
        return WindowManager.LayoutParams.TYPE_PHONE;
    }

    private void createBubble() {
        bubbleView = LayoutInflater.from(this).inflate(R.layout.floating_bubble, null);

        View statusDot = bubbleView.findViewById(R.id.status_dot);
        GradientDrawable dotShape = new GradientDrawable();
        dotShape.setShape(GradientDrawable.OVAL);
        dotShape.setColor(0xFFFF0000);
        statusDot.setBackground(dotShape);

        bubbleParams = new WindowManager.LayoutParams(
                dpToPx(48),
                dpToPx(48),
                getOverlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);
        bubbleParams.gravity = Gravity.TOP | Gravity.START;
        bubbleParams.x = dpToPx(16);
        bubbleParams.y = dpToPx(100);

        bubbleView.setOnTouchListener((v, event) -> {
            switch (event.getAction()) {
                case MotionEvent.ACTION_DOWN:
                    initialX = bubbleParams.x;
                    initialY = bubbleParams.y;
                    initialTouchX = event.getRawX();
                    initialTouchY = event.getRawY();
                    return true;
                case MotionEvent.ACTION_MOVE:
                    if (isExpanded)
                        return true; // Don't drag when input panel is open
                    bubbleParams.x = initialX + (int) (event.getRawX() - initialTouchX);
                    bubbleParams.y = initialY + (int) (event.getRawY() - initialTouchY);
                    clampBubblePosition();
                    try {
                        windowManager.updateViewLayout(bubbleView, bubbleParams);
                    } catch (Exception ignored) {
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                    float dx = event.getRawX() - initialTouchX;
                    float dy = event.getRawY() - initialTouchY;
                    if (Math.abs(dx) < CLICK_THRESHOLD && Math.abs(dy) < CLICK_THRESHOLD) {
                        togglePanel();
                    }
                    return true;
            }
            return false;
        });

        windowManager.addView(bubbleView, bubbleParams);
    }

    private void createPanel() {
        panelView = LayoutInflater.from(this).inflate(R.layout.floating_input_panel, null);

        EditText input = panelView.findViewById(R.id.overlay_input);
        ImageButton clearBtn = panelView.findViewById(R.id.btn_clear);

        // Real-time sync: send text as it's typed, character by character
        input.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {
            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
            }

            @Override
            public void afterTextChanged(Editable s) {
                if (ignoreTextChange)
                    return;
                String newText = s.toString();
                syncTextDiff(newText);
            }
        });

        // Enter key: send Enter to desktop, insert newline locally
        input.setOnKeyListener((v, keyCode, event) -> {
            if (keyCode == KeyEvent.KEYCODE_ENTER && event.getAction() == KeyEvent.ACTION_DOWN) {
                sendKeyViaWebSocket("Enter");
                return true; // consume — don't insert newline in EditText
            }
            return false;
        });

        // Clear button: erases text only from overlay input (not from desktop)
        clearBtn.setOnClickListener(v -> {
            ignoreTextChange = true;
            input.setText("");
            lastSentText = "";
            ignoreTextChange = false;
        });

        panelParams = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                getOverlayType(),
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT);
        panelParams.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        panelParams.y = dpToPx(8);
        panelParams.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
                | WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE;

        panelView.setVisibility(View.GONE);
        windowManager.addView(panelView, panelParams);
    }

    private void togglePanel() {
        if (isExpanded)
            collapsePanel();
        else
            expandPanel();
    }

    private void expandPanel() {
        isExpanded = true;

        // Save original bubble position
        savedBubbleX = bubbleParams.x;
        savedBubbleY = bubbleParams.y;

        // Move bubble just above the input panel (panel is at bottom with gravity
        // BOTTOM)
        // Switch bubble gravity to BOTTOM so it sits right above the panel
        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getMetrics(metrics);
        int panelEstimatedHeight = dpToPx(88 + 16); // input minHeight + padding
        int bubbleSize = dpToPx(48);
        bubbleParams.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        bubbleParams.x = 0;
        bubbleParams.y = dpToPx(8) + panelEstimatedHeight + dpToPx(4); // panel y offset + panel height + gap
        try {
            windowManager.updateViewLayout(bubbleView, bubbleParams);
        } catch (Exception ignored) {
        }

        panelView.setVisibility(View.VISIBLE);
        try {
            windowManager.updateViewLayout(panelView, panelParams);
        } catch (Exception ignored) {
        }

        EditText input = panelView.findViewById(R.id.overlay_input);
        input.requestFocus();

        // Delay keyboard show — overlay view needs time to attach and gain focus
        mainHandler.postDelayed(() -> {
            input.requestFocus();
            InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (imm != null) {
                imm.showSoftInput(input, InputMethodManager.SHOW_FORCED);
            }
        }, 200);

    }

    private void collapsePanel() {
        isExpanded = false;
        panelView.setVisibility(View.GONE);
        EditText input = panelView.findViewById(R.id.overlay_input);
        InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (imm != null)
            imm.hideSoftInputFromWindow(input.getWindowToken(), 0);

        // Restore bubble to original position
        bubbleParams.gravity = Gravity.TOP | Gravity.START;
        bubbleParams.x = savedBubbleX;
        bubbleParams.y = savedBubbleY;
        try {
            windowManager.updateViewLayout(bubbleView, bubbleParams);
        } catch (Exception ignored) {
        }

    }

    private void updateStatusDot(boolean connected) {
        if (bubbleView == null)
            return;
        View statusDot = bubbleView.findViewById(R.id.status_dot);
        if (statusDot != null) {
            GradientDrawable dotShape = new GradientDrawable();
            dotShape.setShape(GradientDrawable.OVAL);
            dotShape.setColor(connected ? 0xFF4CAF50 : 0xFFFF0000);
            statusDot.setBackground(dotShape);
        }
    }

    private void clampBubblePosition() {
        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getMetrics(metrics);
        int screenWidth = metrics.widthPixels;
        int screenHeight = metrics.heightPixels;
        int bubbleSize = dpToPx(48);
        if (bubbleParams.x < 0)
            bubbleParams.x = 0;
        if (bubbleParams.y < 0)
            bubbleParams.y = 0;
        if (bubbleParams.x > screenWidth - bubbleSize)
            bubbleParams.x = screenWidth - bubbleSize;
        if (bubbleParams.y > screenHeight - bubbleSize)
            bubbleParams.y = screenHeight - bubbleSize;
    }

    private int dpToPx(int dp) {
        return Math.round(dp * getResources().getDisplayMetrics().density);
    }
}
