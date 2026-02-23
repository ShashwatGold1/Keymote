// =============================================
// Presence Monitor — Standalone device liveness detection
// Shared by desktop (renderer.js) and mobile (app.js)
// Does NOT touch any connection/auth logic — only detects
// when both devices are live on the signaling server.
// =============================================

class PresenceMonitor {
    constructor(peerConfig) {
        // Strip debug noise for presence peer (less log clutter)
        this.peerConfig = { ...peerConfig, debug: 0 };
        this.peer = null;
        this.polling = false;
        this.pollTimer = null;
        this.hostId = null;
        this.onPeerAlive = null;
    }

    // ─── Desktop: host presence endpoint ───
    // Creates a peer with ID `presence-{hostId}` that responds to pings.
    // Call once at startup. Stays alive for the lifetime of the app.
    startHost(hostId) {
        this.hostId = hostId;
        const presenceId = `presence-${hostId}`;

        // Clear any pending retry from previous attempt
        if (this._hostRetryTimer) {
            clearTimeout(this._hostRetryTimer);
            this._hostRetryTimer = null;
        }

        if (this.peer && !this.peer.destroyed) this.peer.destroy();

        this._hostRetrying = false;
        this.peer = new Peer(presenceId, this.peerConfig);

        this.peer.on('open', () => {
            console.log('[Presence] Host ready:', presenceId);
            this._hostRetryCount = 0;
            this._hostRetrying = false;
        });

        this.peer.on('connection', (conn) => {
            conn.on('data', (data) => {
                if (data && data.type === 'presence-ping') {
                    conn.send({ type: 'presence-pong' });
                    // Close after responding — this is just a liveness check
                    setTimeout(() => { try { conn.close(); } catch {} }, 200);
                }
            });
            // Auto-close if client doesn't send anything within 5s
            const safetyClose = setTimeout(() => {
                try { conn.close(); } catch {}
            }, 5000);
            conn.on('close', () => clearTimeout(safetyClose));
        });

        // Re-register on signaling server if disconnected
        this.peer.on('disconnected', () => {
            // Skip if unavailable-id handler is already scheduling a retry
            if (this._hostRetrying) return;
            console.log('[Presence] Host disconnected from signaling, reconnecting...');
            if (this.peer && !this.peer.destroyed) {
                try { this.peer.reconnect(); } catch {}
            }
        });

        this.peer.on('error', (err) => {
            if (err.type === 'unavailable-id') {
                // Suppress the 'disconnected' handler — we'll handle retry here
                this._hostRetrying = true;
                this._hostRetryCount = (this._hostRetryCount || 0) + 1;
                // First 3 retries: fast (3s). After that: slow (30s) to let
                // the signaling server expire the ghost peer (~60s timeout).
                const fast = this._hostRetryCount <= 3;
                const delay = fast ? 3000 : 30000;
                if (fast) {
                    console.warn(`[Presence] Host ID taken, retry #${this._hostRetryCount} in ${delay / 1000}s`);
                } else if (this._hostRetryCount === 4) {
                    console.warn(`[Presence] Host ID still taken — slowing to ${delay / 1000}s retries (waiting for server to expire ghost peer)`);
                }
                // Don't destroy the failed peer again on retry — it never registered.
                // Just wait and create a fresh one.
                this._hostRetryTimer = setTimeout(() => {
                    this._hostRetryTimer = null;
                    this.startHost(hostId);
                }, delay);
            }
        });
    }

    // ─── Mobile: poll for desktop presence ───
    // Tries to connect to `presence-{hostId}` every 1s.
    // When ping/pong succeeds, calls onPeerAlive() and stops.
    startPolling(hostId, onPeerAlive) {
        if (this.polling) return; // Already polling

        this.hostId = hostId;
        this.onPeerAlive = onPeerAlive;
        this.polling = true;
        this._pendingConn = null;

        console.log('[Presence] Start polling for:', `presence-${hostId}`);

        // Create a persistent peer for polling (stays connected to signaling server)
        if (this.peer && !this.peer.destroyed) this.peer.destroy();
        this.peer = new Peer(this.peerConfig);

        this.peer.on('open', () => {
            console.log('[Presence] Poller peer ready');
            this._schedulePoll();
        });

        // peer-unavailable = desktop not online (expected during polling)
        this.peer.on('error', (err) => {
            if (err.type === 'peer-unavailable') {
                // Desktop not online yet — schedule next poll
                this._schedulePoll();
            } else {
                console.warn('[Presence] Poller error:', err.type);
            }
        });

        this.peer.on('disconnected', () => {
            if (this.polling && this.peer && !this.peer.destroyed) {
                this.peer.reconnect();
            }
        });
    }

    _schedulePoll() {
        if (!this.polling) return;
        if (this.pollTimer) clearTimeout(this.pollTimer);
        this.pollTimer = setTimeout(() => this._poll(), 1000);
    }

    _poll() {
        if (!this.polling || !this.peer || this.peer.destroyed) return;

        // Don't stack connections — skip if previous is still pending
        if (this._pendingConn) return this._schedulePoll();

        const targetId = `presence-${this.hostId}`;
        const conn = this.peer.connect(targetId);
        this._pendingConn = conn;

        // Safety timeout: if nothing happens in 5s, close and retry
        const timeout = setTimeout(() => {
            this._pendingConn = null;
            try { conn.close(); } catch {}
            this._schedulePoll();
        }, 5000);

        conn.on('open', () => {
            // Connection opened — desktop is on the signaling server.
            // Send ping to confirm data channel actually works.
            conn.send({ type: 'presence-ping' });
        });

        conn.on('data', (data) => {
            if (data && data.type === 'presence-pong') {
                // Desktop is ALIVE — confirmed via data channel roundtrip
                console.log('[Presence] Desktop is alive!');
                clearTimeout(timeout);
                this._pendingConn = null;
                try { conn.close(); } catch {}
                this.stopPolling();

                if (this.onPeerAlive) {
                    this.onPeerAlive();
                }
            }
        });

        conn.on('close', () => {
            clearTimeout(timeout);
            this._pendingConn = null;
            // Don't schedule next poll here — wait for error or timeout
        });

        conn.on('error', () => {
            clearTimeout(timeout);
            this._pendingConn = null;
            this._schedulePoll();
        });
    }

    // ─── Stop polling (called on successful reconnection or logout) ───
    stopPolling() {
        if (!this.polling) return;
        this.polling = false;
        console.log('[Presence] Polling stopped');
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        if (this._pendingConn) {
            try { this._pendingConn.close(); } catch {}
            this._pendingConn = null;
        }
    }

    // ─── Immediate poll (called when app comes to foreground) ───
    pollNow() {
        if (!this.polling) return;
        if (this.pollTimer) clearTimeout(this.pollTimer);
        this._poll();
    }

    // ─── Full cleanup ───
    destroy() {
        this.stopPolling();
        if (this.peer) {
            try { this.peer.destroy(); } catch {}
            this.peer = null;
        }
    }
}
