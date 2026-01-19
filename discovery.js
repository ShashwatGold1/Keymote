/**
 * Discovery Service - mDNS/Bonjour for zero-config device discovery
 */

const Bonjour = require('bonjour-service').Bonjour;
const os = require('os');

class DiscoveryService {
    constructor(port = 8765) {
        this.port = port;
        this.bonjour = null;
        this.service = null;
        this.serviceName = 'RemoteInput';
        this.serviceType = 'remoteinput';
    }

    /**
     * Get the local IP address
     */
    getLocalIP() {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                // Skip internal and non-IPv4 addresses
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
        return '127.0.0.1';
    }

    /**
     * Get all local IP addresses
     */
    getAllLocalIPs() {
        const ips = [];
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    ips.push({ name, address: iface.address });
                }
            }
        }
        return ips;
    }

    /**
     * Get Tailscale IP if available (100.x.x.x range)
     */
    getTailscaleIP() {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            // Tailscale interface is usually named "Tailscale" on Windows
            const isTailscaleInterface = name.toLowerCase().includes('tailscale');
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    // Tailscale uses 100.x.x.x CGNAT range
                    if (iface.address.startsWith('100.') || isTailscaleInterface) {
                        return { name, address: iface.address };
                    }
                }
            }
        }
        return null;
    }

    /**
     * Start advertising the service
     */
    start() {
        return new Promise((resolve, reject) => {
            try {
                this.bonjour = new Bonjour();

                const hostname = os.hostname();
                const localIP = this.getLocalIP();
                const tailscaleIP = this.getTailscaleIP();

                this.service = this.bonjour.publish({
                    name: `${this.serviceName}-${hostname}`,
                    type: this.serviceType,
                    port: this.port,
                    txt: {
                        ip: localIP,
                        hostname: hostname,
                        version: '1.0'
                    }
                });

                this.service.on('up', () => {
                    console.log(`[Discovery] Service advertised: ${this.serviceName} at ${localIP}:${this.port}`);
                    if (tailscaleIP) {
                        console.log(`[Discovery] Tailscale detected: ${tailscaleIP.address} (${tailscaleIP.name})`);
                    }
                    resolve({
                        ip: localIP,
                        port: this.port,
                        hostname: hostname,
                        allIPs: this.getAllLocalIPs(),
                        tailscaleIP: tailscaleIP ? tailscaleIP.address : null
                    });
                });

                this.service.on('error', (error) => {
                    console.error('[Discovery] Service error:', error);
                    reject(error);
                });
            } catch (error) {
                console.error('[Discovery] Failed to start:', error);
                reject(error);
            }
        });
    }

    /**
     * Get connection URL for mobile
     */
    getConnectionURL() {
        const ip = this.getLocalIP();
        return `http://${ip}:${this.port}`;
    }

    /**
     * Stop the service
     */
    stop() {
        return new Promise((resolve) => {
            if (this.service) {
                this.bonjour.unpublishAll(() => {
                    console.log('[Discovery] Service unpublished');
                    this.bonjour.destroy();
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = DiscoveryService;
