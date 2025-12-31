const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Server info
    getServerInfo: () => ipcRenderer.invoke('get-server-info'),
    getConnectionStatus: () => ipcRenderer.invoke('get-connection-status'),

    // Theme
    getTheme: () => ipcRenderer.invoke('get-theme'),
    setTheme: (theme) => ipcRenderer.send('set-theme', theme),

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
    }
});
