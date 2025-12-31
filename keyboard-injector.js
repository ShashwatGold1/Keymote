/**
 * Keyboard Injector - Complete keyboard support
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Complete Virtual Key Codes for Windows
const VK_CODES = {
    // Special keys
    'Backspace': 0x08,
    'Tab': 0x09,
    'Clear': 0x0C,
    'Enter': 0x0D,
    'Shift': 0x10,
    'Control': 0x11,
    'Alt': 0x12,
    'Pause': 0x13,
    'CapsLock': 0x14,
    'Escape': 0x1B,
    'Space': 0x20,
    'PageUp': 0x21,
    'PageDown': 0x22,
    'End': 0x23,
    'Home': 0x24,
    'ArrowLeft': 0x25,
    'ArrowUp': 0x26,
    'ArrowRight': 0x27,
    'ArrowDown': 0x28,
    'Select': 0x29,
    'Print': 0x2A,
    'Execute': 0x2B,
    'PrintScreen': 0x2C,
    'Insert': 0x2D,
    'Delete': 0x2E,
    'Help': 0x2F,

    // Number keys (top row)
    '0': 0x30, '1': 0x31, '2': 0x32, '3': 0x33, '4': 0x34,
    '5': 0x35, '6': 0x36, '7': 0x37, '8': 0x38, '9': 0x39,

    // Letter keys
    'A': 0x41, 'B': 0x42, 'C': 0x43, 'D': 0x44, 'E': 0x45,
    'F': 0x46, 'G': 0x47, 'H': 0x48, 'I': 0x49, 'J': 0x4A,
    'K': 0x4B, 'L': 0x4C, 'M': 0x4D, 'N': 0x4E, 'O': 0x4F,
    'P': 0x50, 'Q': 0x51, 'R': 0x52, 'S': 0x53, 'T': 0x54,
    'U': 0x55, 'V': 0x56, 'W': 0x57, 'X': 0x58, 'Y': 0x59,
    'Z': 0x5A,

    // Windows keys
    'Meta': 0x5B,
    'Win': 0x5B,
    'Windows': 0x5B,
    'LeftWin': 0x5B,
    'RightWin': 0x5C,
    'ContextMenu': 0x5D,
    'Apps': 0x5D,

    // Numpad keys
    'Numpad0': 0x60, 'Numpad1': 0x61, 'Numpad2': 0x62, 'Numpad3': 0x63,
    'Numpad4': 0x64, 'Numpad5': 0x65, 'Numpad6': 0x66, 'Numpad7': 0x67,
    'Numpad8': 0x68, 'Numpad9': 0x69,
    'NumpadMultiply': 0x6A, 'Multiply': 0x6A,
    'NumpadAdd': 0x6B, 'Add': 0x6B,
    'NumpadSeparator': 0x6C,
    'NumpadSubtract': 0x6D, 'Subtract': 0x6D,
    'NumpadDecimal': 0x6E, 'Decimal': 0x6E,
    'NumpadDivide': 0x6F, 'Divide': 0x6F,

    // Function keys
    'F1': 0x70, 'F2': 0x71, 'F3': 0x72, 'F4': 0x73,
    'F5': 0x74, 'F6': 0x75, 'F7': 0x76, 'F8': 0x77,
    'F9': 0x78, 'F10': 0x79, 'F11': 0x7A, 'F12': 0x7B,
    'F13': 0x7C, 'F14': 0x7D, 'F15': 0x7E, 'F16': 0x7F,
    'F17': 0x80, 'F18': 0x81, 'F19': 0x82, 'F20': 0x83,
    'F21': 0x84, 'F22': 0x85, 'F23': 0x86, 'F24': 0x87,

    // Lock keys
    'NumLock': 0x90,
    'ScrollLock': 0x91,

    // Modifier keys (left/right variants)
    'ShiftLeft': 0xA0, 'LeftShift': 0xA0,
    'ShiftRight': 0xA1, 'RightShift': 0xA1,
    'ControlLeft': 0xA2, 'LeftControl': 0xA2,
    'ControlRight': 0xA3, 'RightControl': 0xA3,
    'AltLeft': 0xA4, 'LeftAlt': 0xA4,
    'AltRight': 0xA5, 'RightAlt': 0xA5,

    // Browser keys
    'BrowserBack': 0xA6,
    'BrowserForward': 0xA7,
    'BrowserRefresh': 0xA8,
    'BrowserStop': 0xA9,
    'BrowserSearch': 0xAA,
    'BrowserFavorites': 0xAB,
    'BrowserHome': 0xAC,

    // Media keys
    'VolumeMute': 0xAD,
    'VolumeDown': 0xAE,
    'VolumeUp': 0xAF,
    'MediaNextTrack': 0xB0,
    'MediaPrevTrack': 0xB1,
    'MediaStop': 0xB2,
    'MediaPlayPause': 0xB3,

    // OEM keys (punctuation/symbols)
    'Semicolon': 0xBA, ';': 0xBA,
    'Equal': 0xBB, '=': 0xBB,
    'Comma': 0xBC, ',': 0xBC,
    'Minus': 0xBD, '-': 0xBD,
    'Period': 0xBE, '.': 0xBE,
    'Slash': 0xBF, '/': 0xBF,
    'Backquote': 0xC0, '`': 0xC0,
    'BracketLeft': 0xDB, '[': 0xDB,
    'Backslash': 0xDC, '\\': 0xDC,
    'BracketRight': 0xDD, ']': 0xDD,
    'Quote': 0xDE, "'": 0xDE
};

const PS_SCRIPT_PATH = path.join(__dirname, 'keyboard-helper.ps1');

const PS_SCRIPT_CONTENT = `
param(
    [Parameter(Mandatory=$true)]
    [string]$Action,
    
    [Parameter(Mandatory=$false)]
    [string]$Text,
    
    [Parameter(Mandatory=$false)]
    [int]$VkCode,
    
    [Parameter(Mandatory=$false)]
    [switch]$Ctrl,
    
    [Parameter(Mandatory=$false)]
    [switch]$Alt,
    
    [Parameter(Mandatory=$false)]
    [switch]$Shift,
    
    [Parameter(Mandatory=$false)]
    [switch]$Win
)

Add-Type -AssemblyName System.Windows.Forms

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;

public class KeyboardSim {
    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    private const uint KEYEVENTF_KEYUP = 0x0002;
    
    private const byte VK_CONTROL = 0x11;
    private const byte VK_ALT = 0x12;
    private const byte VK_SHIFT = 0x10;
    private const byte VK_LWIN = 0x5B;

    public static void PressVk(byte vk) {
        keybd_event(vk, 0, 0, UIntPtr.Zero);
        Thread.Sleep(10);
        keybd_event(vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }

    public static void KeyDown(byte vk) {
        keybd_event(vk, 0, 0, UIntPtr.Zero);
    }

    public static void KeyUp(byte vk) {
        keybd_event(vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }
    
    public static void SendKeyWithModifiers(byte vk, bool ctrl, bool alt, bool shift, bool win) {
        if (ctrl) KeyDown(VK_CONTROL);
        if (alt) KeyDown(VK_ALT);
        if (shift) KeyDown(VK_SHIFT);
        if (win) KeyDown(VK_LWIN);
        
        Thread.Sleep(10);
        PressVk(vk);
        Thread.Sleep(10);
        
        if (win) KeyUp(VK_LWIN);
        if (shift) KeyUp(VK_SHIFT);
        if (alt) KeyUp(VK_ALT);
        if (ctrl) KeyUp(VK_CONTROL);
    }
    
    public static void PressWinKey() {
        keybd_event(VK_LWIN, 0, 0, UIntPtr.Zero);
        Thread.Sleep(50);
        keybd_event(VK_LWIN, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }
}
"@ -Language CSharp

switch ($Action) {
    "text" {
        if ($Text) {
            $escapedText = $Text -replace '[+^%~(){}\\[\\]]', '{$0}'
            [System.Windows.Forms.SendKeys]::SendWait($escapedText)
            Write-Output "OK"
        }
    }
    "key" {
        [KeyboardSim]::SendKeyWithModifiers([byte]$VkCode, $Ctrl, $Alt, $Shift, $Win)
        Write-Output "OK"
    }
    "winkey" {
        [KeyboardSim]::PressWinKey()
        Write-Output "OK"
    }
}
`;

let scriptReady = false;
const inputQueue = [];
let isProcessing = false;

function initialize() {
    try {
        fs.writeFileSync(PS_SCRIPT_PATH, PS_SCRIPT_CONTENT, 'utf8');
        scriptReady = true;
        console.log('[KeyboardInjector] Script created at:', PS_SCRIPT_PATH);
        return true;
    } catch (error) {
        console.error('[KeyboardInjector] Failed to create script:', error);
        return false;
    }
}

function runScript(args) {
    return new Promise((resolve, reject) => {
        const cmdArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT_PATH, ...args];
        const ps = spawn('powershell.exe', cmdArgs, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        let stdout = '', stderr = '';
        ps.stdout.on('data', (data) => { stdout += data.toString(); });
        ps.stderr.on('data', (data) => { stderr += data.toString(); });
        ps.on('close', (code) => {
            if (stdout.includes('OK')) resolve(true);
            else { console.error('[KeyboardInjector] Error:', stderr || stdout); resolve(false); }
        });
        ps.on('error', (err) => { console.error('[KeyboardInjector] Spawn error:', err); reject(err); });
    });
}

async function processQueue() {
    if (isProcessing || inputQueue.length === 0) return;
    isProcessing = true;
    while (inputQueue.length > 0) {
        const item = inputQueue.shift();
        try {
            if (item.type === 'text') {
                await runScript(['-Action', 'text', '-Text', item.text]);
            } else if (item.type === 'key') {
                const args = ['-Action', 'key', '-VkCode', item.vkCode.toString()];
                if (item.modifiers?.ctrl) args.push('-Ctrl');
                if (item.modifiers?.alt) args.push('-Alt');
                if (item.modifiers?.shift) args.push('-Shift');
                if (item.modifiers?.win) args.push('-Win');
                await runScript(args);
            } else if (item.type === 'winkey') {
                await runScript(['-Action', 'winkey']);
            }
        } catch (error) {
            console.error('[KeyboardInjector] Queue error:', error);
        }
    }
    isProcessing = false;
}

function queueText(text) {
    if (!text) return;
    if (!scriptReady) initialize();
    console.log('[KeyboardInjector] Queuing text:', JSON.stringify(text));
    inputQueue.push({ type: 'text', text });
    processQueue();
}

function queueKey(vkCode, modifiers = {}) {
    if (!scriptReady) initialize();
    console.log('[KeyboardInjector] Queuing key:', vkCode, 'modifiers:', modifiers);
    inputQueue.push({ type: 'key', vkCode, modifiers });
    processQueue();
}

function queueWinKey() {
    if (!scriptReady) initialize();
    console.log('[KeyboardInjector] Queuing Windows key');
    inputQueue.push({ type: 'winkey' });
    processQueue();
}

async function sendText(text) { queueText(text); return true; }
async function sendKey(vkCode, modifiers = {}) { queueKey(vkCode, modifiers); return true; }

async function sendSpecialKey(keyName, modifiers = {}) {
    // Handle standalone Windows key press
    if (keyName === 'Win' || keyName === 'Windows' || keyName === 'Meta') {
        if (!modifiers.ctrl && !modifiers.alt && !modifiers.shift) {
            queueWinKey();
            return true;
        }
    }

    const vkCode = VK_CODES[keyName] || VK_CODES[keyName.toUpperCase()];
    if (vkCode === undefined) {
        console.warn('[KeyboardInjector] Unknown key:', keyName);
        return false;
    }
    return sendKey(vkCode, modifiers);
}

async function handleKeyEvent(event) {
    console.log('[KeyboardInjector] Handling event:', JSON.stringify(event));
    try {
        switch (event.type) {
            case 'text': return await sendText(event.text);
            case 'key': return await sendSpecialKey(event.key, event.modifiers || {});
            case 'char': return await sendText(event.char);
            case 'shortcut': return await sendSpecialKey(event.key, event.modifiers || {});
            default: console.warn('[KeyboardInjector] Unknown event type:', event.type); return false;
        }
    } catch (error) {
        console.error('[KeyboardInjector] Error:', error);
        return false;
    }
}

module.exports = { initialize, sendKey, sendText, sendSpecialKey, handleKeyEvent, VK_CODES };
