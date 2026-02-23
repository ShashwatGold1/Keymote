/**
 * Keymote - Electron Main Process
 * Turn your phone into a wireless keyboard & mouse for your computer
 * P2P Only Mode - WebSocket removed
 */

const { app, BrowserWindow, ipcMain, nativeTheme, Tray, Menu, desktopCapturer, screen } = require('electron');
const path = require('path');
const QRCode = require('qrcode');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { WebSocketServer } = require('ws');
const AutoLaunch = require('auto-launch');

// Enable live reload in development
const isDev = !app.isPackaged;
if (isDev) {
    try {
        require('electron-reload')(__dirname, {
            electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
            hardResetMethod: 'exit'
        });
    } catch (_) { }
}

// Import input injectors
let keyboardInjector;
let mouseInjector;

// Try to load keyboard injector
try {
    keyboardInjector = require('./keyboard-injector');
} catch (error) {
    console.warn('[Main] Keyboard injector not available:', error.message);
    keyboardInjector = {
        initialize: () => true,
        handleKeyEvent: (event) => { console.log('[Mock] Key:', event); return true; }
    };
}

// Try to load mouse injector
try {
    mouseInjector = require('./mouse-injector');
} catch (error) {
    console.warn('[Main] Mouse injector not available:', error.message);
    mouseInjector = {
        initialize: () => true,
        handleMouseEvent: (event) => { console.log('[Mock] Mouse:', event); return true; }
    };
}

// Generate session PIN (6 digits) - Used by P2P
const SESSION_PIN = Math.floor(100000 + Math.random() * 900000).toString();
const COMPUTER_NAME = os.hostname();

// Token storage for persistent authentication
class TokenStorage {
    constructor() {
        this.userDataPath = app.getPath('userData');
        this.tokensFile = path.join(this.userDataPath, 'device-tokens.json');
        this.configPath = path.join(this.userDataPath, 'config.json');
        this.data = this.loadData();
        this.config = this.loadConfig();
    }

    loadData() {
        try {
            if (fs.existsSync(this.tokensFile)) {
                return JSON.parse(fs.readFileSync(this.tokensFile, 'utf8'));
            }
        } catch (e) {
            console.warn('[TokenStorage] Failed to load tokens:', e.message);
        }
        return {};
    }

    loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
            }
        } catch (e) {
            console.warn('[TokenStorage] Failed to load config:', e.message);
        }
        return { hostId: null }; // Default
    }

    saveData() {
        try {
            fs.writeFileSync(this.tokensFile, JSON.stringify(this.data, null, 2));
        } catch (e) {
            console.error('[TokenStorage] Failed to save tokens:', e.message);
        }
    }

    saveConfig() {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
        } catch (e) {
            console.error('[TokenStorage] Failed to save config:', e.message);
        }
    }

    // --- Token Methods ---

    saveToken(deviceId, token, deviceName) {
        this.data[deviceId] = {
            token,
            name: deviceName || 'Unknown Device',
            created: Date.now(),
            lastUsed: Date.now()
        };
        this.saveData();
    }

    getToken(deviceId) {
        return this.data[deviceId]?.token;
    }

    validateToken(deviceId, token) {
        const entry = this.data[deviceId];
        if (entry && entry.token === token) {
            entry.lastUsed = Date.now();
            this.saveData();
            return true;
        }
        return false;
    }

    removeToken(deviceId) {
        delete this.data[deviceId];
        this.saveData();
    }

    // --- Host Identity Methods ---

    getHostId() {
        if (!this.config.hostId) {
            // Generate a permanent UUID for this machine
            this.config.hostId = 'host_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
            this.saveConfig();
        }
        return this.config.hostId;
    }
}

const tokenStorage = new TokenStorage();

let mainWindow;
let windowReady = false;
let tray = null;
let autoLauncher = null;
let isQuitting = false;

/**
 * Create the main application window
 */
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 325,
        height: 660,
        minWidth: 300,
        minHeight: 500,
        icon: path.join(__dirname, 'assets', 'icon.png'),
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0d0f' : '#ffffff',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        frame: false,
        resizable: true,
        show: true
    });

    mainWindow.loadFile('index.html');

    // Open DevTools in development
    if (isDev) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    // Track when window is ready to receive messages
    mainWindow.webContents.on('did-finish-load', () => {
        windowReady = true;
        sendServerInfoToRenderer();
        // Cursor polling now controlled by renderer via 'cursor-control'
    });

    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Minimize to tray on close (instead of quit)
    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
        windowReady = false;
        stopCursorPolling();
    });
}

// System Audio Mute Control - Persistent PowerShell process for instant mute/unmute
const audioMuteInjector = require('./audio-mute-injector');
audioMuteInjector.initialize();

ipcMain.on('set-system-mute', (event, shouldMute) => {
    audioMuteInjector.setMute(shouldMute);
});

// Cursor Polling for "Blue Dot"
let cursorInterval = null;
let lastCursorPos = { x: 0, y: 0 };

// Control cursor polling from Renderer (based on Screen Share state)
ipcMain.on('cursor-control', (event, { action }) => {
    if (action === 'start') {
        startCursorPolling();
    } else if (action === 'stop') {
        stopCursorPolling();
    }
});

function startCursorPolling() {
    if (cursorInterval) return; // Already running

    // Poll cursor position every 16ms (~60fps) for smooth tracking
    cursorInterval = setInterval(() => {
        if (!mainWindow || !windowReady) return;

        try {
            const point = screen.getCursorScreenPoint();
            const primaryDisplay = screen.getPrimaryDisplay();
            const { width, height } = primaryDisplay.size;

            // Only send if moved
            if (point.x !== lastCursorPos.x || point.y !== lastCursorPos.y) {
                lastCursorPos = point;

                // Send "p2p-screen-frame" (renderer listens for this and broadcasts it)
                mainWindow.webContents.send('p2p-screen-frame', {
                    type: 'cursor',
                    cursorX: point.x, // Match mobile app expectation
                    cursorY: point.y, // Match mobile app expectation
                    width: width,
                    height: height
                });
            }
        } catch (e) {
            // Ignore errors (e.g. screen locked)
        }
    }, 16);
}

function stopCursorPolling() {
    if (cursorInterval) {
        clearInterval(cursorInterval);
        cursorInterval = null;
    }
}

// --- Overlay WebSocket Relay Server ---
// Native Android service connects here to send text even when app is killed
let overlayWss = null;
let overlayWsPort = 38745; // Fixed port so overlay can reconnect after Electron restart

function startOverlayRelay(retryCount = 0) {
    overlayWss = new WebSocketServer({ port: overlayWsPort, host: '0.0.0.0' });

    overlayWss.on('listening', () => {
        console.log(`[OverlayRelay] WebSocket server listening on port ${overlayWsPort}`);
    });

    overlayWss.on('connection', (ws) => {
        console.log('[OverlayRelay] Mobile overlay connected');

        ws.on('message', (raw) => {
            try {
                const data = JSON.parse(raw);
                if (data.type === 'text' && data.text && keyboardInjector) {
                    keyboardInjector.handleKeyEvent({ type: 'text', text: data.text, delay: data.delay || 0 });
                    console.log(`[OverlayRelay] Injected text: ${data.text.length} chars`);
                } else if (data.type === 'key' && keyboardInjector) {
                    keyboardInjector.handleKeyEvent(data);
                }
            } catch (e) {
                console.warn('[OverlayRelay] Bad message:', e.message);
            }
        });

        ws.on('close', () => {
            console.log('[OverlayRelay] Mobile overlay disconnected');
        });
    });

    overlayWss.on('error', (err) => {
        console.error('[OverlayRelay] Server error:', err.message);
        // Retry if port is still held from previous instance
        if (err.code === 'EADDRINUSE' && retryCount < 5) {
            console.log(`[OverlayRelay] Port ${overlayWsPort} in use, retrying in ${(retryCount + 1)}s...`);
            setTimeout(() => startOverlayRelay(retryCount + 1), (retryCount + 1) * 1000);
        }
    });
}

// --- Mobile App HTTP Server ---
let mobileHttpServer = null;
const MOBILE_APP_PORT = 8080;
const MOBILE_APP_DIR = path.join(__dirname, 'keymote-app', 'src');

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

function startMobileAppServer() {
    mobileHttpServer = http.createServer((req, res) => {
        let filePath = req.url === '/' ? '/index.html' : req.url;
        // Prevent directory traversal
        filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
        const fullPath = path.join(MOBILE_APP_DIR, filePath);

        // Ensure the resolved path is within MOBILE_APP_DIR
        if (!fullPath.startsWith(MOBILE_APP_DIR)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        const ext = path.extname(fullPath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        fs.readFile(fullPath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('Not Found');
                return;
            }
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
    });

    mobileHttpServer.listen(MOBILE_APP_PORT, '0.0.0.0', () => {
        console.log(`[Main] Mobile App Server running on http://localhost:${MOBILE_APP_PORT}`);
    });

    mobileHttpServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`[Main] Port ${MOBILE_APP_PORT} already in use. Mobile app server not started.`);
        } else {
            console.error('[Main] Mobile app server error:', err.message);
        }
    });
}

function getLocalIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.push(iface.address);
            }
        }
    }
    return ips;
}

/**
 * Create system tray icon
 */
function createTray() {
    const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
    tray = new Tray(iconPath);

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show Keymote', click: () => { if (mainWindow) mainWindow.show(); } },
        { type: 'separator' },
        { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
    ]);

    tray.setToolTip('Keymote - Remote Input');
    tray.setContextMenu(contextMenu);

    // Click tray to show window
    tray.on('click', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

/**
 * Send server info to renderer when ready (P2P mode only)
 */
async function sendServerInfoToRenderer() {
    if (!mainWindow || mainWindow.isDestroyed() || !windowReady) {
        return;
    }

    // Create connection data for QR code (P2P only - just PIN and name)
    const connectionData = {
        pin: SESSION_PIN,
        name: COMPUTER_NAME,
        hostId: tokenStorage.getHostId() // Include persistent ID
    };

    const qrCode = await generateQRCode(JSON.stringify(connectionData));
    mainWindow.webContents.send('server-ready', {
        qrCode,
        pin: SESSION_PIN,
        computerName: COMPUTER_NAME,
        hostId: tokenStorage.getHostId(),
        overlayWsPort: overlayWsPort,
        localIPs: getLocalIPs()
    });
    console.log(`[Main] Connection PIN: ${SESSION_PIN} | Computer: ${COMPUTER_NAME}`);
    console.log(`[Main] Mobile App URL: http://localhost:${MOBILE_APP_PORT}`);
}

/**
 * Initialize services (P2P mode only)
 */
async function initializeServices() {
    try {
        // Initialize injectors
        if (keyboardInjector) keyboardInjector.initialize();
        if (mouseInjector) mouseInjector.initialize();

        // Start mobile app HTTP server
        startMobileAppServer();

        // Start overlay WebSocket relay
        startOverlayRelay();

        // Send server info to renderer (if window is ready)
        sendServerInfoToRenderer();

    } catch (error) {
        console.error('[Main] Failed to initialize services:', error);
    }
}

/**
 * Generate QR code for connection
 */
async function generateQRCode(data) {
    try {
        return await QRCode.toDataURL(data, {
            width: 200,
            margin: 2,
            color: {
                dark: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#000000',
                light: nativeTheme.shouldUseDarkColors ? '#1a1a1b' : '#ffffff'
            }
        });
    } catch (error) {
        console.error('[Main] Failed to generate QR code:', error);
        return null;
    }
}

// IPC Handlers
ipcMain.on('window-minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.minimize();
    }
});

ipcMain.on('window-close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
    }
});

ipcMain.handle('get-server-info', async () => {
    const connectionData = {
        pin: SESSION_PIN,
        name: COMPUTER_NAME,
        hostId: tokenStorage.getHostId()
    };
    const qrCode = await generateQRCode(JSON.stringify(connectionData));
    return {
        qrCode,
        pin: SESSION_PIN,
        computerName: COMPUTER_NAME,
        hostId: tokenStorage.getHostId(),
        overlayWsPort: overlayWsPort,
        localIPs: getLocalIPs()
    };
});

// IPC: Auth Token Management
ipcMain.handle('generate-token', async (event, { deviceId, deviceName }) => {
    const token = require('crypto').randomBytes(32).toString('hex');
    tokenStorage.saveToken(deviceId, token, deviceName);
    return token;
});

ipcMain.handle('validate-token', async (event, { deviceId, token }) => {
    return tokenStorage.validateToken(deviceId, token);
});

// IPC: Get Screen Sources for WebRTC
ipcMain.handle('get-sources', async () => {
    try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        return sources.map(source => ({
            id: source.id,
            name: source.name,
            thumbnail: source.thumbnail.toDataURL()
        }));
    } catch (error) {
        console.error('[Main] Failed to get sources:', error);
        return [];
    }
});

// P2P Remote Input Handler
ipcMain.on('remote-input', (event, data) => {
    if (!data) return;

    // Mouse events
    if (data.type === 'mouse' || data.type === 'mousemove' || data.type === 'click' || data.type === 'scroll') {
        if (mouseInjector) mouseInjector.handleMouseEvent(data);
        return;
    }

    // Keyboard events
    if (data.type === 'keydown' || data.type === 'keyup' || data.type === 'text' || data.type === 'key' || data.type === 'shortcut') {
        if (keyboardInjector) keyboardInjector.handleKeyEvent(data);
        return;
    }

    // Handle screen share requests - Legacy/Fallback (Renderer handles actual flow)
    if (data.type === 'screen' || data.type === 'screen-req') {
        // Do nothing here - Renderer will send 'cursor-control' IPC
        return;
    }

    // Fallback for raw mouse data
    if (data.x !== undefined || data.dx !== undefined) {
        if (mouseInjector) mouseInjector.handleMouseEvent(data);
    }
});

ipcMain.handle('get-connection-status', () => {
    // P2P mode - connection is managed by renderer.js PeerJS
    return { connected: false, clientCount: 0, clients: [] };
});

// Forward Renderer Logs to Terminal
ipcMain.on('renderer-log', (event, { type, message }) => {
    const prefix = '[Renderer]';
    if (type === 'error') console.error(prefix, message);
    else if (type === 'warn') console.warn(prefix, message);
    else console.log(prefix, message);
});

ipcMain.handle('get-theme', () => {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
});

ipcMain.on('set-theme', (event, theme) => {
    nativeTheme.themeSource = theme;
});

// Startup toggle handlers
ipcMain.handle('get-auto-launch', async () => {
    if (autoLauncher) {
        return await autoLauncher.isEnabled();
    }
    return false;
});

ipcMain.handle('set-auto-launch', async (event, enabled) => {
    if (autoLauncher) {
        if (enabled) {
            await autoLauncher.enable();
        } else {
            await autoLauncher.disable();
        }
        return enabled;
    }
    return false;
});

// App lifecycle
app.whenReady().then(async () => {
    // Initialize auto-launcher
    autoLauncher = new AutoLaunch({
        name: 'Keymote',
        path: app.getPath('exe')
    });

    createWindow();
    createTray();
    await initializeServices();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// Don't quit when window is closed (runs in tray)
app.on('window-all-closed', () => {
    // Don't quit - keep running in tray
});

// Before quit - cleanup
app.on('before-quit', async () => {
    isQuitting = true;
    stopCursorPolling();
    audioMuteInjector.cleanup();
    if (mobileHttpServer) { mobileHttpServer.close(); mobileHttpServer = null; }
    if (overlayWss) { overlayWss.close(); overlayWss = null; }
});

// Handle system theme changes
nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    }
});
