const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Server info
    getServerInfo: () => ipcRenderer.invoke('get-server-info'),
    getConnectionStatus: () => ipcRenderer.invoke('get-connection-status'),

    // Theme
    getTheme: () => ipcRenderer.invoke('get-theme'),
    setTheme: (theme) => ipcRenderer.send('set-theme', theme),

    // Startup (auto-launch)
    getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
    setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),

    // Window controls
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    closeWindow: () => ipcRenderer.send('window-close'),

    // Remote Input (P2P)
    sendRemoteInput: (data) => ipcRenderer.send('remote-input', data),

    // Cursor Tracking Control
    sendCursorControl: (action) => ipcRenderer.send('cursor-control', { action }),

    // Auth Token Management
    generateToken: (data) => ipcRenderer.invoke('generate-token', data),
    validateToken: (data) => ipcRenderer.invoke('validate-token', data),

    // Event listeners
    onServerReady: (callback) => {
        ipcRenderer.on('server-ready', (event, info) => callback(info));
    },
    onConnectionChange: (callback) => {
        ipcRenderer.on('connection-change', (event, info) => callback(info));
    },
    onThemeChanged: (callback) => {
        ipcRenderer.on('theme-changed', (event, theme) => callback(theme));
    },
    onTunnelUrl: (callback) => {
        ipcRenderer.on('tunnel-url', (event, info) => callback(info));
    },

    // Screen Share Source ID logic
    getSources: () => ipcRenderer.invoke('get-sources'),

    // P2P Screen Share (Legacy handling - can clean up later)
    onP2PScreenFrame: (callback) => {
        ipcRenderer.on('p2p-screen-frame', (event, frameData) => callback(frameData));
    },

    // Logging (Renderer -> Terminal)
    log: (type, message) => ipcRenderer.send('renderer-log', { type, message }),

    // Cursor position updates
    onCursorUpdate: (callback) => {
        ipcRenderer.on('cursor-update', (event, data) => callback(data));
    },

    // System audio mute control
    setSystemMute: (mute) => ipcRenderer.send('set-system-mute', mute)
});

