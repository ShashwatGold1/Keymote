/**
 * Mouse Injector - Persistent PowerShell process for fast mouse control
 */

const { spawn } = require('child_process');

// Persistent PowerShell process
let psProcess = null;
let isReady = false;
let commandQueue = [];

// C# code for mouse simulation
const CSHARP_CODE = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class MouseSim {
    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int X, int Y);
    
    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT lpPoint);
    
    [DllImport("user32.dll")]
    private static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);
    
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }
    
    private const uint LEFTDOWN = 0x0002, LEFTUP = 0x0004;
    private const uint RIGHTDOWN = 0x0008, RIGHTUP = 0x0010;
    private const uint MIDDLEDOWN = 0x0020, MIDDLEUP = 0x0040;
    private const uint WHEEL = 0x0800;
    
    public static void MoveTo(int x, int y) { SetCursorPos(x, y); }
    
    public static void MoveBy(int dx, int dy) {
        POINT pt; GetCursorPos(out pt);
        SetCursorPos(pt.X + dx, pt.Y + dy);
    }
    
    public static void Left() {
        mouse_event(LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
        mouse_event(LEFTUP, 0, 0, 0, UIntPtr.Zero);
    }
    
    public static void Right() {
        mouse_event(RIGHTDOWN, 0, 0, 0, UIntPtr.Zero);
        mouse_event(RIGHTUP, 0, 0, 0, UIntPtr.Zero);
    }
    
    public static void Middle() {
        mouse_event(MIDDLEDOWN, 0, 0, 0, UIntPtr.Zero);
        mouse_event(MIDDLEUP, 0, 0, 0, UIntPtr.Zero);
    }
    
    public static void Scroll(int delta) {
        mouse_event(WHEEL, 0, 0, delta, UIntPtr.Zero);
    }
}
"@ -Language CSharp

Write-Output "READY"

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($line -eq $null -or $line -eq "EXIT") { break }
    
    try {
        $parts = $line -split ','
        $action = $parts[0]
        
        switch ($action) {
            "move" { [MouseSim]::MoveBy([int]$parts[1], [int]$parts[2]) }
            "moveto" { [MouseSim]::MoveTo([int]$parts[1], [int]$parts[2]) }
            "left" { [MouseSim]::Left() }
            "right" { [MouseSim]::Right() }
            "middle" { [MouseSim]::Middle() }
            "scroll" { [MouseSim]::Scroll([int]$parts[1]) }
        }
        Write-Output "OK"
    } catch {
        Write-Output "ERR"
    }
}
`;

function initialize() {
    if (psProcess) return true;

    try {
        // Start persistent PowerShell process
        psProcess = spawn('powershell.exe', [
            '-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', '-'
        ], {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true
        });

        // Wait for READY signal
        psProcess.stdout.on('data', (data) => {
            const str = data.toString().trim();
            if (str === 'READY') {
                isReady = true;
                console.log('[MouseInjector] Persistent process ready');
                // Process queued commands
                while (commandQueue.length > 0) {
                    const cmd = commandQueue.shift();
                    sendCommand(cmd);
                }
            }
        });

        psProcess.stderr.on('data', (data) => {
            console.error('[MouseInjector] PS Error:', data.toString());
        });

        psProcess.on('close', () => {
            console.log('[MouseInjector] Process closed');
            psProcess = null;
            isReady = false;
        });

        // Send the C# code
        psProcess.stdin.write(CSHARP_CODE + '\n');

        console.log('[MouseInjector] Starting persistent process...');
        return true;
    } catch (error) {
        console.error('[MouseInjector] Init error:', error);
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
        console.error('[MouseInjector] Send error:', e);
    }
}

function move(dx, dy) {
    sendCommand(`move,${Math.round(dx)},${Math.round(dy)}`);
    return true;
}

function moveTo(x, y) {
    sendCommand(`moveto,${Math.round(x)},${Math.round(y)}`);
    return true;
}

function leftClick() {
    sendCommand('left');
    return true;
}

function rightClick() {
    sendCommand('right');
    return true;
}

function middleClick() {
    sendCommand('middle');
    return true;
}

function scroll(delta) {
    sendCommand(`scroll,${Math.round(delta)}`);
    return true;
}

function handleMouseEvent(event) {
    switch (event.action) {
        case 'move': return move(event.dx || 0, event.dy || 0);
        case 'moveto': return moveTo(event.x || 0, event.y || 0);
        case 'left': return leftClick();
        case 'right': return rightClick();
        case 'middle': return middleClick();
        case 'scroll': return scroll(event.delta || 0);
        default: return false;
    }
}

function cleanup() {
    if (psProcess) {
        try {
            psProcess.stdin.write('EXIT\n');
            psProcess.kill();
        } catch (e) { }
        psProcess = null;
        isReady = false;
    }
}

module.exports = { initialize, move, moveTo, leftClick, rightClick, middleClick, scroll, handleMouseEvent, cleanup };
