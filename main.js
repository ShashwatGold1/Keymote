/**
 * Keymote - Electron Main Process
 * Turn your phone into a wireless keyboard & mouse for your computer
 */

const { app, BrowserWindow, ipcMain, nativeTheme, Tray, Menu } = require('electron');
const path = require('path');
const QRCode = require('qrcode');

// Import our modules
const WebSocketServer = require('./websocket-server');
const DiscoveryService = require('./discovery');
const ScreenCapturer = require('./screen-capturer');
const TailscaleService = require('./tailscale-service');
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
const os = require('os');
const AutoLaunch = require('auto-launch');

const PORT = 8765;

// Generate session PIN (6 digits)
const SESSION_PIN = Math.floor(100000 + Math.random() * 900000).toString();
const COMPUTER_NAME = os.hostname();

// Token storage for persistent authentication
class TokenStorage {
    constructor() {
        this.tokensFile = path.join(app.getPath('userData'), 'device-tokens.json');
        this.tokens = this.loadTokens();
    }

    loadTokens() {
        try {
            if (fs.existsSync(this.tokensFile)) {
                return JSON.parse(fs.readFileSync(this.tokensFile, 'utf8'));
            }
        } catch (e) {
            console.warn('[TokenStorage] Failed to load tokens:', e.message);
        }
        return {};
    }

    saveTokens() {
        try {
            fs.writeFileSync(this.tokensFile, JSON.stringify(this.tokens, null, 2));
        } catch (e) {
            console.error('[TokenStorage] Failed to save tokens:', e.message);
        }
    }

    saveToken(deviceId, token) {
        this.tokens[deviceId] = { token, created: Date.now() };
        this.saveTokens();
    }

    getToken(deviceId) {
        return this.tokens[deviceId]?.token;
    }

    removeToken(deviceId) {
        delete this.tokens[deviceId];
        this.saveTokens();
    }
}

const fs = require('fs');
const tokenStorage = new TokenStorage();

let mainWindow;
let wsServer;
let discoveryService;
let screenCapturer;
let serverInfo = null;
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

    // Track when window is ready to receive messages
    mainWindow.webContents.on('did-finish-load', () => {
        windowReady = true;
        // Send server info if already available
        if (serverInfo) {
            sendServerInfoToRenderer();
        }
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
    });
}

/**
 * Create system tray icon
 */
function createTray() {
    const iconPath = path.join(__dirname, 'assets', 'icon.png');
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
 * Send server info to renderer when ready
 */
async function sendServerInfoToRenderer() {
    if (!mainWindow || mainWindow.isDestroyed() || !windowReady || !serverInfo) {
        return;
    }
    const url = discoveryService.getConnectionURL();

    // Create connection data for QR code (contains all info needed to connect)
    const connectionData = {
        url: url,
        pin: SESSION_PIN,
        name: COMPUTER_NAME,
        ip: serverInfo.ip,
        port: serverInfo.port,
        tailscale: serverInfo.tailscaleIP
    };

    const qrCode = await generateQRCode(JSON.stringify(connectionData));
    mainWindow.webContents.send('server-ready', {
        ...serverInfo,
        url,
        qrCode,
        pin: SESSION_PIN,
        computerName: COMPUTER_NAME
    });
    console.log(`[Main] Connection PIN: ${SESSION_PIN} | Computer: ${COMPUTER_NAME}`);
}

/**
 * Initialize services
 */
async function initializeServices() {
    try {
        // Initialize injectors
        keyboardInjector.initialize();
        mouseInjector.initialize();

        // Start discovery service
        discoveryService = new DiscoveryService(PORT);
        serverInfo = await discoveryService.start();
        console.log('[Main] Discovery started:', serverInfo);

        // Start WebSocket server with PIN authentication and token storage
        wsServer = new WebSocketServer(keyboardInjector, mouseInjector, PORT, SESSION_PIN, COMPUTER_NAME, tokenStorage);
        await wsServer.start();
        wsServer.startHeartbeat();
        console.log('[Main] WebSocket server started on port', PORT);

        // Initialize screen capturer
        screenCapturer = new ScreenCapturer(wsServer);

        // Handle screen streaming requests from mobile
        wsServer.onScreenRequest = (action) => {
            if (action === 'start') {
                screenCapturer.startStreaming();
            } else if (action === 'stop') {
                screenCapturer.stopStreaming();
            }
        };

        // Handle connection changes
        wsServer.onConnectionChange = (info) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('connection-change', info);
            }
            // Stop streaming if no clients connected
            if (!info.connected && screenCapturer) {
                screenCapturer.stopStreaming();
            }
        };

        // Send server info to renderer (if window is ready)
        sendServerInfoToRenderer();

    } catch (error) {
        console.error('[Main] Failed to initialize services:', error);
    }
}

/**
 * Generate QR code for connection
 */
async function generateQRCode(url) {
    try {
        return await QRCode.toDataURL(url, {
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
    if (!serverInfo) {
        return null;
    }
    const url = discoveryService.getConnectionURL();
    const qrCode = await generateQRCode(url);
    return {
        ...serverInfo,
        url,
        qrCode
    };
});

ipcMain.handle('get-connection-status', () => {
    if (!wsServer) {
        return { connected: false, clientCount: 0, clients: [] };
    }
    return wsServer.getConnectionInfo();
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

// Tailscale control handlers
ipcMain.handle('tailscale-status', async () => {
    return await TailscaleService.getStatus();
});

ipcMain.handle('tailscale-connect', async () => {
    const connected = await TailscaleService.connect();
    if (connected) {
        // Resend server info with new Tailscale IP
        setTimeout(sendServerInfoToRenderer, 1000);
    }
    return connected;
});

ipcMain.handle('tailscale-disconnect', async () => {
    return await TailscaleService.disconnect();
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
    // Only cleanup when actually quitting
});

// Before quit - cleanup
app.on('before-quit', async () => {
    isQuitting = true;
    if (wsServer) {
        await wsServer.stop();
    }
    if (discoveryService) {
        await discoveryService.stop();
    }
});

// Handle system theme changes
nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    }
});
