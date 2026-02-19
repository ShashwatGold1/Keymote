# Floating Overlay Input — Implementation Plan

## Goal
Add a draggable floating bubble (chat-head style) that stays on top of all apps. Tapping it expands an input field. Text typed there flows through the existing P2P `sendText()` pipeline to the desktop.

## Architecture

```
┌─────────────────────────────────────┐
│  FloatingInputService (Native)      │
│  ├─ Bubble ImageView (draggable)    │
│  └─ Expanded Panel (EditText+Send)  │
│        │                            │
│        │ LocalBroadcast / EventBus  │
│        ▼                            │
│  FloatingInputPlugin (Capacitor)    │
│        │                            │
│        │ notifyListeners('textInput')│
│        ▼                            │
│  app.js listener → sendText()       │
│        │                            │
│        │ P2P DataChannel            │
│        ▼                            │
│  Desktop keyboard injection         │
└─────────────────────────────────────┘
```

**Reverse path (connection state → overlay):**
```
app.js → FloatingInput.updateStatus({connected: true/false})
  → Plugin sends Intent/Broadcast → Service updates bubble color
```

---

## Files to Create

### 1. `FloatingInputService.java`
**Path:** `keymote-app/android/app/src/main/java/com/keymote/app/FloatingInputService.java`

**Responsibilities:**
- Android `Service` that uses `WindowManager` to draw overlay views
- Collapsed state: 56dp circular bubble (keyboard icon), draggable via touch
- Expanded state: Panel with EditText + Send button + close button
- Sends typed text via `LocalBroadcastManager` to the plugin
- Receives connection status updates via Intent extras
- Green dot = connected, red dot = disconnected on the bubble

**Key implementation details:**
- Uses `WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY` (API 26+, our min is 24 so fallback to `TYPE_PHONE` for API 24-25)
- Touch listener for drag with click detection (move threshold < 10px = click)
- EditText sends on Enter key or Send button tap
- Auto-collapse when user taps outside the panel

### 2. `FloatingInputPlugin.java`
**Path:** `keymote-app/android/app/src/main/java/com/keymote/app/FloatingInputPlugin.java`

**Responsibilities:**
- Capacitor Plugin bridging JS ↔ Native Service
- Methods exposed to JS:
  - `startOverlay()` — checks permission, starts FloatingInputService
  - `stopOverlay()` — stops FloatingInputService
  - `updateConnectionStatus(connected: boolean)` — sends broadcast to service
  - `hasOverlayPermission()` — checks SYSTEM_ALERT_WINDOW
  - `requestOverlayPermission()` — opens system Settings overlay page
- Registers `BroadcastReceiver` to listen for text from the service
- Calls `notifyListeners("overlayTextInput", data)` when text arrives
- Calls `notifyListeners("overlayDismissed")` when user closes overlay

### 3. `layout/floating_bubble.xml`
**Path:** `keymote-app/android/app/src/main/res/layout/floating_bubble.xml`

Simple layout: 56dp circular FrameLayout with a keyboard icon ImageView + 12dp status dot indicator.

### 4. `layout/floating_input_panel.xml`
**Path:** `keymote-app/android/app/src/main/res/layout/floating_input_panel.xml`

Expanded panel layout:
- Horizontal LinearLayout (280dp wide)
- EditText (weight=1, single line, hint "Type here...")
- ImageButton Send (48dp, send arrow icon)
- ImageButton Close (32dp, X icon)
- Rounded corners, dark semi-transparent background

### 5. `drawable/ic_keyboard_bubble.xml`
**Path:** `keymote-app/android/app/src/main/res/drawable/ic_keyboard_bubble.xml`

Vector drawable — keyboard icon for the floating bubble (24dp white).

### 6. `drawable/ic_send.xml`
**Path:** `keymote-app/android/app/src/main/res/drawable/ic_send.xml`

Vector drawable — send arrow icon for the send button.

### 7. `drawable/bubble_background.xml`
**Path:** `keymote-app/android/app/src/main/res/drawable/bubble_background.xml`

Shape drawable — circular background (#333 dark) for the bubble.

### 8. `drawable/panel_background.xml`
**Path:** `keymote-app/android/app/src/main/res/drawable/panel_background.xml`

Shape drawable — rounded rectangle (#222 dark, 16dp corners) for the expanded panel.

---

## Files to Modify

### 1. `AndroidManifest.xml`
**Add:**
```xml
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />

<service
    android:name=".FloatingInputService"
    android:exported="false" />
```

### 2. `MainActivity.java`
**Add plugin registration:**
```java
registerPlugin(FloatingInputPlugin.class);
```
(Line 27, alongside existing `registerPlugin(GalleryQrScannerPlugin.class)`)

### 3. `keymote-app/src/app.js`
**Add in `onConnectionEstablished()` (~line 2173):**
```javascript
this.startFloatingOverlay();
```

**Add in `onConnectionTornDown()` (~line 2183):**
```javascript
this.stopFloatingOverlay();
```

**Add new methods:**
```javascript
async startFloatingOverlay() {
    const { FloatingInput } = window.Capacitor?.Plugins || {};
    if (!FloatingInput) return;

    const { hasPermission } = await FloatingInput.hasOverlayPermission();
    if (!hasPermission) {
        await FloatingInput.requestOverlayPermission();
        return; // User needs to grant permission in Settings, then reconnect
    }

    await FloatingInput.startOverlay();
    await FloatingInput.updateConnectionStatus({ connected: true });

    // Listen for text from the overlay
    FloatingInput.addListener('overlayTextInput', ({ text }) => {
        this.sendText(text);
    });
}

async stopFloatingOverlay() {
    const { FloatingInput } = window.Capacitor?.Plugins || {};
    if (!FloatingInput) return;
    await FloatingInput.stopOverlay();
}
```

---

## Permission Flow

1. User connects to desktop → `onConnectionEstablished()` fires
2. JS calls `FloatingInput.hasOverlayPermission()`
3. If not granted → `FloatingInput.requestOverlayPermission()` opens Android Settings "Draw over other apps" page for Keymote
4. User grants permission and returns to app
5. Next connection (or manual retry) starts the overlay
6. Overlay appears as a small bubble in the corner

---

## Edge Cases Handled

| Scenario | Behavior |
|---|---|
| Connection lost while overlay active | JS calls `updateConnectionStatus({connected: false})` → bubble turns red. Text typed is queued or shows toast "Not connected" |
| App killed by OS | Service dies with the app process. On next launch + connect, overlay restarts |
| User denies overlay permission | Overlay simply doesn't appear. App works normally without it. No crash |
| User drags bubble off screen | Clamp bubble position to screen bounds in touch listener |
| Keyboard covers expanded panel | Position panel above the keyboard using `adjustResize` or manual offset |
| Multiple taps on bubble | Toggle expanded/collapsed — debounce rapid taps |

---

## Implementation Order

1. Create drawable resources (icons + backgrounds) — 4 XML files
2. Create layout XMLs (bubble + panel) — 2 files
3. Create `FloatingInputService.java` — the core native service
4. Create `FloatingInputPlugin.java` — the Capacitor bridge
5. Modify `AndroidManifest.xml` — add permission + service declaration
6. Modify `MainActivity.java` — register plugin
7. Modify `app.js` — integrate overlay lifecycle + text listener
8. Test on device
