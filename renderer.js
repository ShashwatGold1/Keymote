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

// Connection Event Logger - Diagnostic data collection
const connectionLog = {
    events: [],
    maxEvents: 200,

    log(eventType, data = {}) {
        const event = {
            timestamp: new Date().toISOString(),
            eventType,
            ...data
        };
        this.events.push(event);
        if (this.events.length > this.maxEvents) this.events.shift();
        console.log(`[ConnLog] ${eventType}:`, data);
    },

    getRecent(count = 20) {
        return this.events.slice(-count);
    },

    export() {
        return JSON.stringify(this.events, null, 2);
    },

    clear() {
        this.events = [];
    }
};

// Store server info for reconnection
let lastServerInfo = null;
let peerDiscovery = null; // PIN-based (Discovery)
let peerSecure = null;    // Token-based (Persistent)

// Signaling server connection tracking (Fix #4: SPOF detection)
let signalingConnected = false;
let signalingTimeout = null;

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

    // Store overlay relay info for sending to mobile after auth
    if (info.overlayWsPort && info.localIPs) {
        window._overlayRelayInfo = {
            port: info.overlayWsPort,
            ips: info.localIPs
        };
    }

    // Ensure PeerJS is initialized
    initDualPeers(info);
}

// --- DUAL PEER LOGIC ---

// Presence monitor instance (standalone liveness detection)
let presenceMonitor = null;

function initDualPeers(info) {
    if (!info || !info.pin || !info.hostId) return;
    lastServerInfo = info;

    checkPeerJS();

    // 1. Discovery Peer (PIN) - Ephemeral
    initDiscoveryPeer(info.pin);

    // 2. Secure Peer (HostID) - Persistent
    initSecurePeer(info.hostId);

    // 3. Presence Peer — always-on liveness endpoint for mobile to detect us
    if (!presenceMonitor) presenceMonitor = new PresenceMonitor(peerConfig);
    presenceMonitor.startHost(info.hostId);
}

// Peer Configuration with ICE servers for NAT traversal
//
// STUN servers: Google's public STUN servers are highly reliable and free.
// TURN servers: Using openrelay.metered.ca public TURN servers (free).
//   LIMITATIONS:
//   - These are community/public TURN servers with no SLA or uptime guarantee
//   - They may be rate-limited, overloaded, or go offline without notice
//   - For production use, replace with paid TURN servers from:
//     * Metered.ca (50GB/month free tier, then paid): https://www.metered.ca/stun-turn
//     * Twilio Network Traversal: https://www.twilio.com/stun-turn
//     * Xirsys: https://xirsys.com/
//   Example paid TURN config (Twilio):
//     { urls: 'turn:global.turn.twilio.com:3478?transport=udp',
//       username: '<your-api-key-sid>',
//       credential: '<your-api-key-secret>' }
//
// Signaling Server: Defaults to PeerJS cloud (0.peerjs.com:443).
//   This is a single point of failure. For production reliability,
//   self-host using: npx peerjs --port 9000
//   Then uncomment and configure:
//     host: 'your-server.example.com',
//     port: 9000,
//     path: '/myapp',
//     secure: true,
//   See: https://github.com/peers/peerjs-server
const peerConfig = {
    debug: 1,
    config: {
        iceServers: [
            // STUN servers for NAT discovery (high reliability)
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            // TURN servers for relay fallback (public/free — see limitations above)
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ],
        // 'all' = try direct connection first, then TURN relay as fallback
        iceTransportPolicy: 'all'
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
        connectionLog.log('discovery_ready', { peerId: id });
    });

    peerDiscovery.on('connection', (conn) => {
        console.log('[Discovery] Incoming pairing request...');

        conn.on('data', async (data) => {
            if (data && data.type === 'pair-request') {
                console.log('[Discovery] Pairing Request from:', data.deviceName);
                connectionLog.log('pairing_request', { deviceName: data.deviceName, deviceId: data.deviceId });

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
                connectionLog.log('pairing_success', { deviceName: data.deviceName, hostId: lastServerInfo.hostId });

                // Mobile closes the discovery connection itself after receiving pair-success
                // (see app.js line 1663). We just set a safety timeout in case mobile
                // never closes (e.g., crash or disconnect). 10s is generous enough for
                // slow networks while preventing leaked connections.
                setTimeout(() => {
                    if (conn.open) {
                        console.log('[Discovery] Safety timeout — closing stale pairing connection');
                        conn.close();
                    }
                }, 10000);
            }
        });
    });

    peerDiscovery._retrying = false;

    peerDiscovery.on('disconnected', () => {
        // Skip if unavailable-id handler is already scheduling a retry
        if (peerDiscovery._retrying) return;
        console.log('[Discovery] Disconnected from signaling server');
        if (peerDiscovery && !peerDiscovery.destroyed) {
            setTimeout(() => {
                if (peerDiscovery && !peerDiscovery.destroyed) {
                    peerDiscovery.reconnect();
                }
            }, 3000);
        }
    });

    peerDiscovery.on('error', (err) => {
        console.error('[Discovery] Error:', err.type || err.message);
        if (err.type === 'unavailable-id') {
            peerDiscovery._retrying = true; // Suppress disconnected handler
            setTimeout(() => initDiscoveryPeer(pin), 3000);
        }
    });
}


// REMOVED: startHeartbeat() function - relying on real WebRTC close/error events instead

// --- 2. SECURE PEER (UUID) ---
function initSecurePeer(hostId) {
    if (staleCleanupInterval) { clearInterval(staleCleanupInterval); staleCleanupInterval = null; }
    if (peerSecure) peerSecure.destroy();

    const peerId = `keymote-${hostId}`;
    console.log('[Secure] Initializing:', peerId);

    peerSecure = new Peer(peerId, peerConfig);

    // Detect if signaling server is unreachable (6s timeout)
    signalingConnected = false;
    if (signalingTimeout) clearTimeout(signalingTimeout);
    signalingTimeout = setTimeout(() => {
        if (!signalingConnected && peerSecure && !peerSecure.destroyed) {
            console.error('[Secure] Signaling server unreachable after 6s');
            connectionLog.log('signaling_timeout', { host: 'PeerJS Cloud (0.peerjs.com)' });
            updateStatus('Error', 'Signaling server unreachable');
        }
    }, 6000);

    peerSecure.on('open', (id) => {
        signalingConnected = true;
        if (signalingTimeout) { clearTimeout(signalingTimeout); signalingTimeout = null; }
        console.log('[Secure] Ready:', id);
        connectionLog.log('secure_ready', { peerId: id });
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

        // Clear any pending reconnect timeouts from previous connections
        if (peerSecure && peerSecure.connections) {
            Object.values(peerSecure.connections).flat().forEach(c => {
                if (c.reconnectTimeout) {
                    clearTimeout(c.reconnectTimeout);
                    c.reconnectTimeout = null;
                }
            });
        }

        conn.on('data', async (data) => {
            // Auth Handshake
            if (data && data.type === 'auth') {
                const isValid = await window.electronAPI.validateToken({
                    deviceId: data.deviceId,
                    token: data.token
                });

                if (isValid) {
                    // Close any stale connections from the same deviceId
                    // (e.g. mobile was killed and reconnected — old conn is still in the list)
                    if (peerSecure && peerSecure.connections) {
                        Object.values(peerSecure.connections).flat().forEach(oldConn => {
                            if (oldConn !== conn && oldConn.deviceId === data.deviceId && oldConn.isAuthenticated) {
                                console.log(`[Secure] Closing stale connection from ${oldConn.deviceName || data.deviceId}`);
                                oldConn.isAuthenticated = false;
                                try { oldConn.close(); } catch {}
                            }
                        });
                    }

                    conn.isAuthenticated = true;
                    conn.deviceId = data.deviceId;
                    conn.deviceName = data.deviceName || 'Unknown';
                    console.log(`[Secure] Authenticated: ${conn.deviceName}`);
                    connectionLog.log('auth_success', { deviceName: conn.deviceName, deviceId: data.deviceId });
                    conn.send({ type: 'auth-result', success: true });

                    // Send overlay WebSocket relay info so mobile can connect natively
                    if (window._overlayRelayInfo) {
                        conn.send({
                            type: 'overlay-relay-info',
                            port: window._overlayRelayInfo.port,
                            ips: window._overlayRelayInfo.ips
                        });
                    }

                    updateGlobalStatus();
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
                startScreenShare(conn.peer, 0, data.videoOnly || false);
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
            const wasAuthenticated = conn.isAuthenticated;
            conn.isAuthenticated = false; // Prevent stale conn from being counted
            console.log('[Secure] Connection closed');
            connectionLog.log('connection_closed', { deviceName: conn.deviceName || 'unknown', wasAuthenticated });
            // If this was an authenticated device, show reconnecting state
            if (wasAuthenticated && conn.deviceName) {
                console.log(`[Secure] Waiting for ${conn.deviceName} to reconnect...`);
                updateStatus('Reconnecting', `Waiting for ${conn.deviceName}...`);
                el.deviceBadge.style.display = 'inline-flex';
                el.qrSection.style.display = 'none';

                // ACTIVE RECONNECTION: Ensure Secure Peer is connected to signaling
                // server so mobile can find us when it tries to reconnect.
                if (peerSecure && peerSecure.disconnected && !peerSecure.destroyed) {
                    console.log('[Secure] Signaling server disconnected — reconnecting immediately');
                    connectionLog.log('signaling_reconnect_on_close', { reason: 'authenticated_client_lost' });
                    try { peerSecure.reconnect(); } catch (e) {
                        console.error('[Secure] Signaling reconnect failed:', e.message);
                    }
                }

                // Fall back to normal "Waiting" after 30s if no reconnect
                conn.reconnectTimeout = setTimeout(() => {
                    console.log('[Secure] Reconnect timeout — returning to waiting state');
                    updateGlobalStatus();
                }, 30000);
            } else {
                updateGlobalStatus();
            }
        });

        conn.on('error', (err) => console.error('[Secure] Conn Error:', err));
    });

    // Auto-reconnect to signaling server (keeps call capability alive)
    peerSecure._retrying = false;

    peerSecure.on('disconnected', () => {
        // Skip if error handler is already scheduling a retry
        if (peerSecure._retrying) return;
        console.log('[Secure] Disconnected from signaling server');
        if (peerSecure && !peerSecure.destroyed) {
            setTimeout(() => {
                if (peerSecure && !peerSecure.destroyed) {
                    peerSecure.reconnect();
                }
            }, 3000);
        }
    });

    peerSecure.on('error', (err) => {
        const errType = err.type || 'unknown';
        console.error('[Secure] Error:', errType, err.message);
        connectionLog.log('secure_error', { type: errType, message: err.message });

        if (errType === 'unavailable-id') {
            peerSecure._retrying = true; // Suppress disconnected handler
            console.log('[Secure] Peer ID taken — re-creating in 3s...');
            if (lastServerInfo && lastServerInfo.hostId) {
                setTimeout(() => initSecurePeer(lastServerInfo.hostId), 3000);
            }
        } else if (errType === 'network') {
            // Network error — safety timer in case 'disconnected' doesn't fire
            console.log('[Secure] Network error — safety reconnect in 3s if needed');
            setTimeout(() => {
                if (peerSecure && peerSecure.disconnected && !peerSecure.destroyed && !peerSecure._retrying) {
                    console.log('[Secure] Safety reconnect triggered (disconnected handler missed)');
                    connectionLog.log('secure_safety_reconnect', { reason: 'network_error_fallback' });
                    peerSecure.reconnect();
                }
            }, 3000);
        } else if (errType === 'server-error') {
            peerSecure._retrying = true; // Suppress disconnected handler
            console.log('[Secure] Server error — re-creating in 3s...');
            if (lastServerInfo && lastServerInfo.hostId) {
                setTimeout(() => initSecurePeer(lastServerInfo.hostId), 3000);
            }
        }
    });

    // Start periodic stale connection cleanup
    startStaleConnectionCleanup();
}

// Check if a PeerJS DataConnection is truly alive by verifying both
// PeerJS's own .open flag AND the underlying WebRTC DataChannel state.
// PeerJS .open can be stale after network disruptions — the DataChannel
// readyState is the ground truth. Mobile app uses the same technique
// (see app.js lines 2134, 2304).
function isConnectionAlive(conn) {
    if (!conn || !conn.open || !conn.isAuthenticated) return false;
    const dc = conn.dataChannel;
    if (dc && (dc.readyState === 'closed' || dc.readyState === 'closing')) {
        return false;
    }
    return true;
}

// Helpers for Status
function getSecureClientCount() {
    if (!peerSecure || !peerSecure.connections) return 0;
    const conns = Object.values(peerSecure.connections).flat();
    return conns.filter(c => isConnectionAlive(c)).length;
}

function getFirstSecureConnection() {
    if (!peerSecure || !peerSecure.connections) return null;
    const conns = Object.values(peerSecure.connections).flat();
    return conns.find(c => isConnectionAlive(c));
}

// Helper to broadcast to Authenticated Clients only
function broadcastToAuthenticated(data) {
    if (!peerSecure || !peerSecure.connections) return;
    const connections = Object.values(peerSecure.connections).flat();
    connections.forEach(conn => {
        if (isConnectionAlive(conn)) {
            try {
                conn.send(data);
            } catch (e) {
                console.warn('[Secure] Failed to send to', conn.deviceName, ':', e.message);
            }
        }
    });
}

// Periodic cleanup: detect and close connections where the DataChannel
// has died but PeerJS still considers them "open". Runs every 15s.
let staleCleanupInterval = null;

function startStaleConnectionCleanup() {
    if (staleCleanupInterval) clearInterval(staleCleanupInterval);
    staleCleanupInterval = setInterval(() => {
        if (!peerSecure || !peerSecure.connections) return;
        const conns = Object.values(peerSecure.connections).flat();
        conns.forEach(conn => {
            if (!conn.open) return;
            const dc = conn.dataChannel;
            if (dc && (dc.readyState === 'closed' || dc.readyState === 'closing')) {
                console.warn(`[Cleanup] Stale connection detected for ${conn.deviceName || conn.peer} (DC: ${dc.readyState})`);
                connectionLog.log('stale_cleanup', { peer: conn.peer, deviceName: conn.deviceName, dcState: dc.readyState });
                conn.isAuthenticated = false;
                try { conn.close(); } catch {}
                updateGlobalStatus();
            }
        });
    }, 15000);
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

// Auto-reconnect state
let screenShareRecipient = null;
let screenShareAutoReconnect = true;

// Multi-monitor state
let selectedSourceId = null;

// Video-only state
let screenShareVideoOnly = false;

// Adaptive quality state
let statsInterval = null;
let currentMaxFps = 30;
let lastBytesSent = 0;
let lastStatsTimestamp = 0;
let consecutivePoorReadings = 0;
let consecutiveGoodReadings = 0;
let currentRtt = null;

// --- Adaptive Quality Functions ---

function applyFpsConstraint(fps) {
    if (!activeScreenStream) return;
    const videoTrack = activeScreenStream.getVideoTracks()[0];
    if (!videoTrack) return;

    try {
        videoTrack.applyConstraints({
            frameRate: { max: fps, ideal: fps }
        });
        currentMaxFps = fps;
        console.log(`[Adaptive] FPS set to ${fps}`);
        broadcastToAuthenticated({ type: 'quality-update', fps: fps });
    } catch (err) {
        console.warn('[Adaptive] Failed to apply FPS constraint:', err);
    }
}

function startAdaptiveQuality() {
    if (statsInterval) clearInterval(statsInterval);
    lastBytesSent = 0;
    lastStatsTimestamp = 0;
    consecutivePoorReadings = 0;
    consecutiveGoodReadings = 0;
    currentRtt = null;

    statsInterval = setInterval(async () => {
        if (!activeScreenCall || !activeScreenCall.peerConnection) return;

        try {
            const stats = await activeScreenCall.peerConnection.getStats();
            stats.forEach(report => {
                // Get RTT from candidate pair
                if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                    currentRtt = report.currentRoundTripTime
                        ? Math.round(report.currentRoundTripTime * 1000)
                        : null;
                }

                // Get bitrate from outbound video RTP
                if (report.type === 'outbound-rtp' && report.kind === 'video') {
                    const now = report.timestamp;
                    const bytes = report.bytesSent;

                    if (lastStatsTimestamp > 0) {
                        const timeDelta = (now - lastStatsTimestamp) / 1000;
                        const bitrate = ((bytes - lastBytesSent) * 8) / timeDelta;
                        const kbps = bitrate / 1000;

                        // Adapt FPS based on bitrate
                        if (kbps < 200) {
                            consecutivePoorReadings++;
                            consecutiveGoodReadings = 0;
                            if (consecutivePoorReadings >= 3 && currentMaxFps > 2) {
                                const newFps = Math.max(2, Math.floor(currentMaxFps / 2));
                                applyFpsConstraint(newFps);
                                consecutivePoorReadings = 0;
                            }
                        } else if (kbps > 500) {
                            consecutiveGoodReadings++;
                            consecutivePoorReadings = 0;
                            if (consecutiveGoodReadings >= 5 && currentMaxFps < 30) {
                                const newFps = Math.min(30, currentMaxFps * 2);
                                applyFpsConstraint(newFps);
                                consecutiveGoodReadings = 0;
                            }
                        } else {
                            consecutivePoorReadings = 0;
                            consecutiveGoodReadings = 0;
                        }

                        // Broadcast stats to mobile
                        broadcastToAuthenticated({
                            type: 'webrtc-stats',
                            bitrate: Math.round(kbps),
                            fps: currentMaxFps,
                            rtt: currentRtt,
                            timestamp: Date.now()
                        });
                    }

                    lastBytesSent = bytes;
                    lastStatsTimestamp = now;
                }
            });
        } catch (err) {
            console.warn('[Adaptive] Stats error:', err);
        }
    }, 3000);
}

function stopAdaptiveQuality() {
    if (statsInterval) {
        clearInterval(statsInterval);
        statsInterval = null;
    }
    currentMaxFps = 30;
}

// --- Monitor Picker ---

async function showMonitorPicker() {
    const sources = await window.electronAPI.getSources();
    if (!sources || sources.length === 0) return null;
    if (sources.length === 1) return sources[0].id;

    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.id = 'monitorPickerModal';
        modal.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);
            display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;`;

        const title = document.createElement('h3');
        title.textContent = 'Select Monitor to Share';
        title.style.cssText = 'color:#fff;margin-bottom:16px;font-size:14px;';
        modal.appendChild(title);

        const grid = document.createElement('div');
        grid.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;justify-content:center;';

        sources.forEach((source, i) => {
            const card = document.createElement('div');
            card.style.cssText = `cursor:pointer;border:2px solid #333;border-radius:8px;padding:8px;
                text-align:center;transition:border-color 0.2s;background:#1a1a1e;`;
            card.onmouseenter = () => card.style.borderColor = '#6366f1';
            card.onmouseleave = () => card.style.borderColor = '#333';

            const img = document.createElement('img');
            img.src = source.thumbnail;
            img.style.cssText = 'width:120px;height:auto;border-radius:4px;';
            card.appendChild(img);

            const label = document.createElement('div');
            label.textContent = source.name || `Screen ${i + 1}`;
            label.style.cssText = 'color:#f5f5f7;font-size:11px;margin-top:6px;';
            card.appendChild(label);

            card.onclick = () => {
                document.body.removeChild(modal);
                resolve(source.id);
            };

            grid.appendChild(card);
        });

        modal.appendChild(grid);

        const cancel = document.createElement('button');
        cancel.textContent = 'Cancel';
        cancel.style.cssText = `margin-top:16px;padding:8px 20px;background:#333;color:#fff;
            border:none;border-radius:6px;cursor:pointer;font-size:12px;`;
        cancel.onclick = () => {
            document.body.removeChild(modal);
            resolve(null);
        };
        modal.appendChild(cancel);

        document.body.appendChild(modal);
    });
}

// --- Screen Share Core ---

async function startScreenShare(recipientPeerId, retryCount = 0, videoOnly = false) {
    // Mutual exclusion: stop audio share if active
    stopAudioShare();

    if (retryCount === 0) stopScreenShare(); // Clean up any existing share
    if (screenShareRetryTimer) { clearTimeout(screenShareRetryTimer); screenShareRetryTimer = null; }

    // Track recipient and settings for auto-reconnect / retries
    screenShareRecipient = recipientPeerId;
    screenShareAutoReconnect = true;
    if (retryCount === 0) screenShareVideoOnly = videoOnly;

    try {
        const sources = await window.electronAPI.getSources();
        if (!sources || sources.length === 0) return;

        // Multi-monitor selection
        let source;
        if (retryCount > 0 && selectedSourceId) {
            // On retry, reuse previously selected source
            source = sources.find(s => s.id === selectedSourceId) || sources[0];
        } else if (sources.length > 1) {
            // Multiple monitors: show picker
            const pickedId = await showMonitorPicker();
            if (!pickedId) return; // User cancelled
            source = sources.find(s => s.id === pickedId) || sources[0];
        } else {
            source = sources[0];
        }
        selectedSourceId = source.id;

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

        // Add system audio unless video-only mode
        screenHasAudio = false;
        if (!screenShareVideoOnly) {
            const audioStream = await getSystemAudioStream();
            if (audioStream) {
                audioStream.getAudioTracks().forEach(t => videoStream.addTrack(t));
                screenHasAudio = true;
                window.electronAPI.setSystemMute(true);
                console.log('[Renderer] Screen share with system audio (PC muted)');
            } else {
                console.log('[Renderer] Screen share without audio (not available)');
            }
        } else {
            console.log('[Renderer] Video-only screen share (no audio)');
        }

        activeScreenStream = videoStream;
        activeScreenCall = peerSecure.call(recipientPeerId, videoStream);

        if (window.electronAPI.sendCursorControl) {
            window.electronAPI.sendCursorControl('start');
        }

        // Monitor video track for unexpected ending (auto-reconnect)
        const videoTrack = videoStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.onended = () => {
                console.warn('[Renderer] Screen share video track ended unexpectedly');
                if (screenShareAutoReconnect && screenShareRecipient) {
                    console.log('[Renderer] Auto-restarting screen share in 1s...');
                    cleanupScreenShare();
                    screenShareRetryTimer = setTimeout(() => {
                        startScreenShare(screenShareRecipient, 0, screenShareVideoOnly);
                    }, 1000);
                }
            };
        }

        activeScreenCall.on('close', () => {
            const wasSharing = !!activeScreenStream;
            cleanupScreenShare();
            // Auto-reconnect if the call closed unexpectedly
            if (wasSharing && screenShareAutoReconnect && screenShareRecipient) {
                console.log('[Renderer] Screen share call closed, auto-restarting in 2s...');
                screenShareRetryTimer = setTimeout(() => {
                    startScreenShare(screenShareRecipient, 0, screenShareVideoOnly);
                }, 2000);
            }
        });

        activeScreenCall.on('error', (err) => {
            console.error('[Renderer] Screen call error:', err);
            cleanupScreenShare();
            console.log(`[Renderer] Retrying screen share in 3s...`);
            screenShareRetryTimer = setTimeout(() => startScreenShare(recipientPeerId, retryCount + 1, screenShareVideoOnly), 3000);
        });

        // Start adaptive quality monitoring
        startAdaptiveQuality();
    } catch (err) {
        console.error('[Renderer] Screen Share Failed:', err);
        cleanupScreenShare();
    }
}

function cleanupScreenShare() {
    if (!activeScreenStream && !activeScreenCall) return;
    stopAdaptiveQuality();
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
    // Do NOT reset screenShareRecipient here — auto-reconnect needs it
    console.log('[Renderer] Screen share stopped');
}

function stopScreenShare() {
    screenShareAutoReconnect = false; // Intentional stop — no auto-reconnect
    if (screenShareRetryTimer) { clearTimeout(screenShareRetryTimer); screenShareRetryTimer = null; }
    if (activeScreenCall) {
        activeScreenCall.close();
    }
    cleanupScreenShare();
    screenShareRecipient = null;
    selectedSourceId = null;
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
            console.log(`[Renderer] Retrying audio share in 3s...`);
            audioShareRetryTimer = setTimeout(() => startAudioShare(recipientPeerId, retryCount + 1), 3000);
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
        const status = await window.electronAPI.getAutoLaunch();
        el.startupToggle.checked = status.enabled;
        if (!status.success) {
            el.startupToggle.disabled = true;
            el.startupToggle.title = status.error || 'Auto-launch unavailable';
        }
        el.startupToggle.addEventListener('change', async () => {
            const desired = el.startupToggle.checked;
            el.startupToggle.disabled = true;
            const result = await window.electronAPI.setAutoLaunch(desired);
            el.startupToggle.disabled = false;
            if (!result.success) {
                // Revert toggle and notify user
                el.startupToggle.checked = !desired;
                console.error('[AutoLaunch]', result.error);
                alert('Failed to update startup setting: ' + (result.error || 'Unknown error'));
            }
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
