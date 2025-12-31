/**
 * WebSocket Server - Handles communication with mobile clients
 */

const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const forge = require('node-forge');

class WebSocketServer {
    constructor(keyboardInjector, mouseInjector, port = 8765, pin = null, computerName = null, tokenStorage = null) {
        this.port = port;
        this.httpsPort = port + 1; // HTTPS on 8766
        this.keyboardInjector = keyboardInjector;
        this.mouseInjector = mouseInjector;
        this.wss = null;
        this.wssSecure = null;
        this.httpServer = null;
        this.httpsServer = null;
        this.clients = new Set();
        this.onConnectionChange = null;
        this.messageId = 0;
        this.pin = pin;
        this.computerName = computerName;
        this.tokenStorage = tokenStorage; // For persistent token auth
    }

    /**
     * Generate self-signed SSL certificate using node-forge
     */
    generateCertificate() {
        try {
            const pki = forge.pki;
            const keys = pki.rsa.generateKeyPair(2048);
            const cert = pki.createCertificate();

            cert.publicKey = keys.publicKey;
            cert.serialNumber = '01';
            cert.validity.notBefore = new Date();
            cert.validity.notAfter = new Date();
            cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

            const attrs = [{ name: 'commonName', value: 'Keymote Local' }];
            cert.setSubject(attrs);
            cert.setIssuer(attrs);
            cert.sign(keys.privateKey, forge.md.sha256.create());

            return {
                key: pki.privateKeyToPem(keys.privateKey),
                cert: pki.certificateToPem(cert)
            };
        } catch (err) {
            console.error('[WebSocketServer] Certificate generation failed:', err.message);
            return null;
        }
    }

    /**
     * Start the WebSocket server (HTTP + HTTPS)
     */
    start() {
        return new Promise((resolve, reject) => {
            // Create HTTP server to serve mobile app
            this.httpServer = http.createServer((req, res) => {
                this.handleHttpRequest(req, res);
            });

            // Create WebSocket server for HTTP
            this.wss = new WebSocket.Server({ server: this.httpServer });
            this.wss.on('connection', (ws, req) => {
                this.handleConnection(ws, req);
            });

            this.wss.on('error', (error) => {
                console.error('[WebSocketServer] WS error:', error);
            });

            // Start HTTP server
            this.httpServer.listen(this.port, '0.0.0.0', () => {
                console.log(`[WebSocketServer] HTTP listening on port ${this.port}`);
            });

            this.httpServer.on('error', (error) => {
                console.error('[WebSocketServer] HTTP server error:', error);
                reject(error);
            });

            // Try to create HTTPS server with self-signed cert
            try {
                const sslCreds = this.generateCertificate();
                if (sslCreds) {
                    this.httpsServer = https.createServer(sslCreds, (req, res) => {
                        this.handleHttpRequest(req, res);
                    });

                    this.wssSecure = new WebSocket.Server({ server: this.httpsServer });
                    this.wssSecure.on('connection', (ws, req) => {
                        this.handleConnection(ws, req);
                    });

                    this.wssSecure.on('error', (error) => {
                        console.error('[WebSocketServer] WSS error:', error);
                    });

                    this.httpsServer.listen(this.httpsPort, '0.0.0.0', () => {
                        console.log(`[WebSocketServer] HTTPS listening on port ${this.httpsPort} (for speech-to-text)`);
                        resolve(this.port);
                    });

                    this.httpsServer.on('error', (error) => {
                        console.error('[WebSocketServer] HTTPS server error:', error);
                    });
                } else {
                    console.log('[WebSocketServer] HTTPS not available - speech-to-text may not work');
                    resolve(this.port);
                }
            } catch (err) {
                console.error('[WebSocketServer] HTTPS setup failed:', err.message);
                resolve(this.port); // Continue with HTTP only
            }
        });
    }

    /**
     * Handle HTTP requests (serve mobile app)
     */
    handleHttpRequest(req, res) {
        const mobilePath = path.join(__dirname, 'mobile');
        let filePath = req.url === '/' ? '/index.html' : req.url;
        filePath = path.join(mobilePath, filePath);

        // Security: prevent directory traversal
        if (!filePath.startsWith(mobilePath)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        const ext = path.extname(filePath);
        const contentTypes = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.png': 'image/png',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon'
        };

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('Not Found');
                return;
            }
            res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
            res.end(data);
        });
    }

    /**
     * Handle new WebSocket connection
     */
    handleConnection(ws, req) {
        const clientId = Date.now().toString(36) + Math.random().toString(36).substr(2);
        const clientIp = req.socket.remoteAddress;

        console.log(`[WebSocketServer] Client connected: ${clientId} from ${clientIp}`);

        ws.clientId = clientId;
        ws.isAlive = true;
        ws.isAuthenticated = !this.pin; // Auto-authenticate if no PIN set

        if (ws.isAuthenticated) {
            this.clients.add(ws);
        }

        // Send welcome message with auth required status
        ws.send(JSON.stringify({
            type: 'connected',
            clientId: clientId,
            serverTime: Date.now(),
            authRequired: !!this.pin,
            computerName: this.computerName
        }));

        // Notify listeners if authenticated
        if (ws.isAuthenticated && this.onConnectionChange) {
            this.onConnectionChange(this.getConnectionInfo());
        }

        // Handle incoming messages
        ws.on('message', (data) => {
            this.handleMessage(ws, data);
        });

        // Handle pong (heartbeat response)
        ws.on('pong', () => {
            ws.isAlive = true;
        });

        // Handle close
        ws.on('close', () => {
            console.log(`[WebSocketServer] Client disconnected: ${clientId}`);
            this.clients.delete(ws);
            if (ws.isAuthenticated && this.onConnectionChange) {
                this.onConnectionChange(this.getConnectionInfo());
            }
        });

        // Handle errors
        ws.on('error', (error) => {
            console.error(`[WebSocketServer] Client error (${clientId}):`, error.message);
        });
    }

    /**
     * Handle incoming message from client
     */
    handleMessage(ws, data) {
        try {
            const message = JSON.parse(data.toString());

            // Handle ping (always allowed)
            if (message.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', time: Date.now() }));
                return;
            }

            // Handle authentication
            if (message.type === 'auth') {
                if (!this.pin) {
                    // No PIN set, auto-authenticate
                    ws.isAuthenticated = true;
                    this.clients.add(ws);
                    ws.send(JSON.stringify({ type: 'auth_result', success: true }));
                    if (this.onConnectionChange) {
                        this.onConnectionChange(this.getConnectionInfo());
                    }
                    return;
                }

                // Check for token authentication first
                if (message.token && this.tokenStorage) {
                    const storedToken = this.tokenStorage.getToken(message.deviceId);
                    if (storedToken && storedToken === message.token) {
                        ws.isAuthenticated = true;
                        ws.deviceId = message.deviceId;
                        this.clients.add(ws);
                        ws.send(JSON.stringify({
                            type: 'auth_result',
                            success: true,
                            computerName: this.computerName
                        }));
                        console.log(`[WebSocketServer] Client ${ws.clientId} authenticated via token`);
                        if (this.onConnectionChange) {
                            this.onConnectionChange(this.getConnectionInfo());
                        }
                        return;
                    } else {
                        // Invalid token - require new PIN auth
                        ws.send(JSON.stringify({
                            type: 'auth_result',
                            success: false,
                            error: 'Token expired or invalid',
                            requirePin: true
                        }));
                        return;
                    }
                }

                // Verify PIN and optionally computer name
                const pinMatch = message.pin === this.pin;
                const computerMatch = !message.computerName ||
                    message.computerName.toLowerCase() === this.computerName.toLowerCase();

                if (pinMatch && computerMatch) {
                    ws.isAuthenticated = true;
                    this.clients.add(ws);

                    // Generate token if rememberMe is requested
                    let newToken = null;
                    if (message.rememberMe && this.tokenStorage && message.deviceId) {
                        newToken = this.generateToken();
                        this.tokenStorage.saveToken(message.deviceId, newToken);
                        console.log(`[WebSocketServer] Generated token for device ${message.deviceId}`);
                    }

                    ws.send(JSON.stringify({
                        type: 'auth_result',
                        success: true,
                        token: newToken,
                        computerName: this.computerName
                    }));
                    console.log(`[WebSocketServer] Client ${ws.clientId} authenticated via PIN`);
                    if (this.onConnectionChange) {
                        this.onConnectionChange(this.getConnectionInfo());
                    }
                } else {
                    ws.send(JSON.stringify({
                        type: 'auth_result',
                        success: false,
                        error: pinMatch ? 'Computer name mismatch' : 'Invalid PIN'
                    }));
                    console.log(`[WebSocketServer] Client ${ws.clientId} auth failed`);
                }
                return;
            }

            // Require authentication for all other message types
            if (!ws.isAuthenticated) {
                ws.send(JSON.stringify({ type: 'error', error: 'Not authenticated' }));
                return;
            }

            // Handle keyboard events
            if (message.type === 'text' || message.type === 'key' || message.type === 'char' || message.type === 'shortcut') {
                const success = this.keyboardInjector.handleKeyEvent(message);

                // Send acknowledgment
                ws.send(JSON.stringify({
                    type: 'ack',
                    id: message.id || ++this.messageId,
                    success: success
                }));
                return;
            }

            // Handle mouse events
            if (message.type === 'mouse' && this.mouseInjector) {
                const success = this.mouseInjector.handleMouseEvent(message);
                ws.send(JSON.stringify({
                    type: 'ack',
                    id: message.id || ++this.messageId,
                    success: success
                }));
                return;
            }

            // Handle screen streaming requests
            if (message.type === 'screen') {
                if (this.onScreenRequest) {
                    this.onScreenRequest(message.action);
                }
                return;
            }

            console.log('[WebSocketServer] Unknown message type:', message.type);
        } catch (error) {
            console.error('[WebSocketServer] Message parse error:', error.message);
        }
    }

    /**
     * Start heartbeat to detect dead connections
     */
    startHeartbeat(interval = 30000) {
        this.heartbeatInterval = setInterval(() => {
            this.wss.clients.forEach((ws) => {
                if (!ws.isAlive) {
                    console.log('[WebSocketServer] Terminating dead connection');
                    return ws.terminate();
                }
                ws.isAlive = false;
                ws.ping();
            });
        }, interval);
    }

    /**
     * Get current connection info
     */
    getConnectionInfo() {
        return {
            connected: this.clients.size > 0,
            clientCount: this.clients.size,
            clients: Array.from(this.clients).map(ws => ({
                id: ws.clientId,
                alive: ws.isAlive
            }))
        };
    }

    /**
     * Broadcast message to all clients
     */
    broadcast(message) {
        const data = JSON.stringify(message);
        this.clients.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(data);
            }
        });
    }

    /**
     * Generate a secure random token
     */
    generateToken() {
        const crypto = require('crypto');
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Stop the server
     */
    stop() {
        return new Promise((resolve) => {
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
            }

            // Close all client connections
            this.clients.forEach((ws) => {
                ws.close();
            });

            if (this.wss) {
                this.wss.close(() => {
                    if (this.httpServer) {
                        this.httpServer.close(() => {
                            console.log('[WebSocketServer] Stopped');
                            resolve();
                        });
                    } else {
                        resolve();
                    }
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = WebSocketServer;
