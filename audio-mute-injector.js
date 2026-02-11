/**
 * Audio Mute Injector - Persistent PowerShell process for instant system mute/unmute
 * Uses Windows Core Audio API (IAudioEndpointVolume) to SET mute state explicitly (not toggle)
 */

const { spawn } = require('child_process');

let psProcess = null;
let isReady = false;
let commandQueue = [];
let muteRefCount = 0;

const CSHARP_CODE = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class AudioMute {
    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume {
        int _0(); int _1(); int _2(); int _3(); int _4(); int _5(); int _6();
        int _7(); int _8(); int _9(); int _10();
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
        int GetMute(out bool pbMute);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice {
        int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator {
        int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorClass { }

    private static IAudioEndpointVolume endpointVolume;

    public static bool Init() {
        var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorClass());
        IMMDevice device;
        enumerator.GetDefaultAudioEndpoint(0, 1, out device);
        var iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
        object epv;
        device.Activate(ref iid, 1, IntPtr.Zero, out epv);
        endpointVolume = (IAudioEndpointVolume)epv;
        return endpointVolume != null;
    }

    public static void Mute() {
        var guid = Guid.Empty;
        endpointVolume.SetMute(true, ref guid);
    }

    public static void Unmute() {
        var guid = Guid.Empty;
        endpointVolume.SetMute(false, ref guid);
    }
}
"@ -Language CSharp

[AudioMute]::Init() | Out-Null

Write-Output "READY"

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($line -eq $null -or $line -eq "EXIT") { break }

    try {
        switch ($line) {
            "MUTE"   { [AudioMute]::Mute(); Write-Output "MUTED" }
            "UNMUTE" { [AudioMute]::Unmute(); Write-Output "UNMUTED" }
        }
    } catch {
        Write-Output "ERR"
    }
}
`;

function initialize() {
    if (psProcess) return true;

    try {
        psProcess = spawn('powershell.exe', [
            '-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', '-'
        ], {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true
        });

        psProcess.stdout.on('data', (data) => {
            const str = data.toString().trim();
            if (str === 'READY') {
                isReady = true;
                console.log('[AudioMute] Persistent process ready');
                while (commandQueue.length > 0) {
                    const cmd = commandQueue.shift();
                    sendCommand(cmd);
                }
            }
        });

        psProcess.stderr.on('data', (data) => {
            console.error('[AudioMute] PS Error:', data.toString().trim());
        });

        psProcess.on('close', () => {
            console.log('[AudioMute] Process closed');
            psProcess = null;
            isReady = false;
        });

        psProcess.stdin.write(CSHARP_CODE + '\n');

        console.log('[AudioMute] Starting persistent process...');
        return true;
    } catch (error) {
        console.error('[AudioMute] Init error:', error);
        return false;
    }
}

function sendCommand(cmd) {
    if (!psProcess || !isReady) {
        commandQueue.push(cmd);
        if (!psProcess) initialize();
        return;
    }
    try {
        psProcess.stdin.write(cmd + '\n');
    } catch (e) {
        console.error('[AudioMute] Send error:', e);
    }
}

function setMute(shouldMute) {
    if (shouldMute) {
        muteRefCount++;
        if (muteRefCount === 1) {
            sendCommand('MUTE');
        }
    } else {
        muteRefCount = Math.max(0, muteRefCount - 1);
        if (muteRefCount === 0) {
            sendCommand('UNMUTE');
        }
    }
}

function cleanup() {
    // Always unmute on cleanup
    if (muteRefCount > 0) {
        muteRefCount = 0;
        sendCommand('UNMUTE');
    }
    if (psProcess) {
        try {
            psProcess.stdin.write('EXIT\n');
            psProcess.kill();
        } catch (e) { }
        psProcess = null;
        isReady = false;
    }
}

module.exports = { initialize, setMute, cleanup };
