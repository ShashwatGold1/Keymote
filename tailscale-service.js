/**
 * Tailscale Service - Control Tailscale VPN from the app
 * Requires Tailscale to be installed on the system
 */

const { exec, spawn } = require('child_process');
const path = require('path');

// Common Tailscale CLI paths on Windows
const TAILSCALE_PATHS = [
    'C:\\Program Files\\Tailscale\\tailscale.exe',
    'C:\\Program Files (x86)\\Tailscale\\tailscale.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Tailscale', 'tailscale.exe'),
    'tailscale' // If in PATH
];

let tailscalePath = null;
let isConnected = false;
let tailscaleIP = null;

/**
 * Find Tailscale CLI path
 */
async function findTailscale() {
    if (tailscalePath) return tailscalePath;

    for (const testPath of TAILSCALE_PATHS) {
        try {
            await execPromise(`"${testPath}" version`);
            tailscalePath = testPath;
            console.log('[TailscaleService] Found Tailscale at:', tailscalePath);
            return tailscalePath;
        } catch {
            // Try next path
        }
    }
    console.log('[TailscaleService] Tailscale not found');
    return null;
}

/**
 * Execute command and return promise
 */
function execPromise(command) {
    return new Promise((resolve, reject) => {
        exec(command, { windowsHide: true }, (error, stdout, stderr) => {
            if (error) reject(error);
            else resolve(stdout.trim());
        });
    });
}

/**
 * Check if Tailscale is installed
 */
async function isInstalled() {
    const tsPath = await findTailscale();
    return tsPath !== null;
}

/**
 * Get Tailscale status
 */
async function getStatus() {
    const tsPath = await findTailscale();
    if (!tsPath) return { installed: false, connected: false, ip: null };

    try {
        const output = await execPromise(`"${tsPath}" status --json`);
        const status = JSON.parse(output);

        isConnected = status.BackendState === 'Running';
        tailscaleIP = status.Self?.TailscaleIPs?.[0] || null;

        return {
            installed: true,
            connected: isConnected,
            ip: tailscaleIP,
            hostname: status.Self?.HostName || null
        };
    } catch (error) {
        // Try simple status check
        try {
            const output = await execPromise(`"${tsPath}" ip`);
            tailscaleIP = output.split('\n')[0];
            isConnected = true;
            return { installed: true, connected: true, ip: tailscaleIP };
        } catch {
            return { installed: true, connected: false, ip: null };
        }
    }
}

/**
 * Start Tailscale connection
 */
async function connect() {
    const tsPath = await findTailscale();
    if (!tsPath) {
        console.log('[TailscaleService] Cannot connect - Tailscale not installed');
        return false;
    }

    try {
        console.log('[TailscaleService] Connecting...');
        await execPromise(`"${tsPath}" up`);

        // Wait a bit for connection
        await new Promise(r => setTimeout(r, 2000));

        const status = await getStatus();
        console.log('[TailscaleService] Connected:', status.ip);
        return status.connected;
    } catch (error) {
        console.error('[TailscaleService] Connect error:', error.message);
        return false;
    }
}

/**
 * Stop Tailscale connection  
 */
async function disconnect() {
    const tsPath = await findTailscale();
    if (!tsPath) return false;

    try {
        console.log('[TailscaleService] Disconnecting...');
        await execPromise(`"${tsPath}" down`);
        isConnected = false;
        tailscaleIP = null;
        console.log('[TailscaleService] Disconnected');
        return true;
    } catch (error) {
        console.error('[TailscaleService] Disconnect error:', error.message);
        return false;
    }
}

/**
 * Get current Tailscale IP
 */
function getIP() {
    return tailscaleIP;
}

/**
 * Check if currently connected
 */
function isActive() {
    return isConnected;
}

module.exports = {
    isInstalled,
    getStatus,
    connect,
    disconnect,
    getIP,
    isActive
};
