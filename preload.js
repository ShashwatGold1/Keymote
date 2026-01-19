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

    // Tailscale control
    tailscaleStatus: () => ipcRenderer.invoke('tailscale-status'),
    tailscaleConnect: () => ipcRenderer.invoke('tailscale-connect'),
    tailscaleDisconnect: () => ipcRenderer.invoke('tailscale-disconnect')
});

