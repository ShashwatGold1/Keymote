// Keymote Renderer - Desktop UI
// IMMEDIATE TEST LOG
setTimeout(() => {
    if (window.electronAPI && window.electronAPI.log) window.electronAPI.log('info', 'TEST LOG - RENDERER STARTED');
}, 1000);

let currentTheme = 'dark';

const el = {
    status: document.getElementById('statusIndicator'),
    statusText: document.querySelector('.status-text'),
    statusDetail: document.getElementById('statusDetail'),
    qrSection: document.getElementById('qrSection'),
    qrPlaceholder: document.getElementById('qrPlaceholder'),
    qrCode: document.getElementById('qrCode'),
    connectionUrl: document.getElementById('connectionUrl'),
    publicUrl: document.getElementById('publicUrl'),
    deviceBadge: document.getElementById('deviceBadge'),
    deviceName: document.getElementById('deviceName'),
    themeToggle: document.getElementById('themeToggle'),
    minimizeBtn: document.getElementById('minimizeBtn'),
    closeBtn: document.getElementById('closeBtn'),
    pinSection: document.getElementById('pinSection'),
    pinCode: document.getElementById('pinCode'),
    computerName: document.getElementById('computerName'),
    startupToggle: document.getElementById('startupToggle')
};

// Log Forwarding (Debug)
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = (...args) => {
    originalLog(...args);
    if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log('info', args.map(a =>
            typeof a === 'object' ? JSON.stringify(a) : String(a)
        ).join(' '));
    }
};

console.warn = (...args) => {
    originalWarn(...args);
    if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log('warn', args.map(a => String(a)).join(' '));
    }
};

console.error = (...args) => {
    originalError(...args);
    if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log('error', args.map(a => String(a)).join(' '));
    }
};

// Theme
async function initTheme() {
    currentTheme = await window.electronAPI.getTheme();
    applyTheme(currentTheme);
}

function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    el.themeToggle.textContent = theme === 'dark' ? '🌙' : '☀️';
}

function toggleTheme() {
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    window.electronAPI.setTheme(newTheme);
    applyTheme(newTheme);
}

// Status
function updateStatus(status, detail) {
    el.statusText.textContent = status;
    el.statusDetail.textContent = detail;
    el.status.className = 'status-indicator' +
        (status === 'Connected' ? ' status-connected' :
            status.includes('Error') ? ' status-error' : '');
}

// Server info
function displayServerInfo(info) {
    if (!info) {
        updateStatus('Error', 'Failed to start server');
        return;
    }
    if (info.qrCode) {
        el.qrCode.src = info.qrCode;
        el.qrCode.style.display = 'block';
        el.qrPlaceholder.style.display = 'none';
    }
    el.connectionUrl.textContent = info.url;
    el.connectionUrl.href = info.url;

    // Display PIN and Computer Name
    if (info.pin && info.computerName) {
        el.pinCode.textContent = info.pin;
        el.computerName.textContent = info.computerName;
        el.pinSection.style.display = 'block';
    }

    updateStatus('Waiting', `Server on ${info.ip}:${info.port}`);

    // Ensure PeerJS is initialized
    initPeerJS(info);
}

// Connection change
function handleConnectionChange(info) {
    if (info.connected) {
        updateStatus('Connected', `${info.clientCount} device(s)`);
        el.qrSection.style.display = 'none';
        if (info.clients?.length > 0) {
            el.deviceName.textContent = info.clients[0].id.slice(0, 6);
            el.deviceBadge.style.display = 'inline-flex';
        }
    } else {
        updateStatus('Waiting', 'Scan QR code to connect');
        el.qrSection.style.display = 'block';
        el.deviceBadge.style.display = 'none';
    }
}

// PeerJS Logic
let peer = null;

function initPeerJS(info) {
    if (!info || !info.pin) return;

    // Create peer with ID based on PIN
    const peerId = `keymote-${info.pin}`;

    console.log('[PeerJS] Initializing with ID:', peerId);

    if (peer) peer.destroy();

    try {
        if (typeof Peer === 'undefined') {
            throw new Error('PeerJS library not loaded. Check Internet connection.');
        }

        peer = new Peer(peerId, {
            debug: 2,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:global.stun.twilio.com:3478' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun3.l.google.com:19302' },
                    { urls: 'stun:stun4.l.google.com:19302' },
                    { urls: 'stun:stun.services.mozilla.com' }
                ]
            }
        });

        peer.on('open', (id) => {
            console.log('[PeerJS] P2P Ready. ID:', id);
            const publicBadge = document.createElement('span');
            publicBadge.className = 'status-detail';
            publicBadge.style.color = '#4CAF50';
            publicBadge.textContent = ' 🌐 Internet Ready';
            // Only append if not already there
            if (el.pinSection && !el.pinSection.innerText.includes('Internet Ready')) {
                el.pinSection.appendChild(publicBadge);
            }
        });

        peer.on('connection', (conn) => {
            console.log('[PeerJS] Incoming connection from:', conn.peer);

            conn.on('data', (data) => {
                // console.log('[PeerJS] Received Data:', data ? data.type : 'raw'); // Silenced for performance

                // Handle Screen Share Request locally (Native Stream)
                if (data && (data.type === 'screen' || data.type === 'screen-req') && data.action === 'start') {
                    console.log('[Renderer] Starting Native Screen Share to:', conn.peer);
                    startScreenShare(conn.peer);
                    // allow propagation to main.js for cursor polling
                }

                if (window.electronAPI.sendRemoteInput) {
                    window.electronAPI.sendRemoteInput(data);
                }
            });

            conn.on('open', () => {
                console.log('[PeerJS] Data Channel OPEN! Connection Successful.');
                updateStatus('Connected (P2P)', 'Device connected via Internet');
                el.qrSection.style.display = 'none';
            });

            conn.on('close', () => {
                console.log('[PeerJS] Connection closed');
                handleConnectionChange({ connected: false });
            });

            conn.on('error', (err) => {
                console.error('[PeerJS] Connection Error:', err);
            });
        });

        peer.on('error', (err) => {
            console.error('[PeerJS] Error:', err);
        });

    } catch (e) {
        console.error('[PeerJS] Failed to initialize:', e.message);
        updateStatus('Error', 'Internet component failed');
    }
}

// Native WebRTC Screen Sharing
async function startScreenShare(recipientPeerId) {
    try {
        console.log('[Renderer] Getting screen sources...');
        const sources = await window.electronAPI.getSources();
        if (!sources || sources.length === 0) {
            console.error('[Renderer] No screen sources found');
            return;
        }

        // Select primary screen (usually the first one or named 'Entire Screen')
        const source = sources[0];
        console.log('[Renderer] Selected Source:', source.name, source.id);

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: source.id,
                    minWidth: 1280,
                    maxWidth: 1920,
                    minHeight: 720,
                    maxHeight: 1080
                }
            }
        });

        console.log('[Renderer] Stream obtained. Calling peer:', recipientPeerId);
        const call = peer.call(recipientPeerId, stream);

        call.on('close', () => {
            console.log('[Renderer] Call ended');
            stream.getTracks().forEach(t => t.stop());
        });

        call.on('error', (err) => {
            console.error('[Renderer] Call Error:', err);
        });

    } catch (err) {
        console.error('[Renderer] Screen Share Failed:', err);
    }
}

// Helper to broadcast generic data (e.g. cursor) to all peers
function broadcastData(data) {
    if (!peer || !peer.connections) return;
    const connections = Object.values(peer.connections).flat();
    connections.forEach(conn => {
        if (conn.open) conn.send(data);
    });
}

// Init
async function init() {
    await initTheme();

    el.themeToggle.addEventListener('click', toggleTheme);
    el.minimizeBtn?.addEventListener('click', () => window.electronAPI.minimizeWindow());
    el.closeBtn?.addEventListener('click', () => window.electronAPI.closeWindow());

    if (el.startupToggle) {
        const isEnabled = await window.electronAPI.getAutoLaunch();
        el.startupToggle.checked = isEnabled;
        el.startupToggle.addEventListener('change', async () => {
            await window.electronAPI.setAutoLaunch(el.startupToggle.checked);
        });
    }

    window.electronAPI.onServerReady(displayServerInfo);
    window.electronAPI.onConnectionChange(handleConnectionChange);
    window.electronAPI.onThemeChanged(applyTheme);

    // Bridge Cursor Updates from Main -> P2P
    if (window.electronAPI && window.electronAPI.onP2PScreenFrame) {
        window.electronAPI.onP2PScreenFrame((data) => {
            broadcastData(data);
        });
    }

    const serverInfo = await window.electronAPI.getServerInfo();
    if (serverInfo) displayServerInfo(serverInfo);

    const connStatus = await window.electronAPI.getConnectionStatus();
    handleConnectionChange(connStatus);

    // Try init peerjs here too in case serverinfo is already ready
    if (serverInfo) initPeerJS(serverInfo);
}

document.addEventListener('DOMContentLoaded', init);
