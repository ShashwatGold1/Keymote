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

// Store server info for reconnection
let lastServerInfo = null;
let peerDiscovery = null; // PIN-based (Discovery)
let peerSecure = null;    // Token-based (Persistent)

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

// Status Updates
function updateGlobalStatus() {
    const secureCount = getSecureClientCount();

    if (secureCount > 0) {
        updateStatus('Connected', `${secureCount} device(s)`);
        el.qrSection.style.display = 'none';

        // Update badge with first device name
        const firstConn = getFirstSecureConnection();
        if (firstConn && firstConn.deviceName) {
            el.deviceName.textContent = firstConn.deviceName;
            el.deviceBadge.style.display = 'inline-flex';
        }
    } else {
        updateStatus('Waiting', 'Scan QR code to connect');
        el.qrSection.style.display = 'block';
        el.deviceBadge.style.display = 'none';
    }
}

function updateStatus(status, detail) {
    el.statusText.textContent = status;
    el.statusDetail.textContent = detail;
    el.status.className = 'status-indicator' +
        (status === 'Connected' ? ' status-connected' :
            status.includes('Error') ? ' status-error' : '');
}

// Check library availability
function checkPeerJS() {
    if (typeof Peer === 'undefined') {
        throw new Error('PeerJS library not loaded. Check Internet connection.');
    }
}

// Server info display
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

    // Display PIN and Computer Name
    if (info.pin && info.computerName) {
        el.pinCode.textContent = info.pin;
        el.computerName.textContent = info.computerName;
        el.pinSection.style.display = 'block';
    }

    updateStatus('Waiting', `Ready to pair`);

    // Ensure PeerJS is initialized
    initDualPeers(info);
}

// --- DUAL PEER LOGIC ---

function initDualPeers(info) {
    if (!info || !info.pin || !info.hostId) return;
    lastServerInfo = info;

    checkPeerJS();

    // 1. Discovery Peer (PIN) - Ephemeral
    initDiscoveryPeer(info.pin);

    // 2. Secure Peer (HostID) - Persistent
    initSecurePeer(info.hostId);
}

// Peer Configuration
const peerConfig = {
    debug: 1,
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    }
};

// --- 1. DISCOVERY PEER (PIN) ---
function initDiscoveryPeer(pin) {
    if (peerDiscovery) peerDiscovery.destroy();

    const peerId = `keymote-${pin}`;
    console.log('[Discovery] Initializing:', peerId);

    peerDiscovery = new Peer(peerId, peerConfig);

    peerDiscovery.on('open', (id) => {
        console.log('[Discovery] Ready:', id);
    });

    peerDiscovery.on('connection', (conn) => {
        console.log('[Discovery] Incoming pairing request...');

        conn.on('data', async (data) => {
            if (data && data.type === 'pair-request') {
                console.log('[Discovery] Pairing Request from:', data.deviceName);

                // Generate Token via Main Process
                const token = await window.electronAPI.generateToken({
                    deviceId: data.deviceId,
                    deviceName: data.deviceName
                });

                // Send Credentials back to client
                conn.send({
                    type: 'pair-success',
                    token: token,
                    hostId: lastServerInfo.hostId
                });

                console.log('[Discovery] Pairing successful. Token sent.');

                // Close discovery connection (client should reconnect to Secure Peer)
                setTimeout(() => conn.close(), 1000);
            }
        });
    });

    peerDiscovery.on('disconnected', () => {
        console.log('[Discovery] Disconnected from signaling server, reconnecting...');
        if (peerDiscovery && !peerDiscovery.destroyed) {
            peerDiscovery.reconnect();
        }
    });

    peerDiscovery.on('error', (err) => {
        console.error('[Discovery] Error:', err);
        // Retry logic if ID is taken (rare for random PIN)
        if (err.type === 'unavailable-id') {
            setTimeout(() => initDiscoveryPeer(pin), 3000);
        }
    });
}


function startHeartbeat(conn) {
    if (conn.heartbeatInfo) clearInterval(conn.heartbeatInfo);

    conn.lastPong = Date.now();
    conn.isSleeping = false;

    conn.heartbeatInfo = setInterval(() => {
        const silenceSec = Math.round((Date.now() - conn.lastPong) / 1000);

        if (silenceSec > 30) {
            // 30s of total silence — connection is truly dead
            console.error(`[Secure] Connection dead (${silenceSec}s silent): ${conn.deviceName}`);
            conn.close();
            clearInterval(conn.heartbeatInfo);
            return;
        }

        if (silenceSec > 10 && !conn.isSleeping) {
            // Phone likely went to sleep — log once, keep pinging
            conn.isSleeping = true;
            console.log(`[Secure] ${conn.deviceName} appears to be sleeping, waiting patiently...`);
        }

        if (silenceSec <= 10 && conn.isSleeping) {
            // Phone woke up and responded
            conn.isSleeping = false;
            console.log(`[Secure] ${conn.deviceName} woke up! Connection alive.`);
        }

        // Always keep pinging (3s) — keeps NAT alive & gives phone something
        // to respond to the instant it wakes up
        if (conn.open) {
            conn.send({ type: 'ping' });
        }
    }, 3000);

    // Clean up on close (PeerJS fires this on real ICE/DTLS failure)
    conn.on('close', () => {
        if (conn.heartbeatInfo) clearInterval(conn.heartbeatInfo);
    });
}

// --- 2. SECURE PEER (UUID) ---
function initSecurePeer(hostId) {
    if (peerSecure) peerSecure.destroy();

    const peerId = `keymote-${hostId}`;
    console.log('[Secure] Initializing:', peerId);

    peerSecure = new Peer(peerId, peerConfig);

    peerSecure.on('open', (id) => {
        console.log('[Secure] Ready:', id);
        // Show "Internet Ready" badge
        const publicBadge = document.createElement('span');
        publicBadge.className = 'status-detail';
        publicBadge.style.color = '#4CAF50';
        publicBadge.textContent = ' 🌐 Internet Ready';
        if (el.pinSection && !el.pinSection.innerText.includes('Internet Ready')) {
            el.pinSection.appendChild(publicBadge);
        }
    });

    peerSecure.on('connection', (conn) => {
        console.log('[Secure] Incoming connection from:', conn.peer);
        conn.isAuthenticated = false; // Default to blocked

        conn.on('data', async (data) => {
            // Heartbeat (Ping/Pong) - Handle both sides
            if (data && data.type === 'ping') {
                conn.send({ type: 'pong', time: Date.now() });
                return;
            }
            if (data && data.type === 'pong') {
                conn.lastPong = Date.now(); // Track pong receipt
                return;
            }

            // Auth Handshake
            if (data && data.type === 'auth') {
                const isValid = await window.electronAPI.validateToken({
                    deviceId: data.deviceId,
                    token: data.token
                });

                if (isValid) {
                    conn.isAuthenticated = true;
                    conn.deviceName = data.deviceName || 'Unknown';
                    console.log(`[Secure] Authenticated: ${conn.deviceName}`);
                    conn.send({ type: 'auth-result', success: true });
                    updateGlobalStatus();

                    // Start Heartbeat Monitor for this connection
                    startHeartbeat(conn);
                } else {
                    console.warn('[Secure] Auth Failed for:', data.deviceId);
                    conn.send({ type: 'auth-result', success: false, error: 'Invalid Token' });
                    setTimeout(() => conn.close(), 500);
                }
                return;
            }

            // If not authenticated, ignore everything else
            if (!conn.isAuthenticated) return;

            // --- Authenticated Logic Below ---

            // Screen Share Request
            if (data && (data.type === 'screen' || data.type === 'screen-req') && data.action === 'start') {
                startScreenShare(conn.peer);
            }
            if (data && (data.type === 'screen' || data.type === 'screen-req') && data.action === 'stop') {
                stopScreenShare();
            }

            // Audio Share Request
            if (data && data.type === 'audio' && data.action === 'start') {
                startAudioShare(conn.peer);
            }
            if (data && data.type === 'audio' && data.action === 'stop') {
                stopAudioShare();
            }

            // Input Handling
            if (window.electronAPI.sendRemoteInput) {
                window.electronAPI.sendRemoteInput(data);
            }
        });

        conn.on('close', () => {
            console.log('[Secure] Connection closed');
            // If this was an authenticated device, show reconnecting state
            if (conn.isAuthenticated && conn.deviceName) {
                console.log(`[Secure] Waiting for ${conn.deviceName} to reconnect...`);
                updateStatus('Reconnecting', `Waiting for ${conn.deviceName}...`);
                el.deviceBadge.style.display = 'inline-flex';
                el.qrSection.style.display = 'none';
                // Fall back to normal "Waiting" after 60s if no reconnect
                conn.reconnectTimeout = setTimeout(() => {
                    console.log('[Secure] Reconnect timeout — returning to waiting state');
                    updateGlobalStatus();
                }, 60000);
            } else {
                updateGlobalStatus();
            }
        });

        conn.on('error', (err) => console.error('[Secure] Conn Error:', err));
    });

    // When a new connection arrives, clear any pending reconnect timeout
    peerSecure.on('connection', function clearReconnectTimer() {
        if (peerSecure && peerSecure.connections) {
            Object.values(peerSecure.connections).flat().forEach(c => {
                if (c.reconnectTimeout) {
                    clearTimeout(c.reconnectTimeout);
                    c.reconnectTimeout = null;
                }
            });
        }
    });

    // Auto-reconnect to signaling server (keeps call capability alive)
    peerSecure.on('disconnected', () => {
        console.log('[Secure] Disconnected from signaling server, reconnecting...');
        if (peerSecure && !peerSecure.destroyed) {
            peerSecure.reconnect();
        }
    });

    peerSecure.on('error', (err) => {
        console.error('[Secure] Error:', err);
        if (err.type === 'network' || err.type === 'server-error' || err.message.includes('Lost connection')) {
            setTimeout(() => initSecurePeer(hostId), 3000);
        }
    });
}

// Helpers for Status
function getSecureClientCount() {
    if (!peerSecure || !peerSecure.connections) return 0;
    const conns = Object.values(peerSecure.connections).flat();
    return conns.filter(c => c.open && c.isAuthenticated).length;
}

function getFirstSecureConnection() {
    if (!peerSecure || !peerSecure.connections) return null;
    const conns = Object.values(peerSecure.connections).flat();
    return conns.find(c => c.open && c.isAuthenticated);
}

// Helper to broadcast to Authenticated Clients only
function broadcastToAuthenticated(data) {
    if (!peerSecure || !peerSecure.connections) return;
    const connections = Object.values(peerSecure.connections).flat();
    connections.forEach(conn => {
        if (conn.open && conn.isAuthenticated) {
            conn.send(data);
        }
    });
}

// Helper: get system audio stream (loopback) via Electron
async function getSystemAudioStream() {
    // Electron 28+ requires a dummy video track to capture desktop audio
    // We capture both, then discard the video track
    const sources = await window.electronAPI.getSources();
    if (!sources || sources.length === 0) return null;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                mandatory: {
                    chromeMediaSource: 'desktop'
                }
            },
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: sources[0].id,
                    maxWidth: 1,
                    maxHeight: 1
                }
            }
        });
        // Remove the dummy video track, keep only audio
        stream.getVideoTracks().forEach(t => { t.stop(); stream.removeTrack(t); });
        if (stream.getAudioTracks().length > 0) {
            console.log('[Renderer] System audio captured');
            return stream;
        }
        return null;
    } catch (err) {
        console.log('[Renderer] System audio not available:', err.message);
        return null;
    }
}

// Native WebRTC Screen Sharing (with system audio if available)
let activeScreenCall = null;
let activeScreenStream = null;
let screenHasAudio = false;
let screenShareRetryTimer = null;

async function startScreenShare(recipientPeerId, retryCount = 0) {
    // Mutual exclusion: stop audio share if active
    stopAudioShare();

    if (retryCount === 0) stopScreenShare(); // Clean up any existing share
    if (screenShareRetryTimer) { clearTimeout(screenShareRetryTimer); screenShareRetryTimer = null; }

    try {
        const sources = await window.electronAPI.getSources();
        if (!sources || sources.length === 0) return;

        const source = sources[0];
        const videoStream = await navigator.mediaDevices.getUserMedia({
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

        // Try to add system audio
        const audioStream = await getSystemAudioStream();
        screenHasAudio = false;
        if (audioStream) {
            audioStream.getAudioTracks().forEach(t => videoStream.addTrack(t));
            screenHasAudio = true;
            window.electronAPI.setSystemMute(true);
            console.log('[Renderer] Screen share with system audio (PC muted)');
        } else {
            console.log('[Renderer] Screen share without audio (not available)');
        }

        activeScreenStream = videoStream;
        activeScreenCall = peerSecure.call(recipientPeerId, videoStream);

        if (window.electronAPI.sendCursorControl) {
            window.electronAPI.sendCursorControl('start');
        }

        activeScreenCall.on('close', () => {
            cleanupScreenShare();
        });

        activeScreenCall.on('error', (err) => {
            console.error('[Renderer] Screen call error:', err);
            cleanupScreenShare();
            if (retryCount < 2) {
                const delay = (retryCount + 1) * 2000;
                console.log(`[Renderer] Retrying screen share in ${delay / 1000}s (attempt ${retryCount + 2}/3)...`);
                screenShareRetryTimer = setTimeout(() => startScreenShare(recipientPeerId, retryCount + 1), delay);
            }
        });
    } catch (err) {
        console.error('[Renderer] Screen Share Failed:', err);
        cleanupScreenShare();
    }
}

function cleanupScreenShare() {
    if (!activeScreenStream && !activeScreenCall) return;
    if (activeScreenStream) {
        activeScreenStream.getTracks().forEach(t => t.stop());
        activeScreenStream = null;
    }
    if (screenHasAudio) {
        window.electronAPI.setSystemMute(false);
        screenHasAudio = false;
    }
    if (window.electronAPI.sendCursorControl) {
        window.electronAPI.sendCursorControl('stop');
    }
    activeScreenCall = null;
    console.log('[Renderer] Screen share stopped');
}

function stopScreenShare() {
    if (screenShareRetryTimer) { clearTimeout(screenShareRetryTimer); screenShareRetryTimer = null; }
    if (activeScreenCall) {
        activeScreenCall.close();
    }
    cleanupScreenShare();
}

// Audio-only sharing (system audio without screen)
let activeAudioCall = null;
let audioShareRetryTimer = null;

async function startAudioShare(recipientPeerId, retryCount = 0) {
    // Mutual exclusion: stop screen share if active
    stopScreenShare();

    if (audioShareRetryTimer) { clearTimeout(audioShareRetryTimer); audioShareRetryTimer = null; }

    try {
        const audioStream = await getSystemAudioStream();
        if (!audioStream) {
            console.error('[Renderer] Audio Share Failed: no system audio available');
            return;
        }

        window.electronAPI.setSystemMute(true);
        activeAudioCall = peerSecure.call(recipientPeerId, audioStream, { metadata: { type: 'audio-only' } });

        activeAudioCall.on('close', () => {
            audioStream.getTracks().forEach(t => t.stop());
            window.electronAPI.setSystemMute(false);
            activeAudioCall = null;
            console.log('[Renderer] Audio call closed (PC unmuted)');
        });

        activeAudioCall.on('error', (err) => {
            console.error('[Renderer] Audio call error:', err);
            audioStream.getTracks().forEach(t => t.stop());
            window.electronAPI.setSystemMute(false);
            activeAudioCall = null;
            if (retryCount < 2) {
                const delay = (retryCount + 1) * 2000;
                console.log(`[Renderer] Retrying audio share in ${delay / 1000}s (attempt ${retryCount + 2}/3)...`);
                audioShareRetryTimer = setTimeout(() => startAudioShare(recipientPeerId, retryCount + 1), delay);
            }
        });

        console.log('[Renderer] Audio Share Started (PC muted)');
    } catch (err) {
        console.error('[Renderer] Audio Share Failed:', err);
        window.electronAPI.setSystemMute(false);
    }
}

function stopAudioShare() {
    if (audioShareRetryTimer) { clearTimeout(audioShareRetryTimer); audioShareRetryTimer = null; }
    if (activeAudioCall) {
        activeAudioCall.close();
        // cleanup happens in the on('close') handler
    }
}

// Initialization and Event Wiring
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

    // Bridge Events
    window.electronAPI.onServerReady(displayServerInfo);
    window.electronAPI.onThemeChanged(applyTheme);

    // Bridge Cursor Updates
    if (window.electronAPI && window.electronAPI.onP2PScreenFrame) {
        window.electronAPI.onP2PScreenFrame((data) => {
            broadcastToAuthenticated(data);
        });
    }

    // Request initial server info
    const serverInfo = await window.electronAPI.getServerInfo();
    if (serverInfo) displayServerInfo(serverInfo);

    // Set initial status
    updateGlobalStatus();
}

document.addEventListener('DOMContentLoaded', init);
