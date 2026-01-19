/**
 * Tunnel Service - Creates public URL for internet access
 * Uses localtunnel to expose local server to internet
 */

const localtunnel = require('localtunnel');

let tunnel = null;
let publicUrl = null;
let onUrlCallback = null;

async function startTunnel(port, subdomain = null) {
    try {
        console.log('[TunnelService] Starting tunnel for port:', port);

        const options = { port };
        if (subdomain) options.subdomain = subdomain;

        tunnel = await localtunnel(options);
        publicUrl = tunnel.url;

        console.log('[TunnelService] Tunnel created:', publicUrl);
        console.log('[TunnelService] NOTE: First visit the URL in browser and enter your public IP as password');

        // Notify callback if set
        if (onUrlCallback) onUrlCallback(publicUrl);

        // Handle tunnel close
        tunnel.on('close', () => {
            console.log('[TunnelService] Tunnel closed');
            publicUrl = null;
            // Try to reconnect after 5 seconds
            setTimeout(() => {
                if (tunnel) startTunnel(port, subdomain);
            }, 5000);
        });

        tunnel.on('error', (err) => {
            console.error('[TunnelService] Tunnel error:', err);
        });

        return publicUrl;
    } catch (error) {
        console.error('[TunnelService] Failed to start tunnel:', error);
        return null;
    }
}

function stopTunnel() {
    if (tunnel) {
        tunnel.close();
        tunnel = null;
        publicUrl = null;
        console.log('[TunnelService] Tunnel stopped');
    }
}

function getPublicUrl() {
    return publicUrl;
}

function onUrlUpdate(callback) {
    onUrlCallback = callback;
}

module.exports = {
    startTunnel,
    stopTunnel,
    getPublicUrl,
    onUrlUpdate
};
