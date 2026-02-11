class RemoteInputApp {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.isAuthenticated = false;
        this.authRequired = false;
        this.isStreaming = false;
        this.reconnectAttempts = 0;
        this.modifiers = { ctrl: false, alt: false, shift: false, win: false };
        this.messageId = 0;
        this.latencies = [];
        this.lastValue = '';

        // Stable Input State
        this.lastSentText = '';
        this.charTimestamps = [];
        this.previousInput = '';
        this.typingDelay = parseInt(localStorage.getItem('typingDelay') || '50', 10);

        this.theme = localStorage.getItem('theme') || 'dark';

        // Background survival state
        this.wakeLock = null;
        this.keepAliveAudio = null;
        this.backgroundTimestamp = null;

        // Load saved auth settings
        this.customServer = localStorage.getItem('customServer') || '';
        this.computerName = localStorage.getItem('computerName') || '';

        // Screen elements
        this.screens = {
            blocked: document.getElementById('browserBlockedScreen'),
            splash: document.getElementById('splashScreen'),
            login: document.getElementById('loginScreen'),
            main: document.getElementById('mainApp'),
            settings: document.getElementById('settingsScreen')
        };

        // Login screen elements
        this.loginEl = {
            serverAddress: document.getElementById('loginServerAddress'),
            computerName: document.getElementById('loginComputerName'),
            pin: document.getElementById('loginPin'),
            connectBtn: document.getElementById('loginConnectBtn'),
            status: document.getElementById('loginStatus'),
            savedConnections: document.getElementById('savedConnections'),
            savedList: document.getElementById('savedDevicesList'),
            loginForm: document.getElementById('loginForm'),
            rememberMe: document.getElementById('rememberMe')
        };

        // Device ID for token auth
        this.deviceId = this.getOrCreateDeviceId();
        this.savedDevices = this.loadSavedDevices();

        this.el = {
            connBtn: document.getElementById('connectionBtn'),
            connText: document.getElementById('connectionText'),
            input: document.getElementById('inputArea'),
            theme: document.getElementById('themeBtn'),
            ctrl: document.getElementById('ctrlKey'),
            alt: document.getElementById('altKey'),
            shift: document.getElementById('shiftKey'),
            win: document.getElementById('winKey'),
            latency: document.getElementById('latencyDisplay'),
            deleteAllBtn: document.getElementById('deleteAllBtn'),
            toggleMouse: document.getElementById('toggleMouse'),
            mouseContainer: document.getElementById('mouseContainer'),
            keyboard: document.querySelector('.keyboard'),
            // Settings screen elements
            settingsBtn: document.getElementById('settingsBtn'),
            settingsBackBtn: document.getElementById('settingsBackBtn'),
            serverAddressInput: document.getElementById('serverAddress'),
            computerNameInput: document.getElementById('computerNameInput'),
            pinInput: document.getElementById('pinInput'),
            saveSettingsBtn: document.getElementById('saveSettingsBtn'),
            authStatus: document.getElementById('authStatus'),
            splashDurationInput: document.getElementById('splashDurationInput'),
            splashDurationValue: document.getElementById('splashDurationValue'),
            typingDelayInput: document.getElementById('typingDelayInput'),
            typingDelayValue: document.getElementById('typingDelayValue'),
            // Floating toolbar elements
            floatingToolbar: document.getElementById('floatingToolbar'),
            toolbarHandle: document.getElementById('toolbarHandle'),
            toolbarContent: document.getElementById('toolbarContent'),
            toolbarToggle: document.getElementById('toolbarToggle'),
            fsScrollUp: document.getElementById('fsScrollUp'),
            fsLeftClick: document.getElementById('fsLeftClick'),
            fsRightClick: document.getElementById('fsRightClick'),
            fsScrollDown: document.getElementById('fsScrollDown'),
            fsVoiceBtn: document.getElementById('fsVoiceBtn'),
            // Screen settings elements
            screenOffsetX: document.getElementById('screenOffsetX'),
            screenOffsetXValue: document.getElementById('screenOffsetXValue'),
            screenOffsetXMinus: document.getElementById('screenOffsetXMinus'),
            screenOffsetXPlus: document.getElementById('screenOffsetXPlus'),
            screenOffsetY: document.getElementById('screenOffsetY'),
            screenOffsetYValue: document.getElementById('screenOffsetYValue'),
            screenOffsetYMinus: document.getElementById('screenOffsetYMinus'),
            screenOffsetYPlus: document.getElementById('screenOffsetYPlus'),
            screenZoom: document.getElementById('screenZoom'),
            screenZoomValue: document.getElementById('screenZoomValue'),
            resetScreenSettings: document.getElementById('resetScreenSettings'),
            screenImage: document.getElementById('screenImage'),
            // QR Scanner button
            scanQrBtn: document.getElementById('scanQrBtn')
        };

        this.init();
    }

    init() {
        this.initStableInput(); // Initialize the stability loop
        this.applyTheme(this.theme);

        // Sync Settings UI with State
        if (this.el.typingDelayInput) {
            this.el.typingDelayInput.value = this.typingDelay;
            if (this.el.typingDelayValue) {
                this.el.typingDelayValue.textContent = this.typingDelay + ' ms';
            }
        }

        this.setupListeners();
        this.setupLoginListeners();
        this.setupBackgroundSurvival();

        // Disconnect Button
        const disconnectBtn = document.getElementById('disconnectBtn');
        if (disconnectBtn) {
            disconnectBtn.addEventListener('click', () => {
                if (confirm('Disconnect from PC?')) {
                    this.handleConnectionLost();
                }
            });
        }

        // Check if running in Capacitor (native app) or browser
        const isCapacitor = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();

        if (!isCapacitor) {
            // Block browser access
            this.showScreen('blocked');
            return;
        }

        // Start with splash screen
        this.showScreen('splash');

        // Check for default device to bypass screens
        const defaultDevice = localStorage.getItem('defaultDevice');

        if (defaultDevice && this.savedDevices[defaultDevice]) {
            console.log('Fast-tracking connection to default device:', defaultDevice);
            // Render list in background just in case
            this.renderSavedDevices();

            // Connect immediately (bypassing splash delay and login screen)
            setTimeout(() => {
                this.connectFromSaved(defaultDevice, true);
            }, 100);
            return;
        }

        // Standard flow: Wait for splash duration then show login
        const splashDuration = parseInt(localStorage.getItem('splashDuration') || '2500', 10);
        setTimeout(() => {
            this.showScreen('login');
            // Pre-populate login fields with saved values
            if (this.loginEl.serverAddress) this.loginEl.serverAddress.value = this.customServer;
            if (this.loginEl.computerName) this.loginEl.computerName.value = this.computerName;
            // Render saved devices list
            this.renderSavedDevices();
        }, splashDuration);
    }


    showScreen(screen) {
        // Hide all screens
        if (this.screens.blocked) this.screens.blocked.style.display = 'none';
        if (this.screens.splash) this.screens.splash.style.display = 'none';
        if (this.screens.login) this.screens.login.style.display = 'none';
        if (this.screens.main) this.screens.main.style.display = 'none';
        if (this.screens.settings) this.screens.settings.style.display = 'none';

        // Explicitly hide overlays
        const manualModal = document.getElementById('manualConnectionModal');
        if (manualModal) manualModal.style.display = 'none';

        // Show requested screen
        if (screen === 'blocked' && this.screens.blocked) {
            this.screens.blocked.style.display = 'flex';
        } else if (screen === 'splash' && this.screens.splash) {
            this.screens.splash.style.display = 'flex';
        } else if (screen === 'login' && this.screens.login) {
            this.screens.login.style.display = 'flex';
        } else if (screen === 'main' && this.screens.main) {
            this.screens.main.style.display = 'flex';
        } else if (screen === 'settings' && this.screens.settings) {
            this.screens.settings.style.display = 'flex';
        }
    }

    setupLoginListeners() {
        // Show saved connections if any exist
        this.renderSavedDevices();

        // QR Scanner button - use native MLKit scanner
        const scanBtn = document.getElementById('scanQrBtn');
        if (scanBtn) {
            scanBtn.addEventListener('click', async () => {
                console.log('Scan QR button clicked - starting native scanner');
                await this.startNativeQrScanner();
            });
        }

        // Gallery QR button
        const galleryBtn = document.getElementById('scanGalleryBtn');
        if (galleryBtn) {
            galleryBtn.addEventListener('click', async () => {
                await this.pickQrFromGallery();
            });
        }

        // Manual Entry button - shows the manual connection modal
        const manualBtn = document.getElementById('manualEntryBtn');
        const closeManualBtn = document.getElementById('closeManualBtn');
        const manualModal = document.getElementById('manualConnectionModal');

        if (manualBtn && manualModal) {
            manualBtn.addEventListener('click', () => {
                manualModal.style.display = 'flex';
                // Focus on input
                const addrInput = document.getElementById('loginServerAddress');
                if (addrInput) addrInput.focus();
            });
        }

        if (closeManualBtn && manualModal) {
            closeManualBtn.addEventListener('click', () => {
                manualModal.style.display = 'none';
            });
        }

        // Toggle for manual connection form
        if (this.loginEl.newConnectionToggle) {
            this.loginEl.newConnectionToggle.onclick = () => {
                if (this.loginEl.loginForm) {
                    const isHidden = this.loginEl.loginForm.style.display === 'none';
                    this.loginEl.loginForm.style.display = isHidden ? 'block' : 'none';
                }
            };
        }

        // Connect button
        if (this.loginEl.connectBtn) {
            this.loginEl.connectBtn.onclick = () => {
                // Get values from login form
                this.customServer = (this.loginEl.serverAddress?.value || '').trim();
                this.computerName = (this.loginEl.computerName?.value || '').trim();
                const pin = (this.loginEl.pin?.value || '').trim();
                const rememberMe = this.loginEl.rememberMe?.checked ?? true;

                // Save server and computer name
                localStorage.setItem('customServer', this.customServer);
                localStorage.setItem('computerName', this.computerName);

                // Store PIN and rememberMe for auth
                this.pendingPin = pin;
                this.pendingRememberMe = rememberMe;

                // Update login status
                this.updateLoginStatus('Connecting...', 'connecting');

                // Connect
                this.connect();
            };
        }
    }

    // Native Google Code Scanner (ML Kit)
    // This provides a full native UI and handles permissions automatically via Google Play Services.
    async startNativeQrScanner() {
        console.log('Starting Google ML Kit Scanner...');

        try {
            // DEBUG: Check what plugins are actually available
            const pluginKeys = Object.keys(window.Capacitor.Plugins || {});
            console.log('Available Plugins:', pluginKeys);

            // Correct name for @capacitor-mlkit/barcode-scanning is 'MlkitBarcodescanner'
            // We'll try that and fallback to others just in case
            const { MlkitBarcodescanner, CapacitorBarcodeScanner, BarcodeScanner } = window.Capacitor.Plugins;

            const scanner = MlkitBarcodescanner || CapacitorBarcodeScanner || BarcodeScanner;

            if (!scanner) {
                const pluginKeys = Object.keys(window.Capacitor.Plugins || {});
                alert('Plugin Error: Scanner plugin missing.\nAvailable: ' + JSON.stringify(pluginKeys));
                this.showManualQrInput();
                return;
            }

            // DEBUG: Check available methods on the scanner object
            // This will help us confirm if 'scan' exists
            if (!scanner.scan) {
                const methods = Object.keys(scanner);
                const protoMethods = Object.keys(Object.getPrototypeOf(scanner));
                alert('Scanner API Error: .scan() missing.\nMethods: ' + JSON.stringify(methods.concat(protoMethods)));
            }

            // The correct method for v6 is .scan()
            const result = await scanner.scan({
                formats: [], // Empty array = all formats
                lensFacing: 1 // Back camera
            });

            if (result && result.barcodes && result.barcodes.length > 0) {
                // v6 returns { barcodes: [{ displayValue: '...' }] }
                this.handleQrData(result.barcodes[0].displayValue);
            } else {
                console.log("Scanner cancelled or no result");
            }
        } catch (error) {
            console.error('ML Kit Scanner failed:', error);
            // If the user cancelled, do nothing. Otherwise show error.
            if (!error.message || !error.message.includes('Canceled')) {
                alert('Scanner Error: ' + (error.message || 'Unknown error'));
                this.showManualQrInput();
            }
        }
    }

    // Gallery QR Scanning using custom native plugin (fully native ML Kit)
    async pickQrFromGallery() {
        console.log('Picking QR from gallery (native plugin)...');
        try {
            // DEBUG: List all available plugins
            const pluginKeys = Object.keys(window.Capacitor.Plugins || {});
            console.log('Available plugins:', pluginKeys);

            // Use our custom native GalleryQrScanner plugin
            const { GalleryQrScanner } = window.Capacitor.Plugins;

            if (!GalleryQrScanner) {
                const debugMsg = 'GalleryQrScanner NOT found!\n\nAvailable plugins:\n' + pluginKeys.join('\n');
                await this.showDebugWithCopy('Plugin Error', debugMsg);
                return;
            }

            // Call native plugin - it handles image picking + ML Kit scanning
            const result = await GalleryQrScanner.scanFromGallery();
            console.log('Native gallery scan result:', result);

            // Show debug with copy option
            // const debugJson = JSON.stringify(result, null, 2);
            // await this.showDebugWithCopy('Gallery Scan Result', debugJson);

            if (result.cancelled) {
                return;
            }

            if (result.found && result.data) {
                console.log('QR found (Native):', result.data);
                this.handleQrData(result.data);
            } else {
                // Native scan reported failure (e.g. "Strategies 1-4 failed")
                // Try fallback JS scanner if native found nothing
                console.log('Native scan empty, trying JS fallback...');
                this.fallbackScanWithJsQR();
            }

        } catch (error) {
            console.error('Gallery native scan error:', error);
            // Native plugin crashed or file load failed -> Fallback to JS
            console.log('Native plugin failed, triggering JS fallback...');
            this.fallbackScanWithJsQR();
        }
    }

    // Fallback: Pure JS scanning using file input and jsQR
    // This works on any device but requires manual file selection again
    fallbackScanWithJsQR() {
        // Create hidden input if not exists
        let input = document.getElementById('hiddenQrInput');
        if (!input) {
            input = document.createElement('input');
            input.id = 'hiddenQrInput';
            input.type = 'file';
            input.accept = 'image/*';
            input.style.display = 'none';
            document.body.appendChild(input);

            input.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                console.log('Scanning file with JS:', file.name);

                try {
                    // Create image URL
                    const imageUrl = URL.createObjectURL(file);
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);

                        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        const code = jsQR(imageData.data, imageData.width, imageData.height);

                        URL.revokeObjectURL(imageUrl); // Cleanup

                        if (code) {
                            console.log('QR found (JS Fallback):', code.data);
                            this.handleQrData(code.data);
                        } else {
                            alert('No QR code found (JS Fallback).\n\nPlease try a clearer image.');
                        }
                    };
                    img.onerror = () => {
                        alert('Failed to load image for JS scanning.');
                    };
                    img.src = imageUrl;
                } catch (err) {
                    console.error('JS scan error:', err);
                    alert('Error scanning image (JS): ' + err.message);
                }

                // Clear value so same file can be selected again
                input.value = '';
            });
        }

        // Trigger click
        input.click();
    }

    // Helper to show debug message with copy-to-clipboard button
    showDebugWithCopy(title, message) {
        return new Promise((resolve) => {
            const modal = document.getElementById('debugModal');
            const titleEl = document.getElementById('debugModalTitle');
            const msgEl = document.getElementById('debugModalMessage');
            const copyBtn = document.getElementById('debugCopyBtn');
            const closeBtn = document.getElementById('debugCloseBtn');

            if (!modal) {
                alert(`DEBUG: ${title}\n\n${message}`);
                resolve();
                return;
            }

            titleEl.textContent = title;
            msgEl.textContent = message;
            modal.style.display = 'flex';

            // Copy button handler
            const handleCopy = async () => {
                try {
                    await navigator.clipboard.writeText(message);
                    copyBtn.textContent = '✓ Copied!';
                    copyBtn.style.background = '#22c55e';
                    setTimeout(() => {
                        copyBtn.textContent = '📋 Copy';
                        copyBtn.style.background = '#6366f1';
                    }, 2000);
                } catch (e) {
                    // Fallback: select text
                    msgEl.focus();
                    const range = document.createRange();
                    range.selectNodeContents(msgEl);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                    copyBtn.textContent = 'Select All (copy manually)';
                }
            };

            // Close button handler
            const handleClose = () => {
                modal.style.display = 'none';
                copyBtn.removeEventListener('click', handleCopy);
                closeBtn.removeEventListener('click', handleClose);
                resolve();
            };

            copyBtn.addEventListener('click', handleCopy);
            closeBtn.addEventListener('click', handleClose);
        });
    }

    showManualQrInput() {
        // If native scanner fails, show a prompt for manual QR data entry
        const qrData = prompt('Camera not available.\n\nPaste QR code data or enter server URL:');
        if (qrData) {
            this.handleQrData(qrData);
        }
    }

    handleQrData(data) {
        // Show processing overlay immediately after scan
        this.showProcessingOverlay('Connecting to Keymote...');

        try {
            const connectionData = JSON.parse(data);
            console.log('QR Connection data:', connectionData);

            // Extract connection info
            this.computerName = connectionData.name || '';
            const pin = connectionData.pin || '';
            const hostId = connectionData.hostId || ''; // New field

            // P2P mode - connect
            if (pin) {
                console.log('QR has PIN, connecting via P2P...');
                // If we also have hostId, we could check if we already have a token, but for now just pair again
                // to refresh the token.
                this.connectP2P(pin, false); // False = Discovery/Pairing Mode
                return;
            } else {
                this.hideProcessingOverlay(); // Error case
                alert('Invalid QR code. PIN missing.');
            }
        } catch (error) {
            this.hideProcessingOverlay(); // Error case
            console.error('Invalid QR data:', error);
            alert('Invalid QR code. Please scan the QR from your Keymote PC app.');
        }
    }

    // Device ID management
    getOrCreateDeviceId() {
        let deviceId = localStorage.getItem('deviceId');
        if (!deviceId) {
            deviceId = 'device_' + Date.now().toString(36) + Math.random().toString(36).substr(2);
            localStorage.setItem('deviceId', deviceId);
        }
        return deviceId;
    }

    // Saved devices management
    loadSavedDevices() {
        try {
            return JSON.parse(localStorage.getItem('savedDevices') || '{}');
        } catch {
            return {};
        }
    }

    saveSavedDevices() {
        localStorage.setItem('savedDevices', JSON.stringify(this.savedDevices));
    }

    // Render saved devices to the login screen list
    renderSavedDevices() {
        console.log('[DEBUG] renderSavedDevices called');
        const list = this.loginEl.savedList;
        const container = this.loginEl.savedConnections;
        console.log('[DEBUG] list:', list, 'container:', container);
        if (!list) return;

        const devices = Object.entries(this.savedDevices);

        if (devices.length === 0) {
            if (container) container.style.display = 'none';
            return;
        }

        if (container) container.style.display = 'block';

        list.innerHTML = devices.map(([key, device]) => `
            <div class="saved-device-item" data-key="${key}">
                <div class="saved-device-info">
                    <span class="saved-device-name">${device.computerName || 'Unknown Device'}</span>
                    <span class="saved-device-address">${device.serverAddress || 'Local'}</span>
                </div>
                <button class="saved-device-connect" data-key="${key}">Connect</button>
                <button class="saved-device-delete" data-key="${key}">✕</button>
            </div>
        `).join('');

        // Add click handlers
        list.querySelectorAll('.saved-device-connect').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const key = e.target.dataset.key;
                const device = this.savedDevices[key];
                if (device) {
                    this.customServer = device.serverAddress;
                    this.computerName = device.computerName;
                    this.authToken = device.token;
                    console.log('[SavedDevice] Showing overlay for:', device.computerName);
                    this.showProcessingOverlay('Connecting to ' + (device.computerName || 'Device') + '...');

                    // Small delay to ensure overlay renders
                    setTimeout(() => {
                        this.connectP2P(key); // Saved devices key IS the PIN
                    }, 100);
                }
            });
        });

        // Add click handlers to entire card
        list.querySelectorAll('.saved-device-item').forEach(card => {
            card.addEventListener('click', (e) => {
                // Don't connect if clicking delete button
                if (e.target.closest('.saved-device-delete')) {
                    return;
                }

                const key = card.dataset.key;
                const device = this.savedDevices[key];
                console.log('[SavedDevice-Card] Clicked! Key:', key);

                if (device) {
                    this.computerName = device.computerName;
                    console.log('[SavedDevice-Card] Showing overlay');
                    this.showProcessingOverlay('Connecting to ' + (device.computerName || 'Device') + '...');

                    setTimeout(() => {
                        console.log('[SavedDevice-Card] Connecting P2P');
                        this.connectP2P(key);
                    }, 100);
                }
            });
        });
        console.log('[DEBUG] Attached click handlers to', list.querySelectorAll('.saved-device-item').length, 'cards');

        list.querySelectorAll('.saved-device-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const key = e.target.dataset.key;
                this.removeDevice(key);
                this.renderSavedDevices();
            });
        });
    }

    // Processing Overlay helpers (New Reliable Implementation)
    showProcessingOverlay(text = 'Processing...') {
        const overlay = document.getElementById('processingOverlay');
        const textEl = document.getElementById('processingText');

        if (overlay) {
            // Force high z-index and display
            overlay.style.zIndex = '99999';
            overlay.style.display = 'flex';
        }
        if (textEl) textEl.textContent = text;

        // Safety timeout - auto hide after 15 seconds if stuck
        if (this.processingTimeout) clearTimeout(this.processingTimeout);
        this.processingTimeout = setTimeout(() => {
            console.warn('Processing overlay timed out - hiding automatically');
            this.hideProcessingOverlay();
        }, 15000);
    }

    // ... (keep hideProcessingOverlay, showSuccessOverlay, showErrorOverlay)

    // ============================================
    // STABLE INPUT LOGIC (Aging Algorithm)
    // ============================================

    // Initialize Stable Input State (calledin Constructor)
    initStableInput() {
        this.lastSentText = ""; // Confirmed text on PC
        this.charTimestamps = []; // Timestamps of current input chars
        this.typingDelay = parseInt(localStorage.getItem('typingDelay') || '50', 10);

        // Start the stability loop
        if (this.stabilityInterval) clearInterval(this.stabilityInterval);
        this.stabilityInterval = setInterval(() => this.checkStability(), 20); // Check every 20ms
    }

    // Called whenever the user types/speaks (Input Event)
    handleStableInput(newValue) {
        const now = Date.now();
        const oldText = this.el.input.value; // Actually, newValue IS the current input value

        // 1. Calculate Common Prefix with PREVIOUS Input state (implicitly tracked by charTimestamps length?)
        // Wait, we need to track what 'charTimestamps' corresponds to.
        // Let's assume charTimestamps corresponds to the *previous* input value.
        // Actually simplest way: Compare newValue vs charTimestamps.

        const newTimestamps = [];
        const commonLen = this.getCommonPrefixLength(newValue, this.previousInput || "");

        // Preserve old timestamps for matching prefix
        for (let i = 0; i < commonLen && i < this.charTimestamps.length; i++) {
            newTimestamps[i] = this.charTimestamps[i];
        }

        // Assign NEW timestamp for anything new/changed
        for (let i = commonLen; i < newValue.length; i++) {
            newTimestamps[i] = now;
        }

        this.charTimestamps = newTimestamps;
        this.previousInput = newValue;
    }

    getCommonPrefixLength(s1, s2) {
        let i = 0;
        while (i < s1.length && i < s2.length && s1[i] === s2[i]) i++;
        return i;
    }

    // The Loop: Checks what is "Old Enough" to send
    checkStability() {
        if (!this.isConnected || !this.isAuthenticated) return;

        const now = Date.now();
        const currentText = this.el.input ? this.el.input.value : "";

        // If empty, reset everything immediately (Manual Clear)
        if (currentText === "") {
            this.lastSentText = "";
            this.charTimestamps = [];
            this.previousInput = "";
            return;
        }

        // 1. Find Stable Length (How many chars from start are > delay old)
        let stableLength = 0;

        // Optimization: If we have already sent X chars, we assume those X chars are stable 
        // UNLESS the user deleted them.
        // So we only really need to check aging for chars *after* the ones we already sent?
        // No, because STT might replace the end of the sent text.
        // The timestamps tell the truth.

        for (let i = 0; i < currentText.length; i++) {
            if (i >= this.charTimestamps.length) break; // Should not happen if sync is good

            const age = now - this.charTimestamps[i];

            // Special Rule: If this char matches what we ALREADY sent at this position, 
            // treat it as stable immediately (infinite age).
            // This prevents re-sending or waiting for text we already confirmed.
            const isAlreadySent = (i < this.lastSentText.length && currentText[i] === this.lastSentText[i]);

            if (isAlreadySent || age >= this.typingDelay) {
                stableLength++;
            } else {
                // As soon as we hit an unstable char, stop. 
                // We only sync the continuous stable prefix.
                break;
            }
        }

        const stableText = currentText.substring(0, stableLength);

        // 2. Sync if Stable Text is different from Last Sent Text
        if (stableText !== this.lastSentText) {
            this.syncText(stableText);
        }
    }

    syncText(stableText) {
        const commonLen = this.getCommonPrefixLength(stableText, this.lastSentText);

        const backspacesNeeded = this.lastSentText.length - commonLen;
        const textToType = stableText.substring(commonLen);

        if (backspacesNeeded > 0) {
            console.log(`[StableInput] Backspace x ${backspacesNeeded}`);
            // Send backspaces
            for (let i = 0; i < backspacesNeeded; i++) {
                this.sendKey('Backspace');
            }
        }

        if (textToType.length > 0) {
            console.log(`[StableInput] Typing: "${textToType}"`);
            this.sendText(textToType, this.typingDelay); // Pass delay param
        }

        this.lastSentText = stableText;
    }

    // ... (rest of methods)

    hideProcessingOverlay() {
        const overlay = document.getElementById('processingOverlay');
        const textEl = document.getElementById('processingText');
        const spinner = overlay?.querySelector('.processing-spinner');

        if (overlay) overlay.style.display = 'none';

        // Reset spinner and text to defaults
        if (spinner) {
            spinner.style.display = '';
            spinner.style.borderTopColor = '';
        }
        if (textEl) {
            textEl.style.color = '';
        }

        // Clear safety timeout
        if (this.processingTimeout) {
            clearTimeout(this.processingTimeout);
            this.processingTimeout = null;
        }
    }

    // Show success overlay (green)
    showSuccessOverlay(text = 'Connected!') {
        const overlay = document.getElementById('processingOverlay');
        const textEl = document.getElementById('processingText');
        const spinner = overlay?.querySelector('.processing-spinner');

        if (overlay) {
            overlay.style.zIndex = '99999';
            overlay.style.display = 'flex';
        }
        if (textEl) {
            textEl.textContent = '✓ ' + text;
            textEl.style.color = '#4ADE80'; // Green
        }
        if (spinner) {
            spinner.style.display = 'none'; // Hide spinner
        }

        // Auto hide after 1 second
        setTimeout(() => this.hideProcessingOverlay(), 1000);
    }

    // Show error overlay (red)
    showErrorOverlay(text = 'Connection Failed') {
        const overlay = document.getElementById('processingOverlay');
        const textEl = document.getElementById('processingText');
        const spinner = overlay?.querySelector('.processing-spinner');

        if (overlay) {
            overlay.style.zIndex = '99999';
            overlay.style.display = 'flex';
        }
        if (textEl) {
            textEl.textContent = '✕ ' + text;
            textEl.style.color = '#F87171'; // Red
        }
        if (spinner) {
            spinner.style.display = 'none'; // Hide spinner
        }

        // Auto hide after 2 seconds
        setTimeout(() => this.hideProcessingOverlay(), 2000);
    }

    saveDevice(serverAddress, computerName, token) {
        const key = serverAddress || 'local';
        this.savedDevices[key] = {
            serverAddress: serverAddress,
            computerName: computerName,
            token: token,
            savedAt: Date.now()
        };
        this.saveSavedDevices();
    }

    removeDevice(key) {
        delete this.savedDevices[key];
        this.saveSavedDevices();
        this.renderSavedDevices();
    }

    renderSavedDevices() {
        const savedKeys = Object.keys(this.savedDevices);
        if (savedKeys.length === 0) {
            // No saved devices - show form, hide saved section
            if (this.loginEl.savedConnections) this.loginEl.savedConnections.style.display = 'none';
            if (this.loginEl.newConnectionToggle) this.loginEl.newConnectionToggle.classList.add('hidden');
            if (this.loginEl.loginForm) this.loginEl.loginForm.classList.remove('collapsed');
            return;
        }

        // Show saved connections
        if (this.loginEl.savedConnections) this.loginEl.savedConnections.style.display = 'block';
        if (this.loginEl.newConnectionToggle) this.loginEl.newConnectionToggle.classList.remove('hidden');
        if (this.loginEl.loginForm) this.loginEl.loginForm.classList.add('collapsed');

        // Render devices
        if (this.loginEl.savedList) {
            this.loginEl.savedList.innerHTML = savedKeys.map(key => {
                const device = this.savedDevices[key];
                return `
                    <div class="saved-device" data-key="${key}">
                        <span class="saved-device-icon">🖥️</span>
                        <div class="saved-device-info">
                            <div class="saved-device-name">${device.computerName || 'Unknown PC'}</div>
                            <div class="saved-device-address">${device.serverAddress || 'Local Network'}</div>
                        </div>
                        <button class="saved-device-delete" data-key="${key}">×</button>
                    </div>
                `;
            }).join('');

            // Add click handlers
            this.loginEl.savedList.querySelectorAll('.saved-device').forEach(el => {
                el.onclick = (e) => {
                    if (!e.target.classList.contains('saved-device-delete')) {
                        this.connectFromSaved(el.dataset.key);
                    }
                };
            });

            // Delete handlers
            this.loginEl.savedList.querySelectorAll('.saved-device-delete').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    this.removeDevice(btn.dataset.key);
                };
            });
        }
    }

    connectFromSaved(key) {
        const device = this.savedDevices[key];
        if (!device) return;

        this.customServer = device.serverAddress || '';
        this.computerName = device.computerName || '';
        this.pendingToken = device.token;
        this.pendingPin = null;
        this.pendingRememberMe = false;

        this.updateLoginStatus('Connecting...', 'connecting');
        this.connect();
    }

    updateLoginStatus(message, type = '') {
        if (this.loginEl.status) {
            this.loginEl.status.textContent = message;
            this.loginEl.status.className = 'login-status' + (type ? ' ' + type : '');
            this.loginEl.status.style.display = message ? 'block' : 'none';
        }
    }

    applyTheme(t) {
        this.theme = t;
        document.documentElement.setAttribute('data-theme', t);
        localStorage.setItem('theme', t);
        this.el.theme.textContent = t === 'dark' ? '🌙' : '☀️';
    }

    setupListeners() {
        this.el.theme.onclick = () => this.applyTheme(this.theme === 'dark' ? 'light' : 'dark');

        // Settings screen handlers
        if (this.el.settingsBtn) {
            this.el.settingsBtn.onclick = () => {
                // Pre-populate fields with saved values
                if (this.el.serverAddressInput) this.el.serverAddressInput.value = this.customServer;
                if (this.el.computerNameInput) this.el.computerNameInput.value = this.computerName;
                if (this.el.pinInput) this.el.pinInput.value = '';
                if (this.el.authStatus) {
                    this.el.authStatus.textContent = '';
                    this.el.authStatus.className = 'settings-status';
                }
                // Set splash duration slider
                const savedSplashDuration = parseInt(localStorage.getItem('splashDuration') || '2500', 10);
                if (this.el.splashDurationInput) this.el.splashDurationInput.value = savedSplashDuration;
                if (this.el.splashDurationValue) this.el.splashDurationValue.textContent = (savedSplashDuration / 1000).toFixed(1) + 's';
                this.showScreen('settings');
            };
        }

        // Splash duration slider handler
        if (this.el.splashDurationInput) {
            this.el.splashDurationInput.oninput = () => {
                const val = parseInt(this.el.splashDurationInput.value, 10);
                if (this.el.splashDurationValue) this.el.splashDurationValue.textContent = (val / 1000).toFixed(1) + 's';
                localStorage.setItem('splashDuration', val.toString());
            };
        }

        // Stability Delay Listener
        if (this.el.typingDelayInput) {
            this.el.typingDelayInput.oninput = (e) => {
                this.typingDelay = parseInt(e.target.value, 10);
                if (this.el.typingDelayValue) {
                    this.el.typingDelayValue.textContent = this.typingDelay + ' ms';
                }
                localStorage.setItem('typingDelay', this.typingDelay);
            };
        }

        // Screen settings handlers
        this.loadScreenSettings();
        this.setupScreenSettingsListeners();

        // Settings back button handler
        if (this.el.settingsBackBtn) {
            this.el.settingsBackBtn.onclick = () => {
                this.showScreen('main');
            };
        }

        if (this.el.saveSettingsBtn) {
            this.el.saveSettingsBtn.onclick = () => {
                // Save settings and reconnect
                this.customServer = this.el.serverAddressInput.value.trim();
                this.computerName = this.el.computerNameInput.value.trim();
                const pin = this.el.pinInput.value.trim();

                localStorage.setItem('customServer', this.customServer);
                localStorage.setItem('computerName', this.computerName);

                // Store PIN temporarily for auth (not in localStorage for security)
                this.pendingPin = pin;

                // Go back to main and reconnect
                this.showScreen('main');
                this.disconnect();
                this.connect();
            };
        }

        // Delete all button
        if (this.el.deleteAllBtn) {
            this.el.deleteAllBtn.onclick = () => {
                this.el.input.value = '';
                this.lastValue = '';
                // Reset Stable State
                this.lastSentText = "";
                this.charTimestamps = [];
                this.previousInput = "";
                this.el.input.focus();
            };
        }

        // Screen Share section toggle - auto-starts streaming when shown
        if (this.el.toggleMouse && this.el.mouseContainer) {
            this.el.toggleMouse.onclick = () => {
                const hidden = this.el.mouseContainer.style.display === 'none';
                this.el.mouseContainer.style.display = hidden ? 'block' : 'none';
                this.el.toggleMouse.textContent = hidden ? 'Hide' : 'Show';

                // Auto-start/stop streaming when section is shown/hidden
                this.isStreaming = hidden; // true when showing, false when hiding

                // Mutual exclusion: stop audio share when starting screen share
                if (this.isStreaming && this.isAudioSharing) {
                    this.stopAudioShareUI();
                }

                this.send({ type: 'screen', action: hidden ? 'start' : 'stop' });

                const hint = document.getElementById('trackpadHint');
                if (hint) hint.style.display = this.isStreaming ? 'none' : 'flex';
                if (!this.isStreaming) {
                    const screenImage = document.getElementById('screenImage');
                    const cursorIndicator = document.getElementById('cursorIndicator');
                    if (screenImage) screenImage.style.display = 'none';
                    if (cursorIndicator) cursorIndicator.style.display = 'none';
                }
            };
        }

        // Audio Share section toggle
        const toggleAudio = document.getElementById('toggleAudio');
        const audioContainer = document.getElementById('audioContainer');
        if (toggleAudio && audioContainer) {
            this.isAudioSharing = false;
            toggleAudio.onclick = () => {
                this.isAudioSharing = !this.isAudioSharing;
                audioContainer.style.display = this.isAudioSharing ? 'block' : 'none';
                toggleAudio.textContent = this.isAudioSharing ? 'Stop' : 'Start';

                // Mutual exclusion: stop screen share when starting audio share
                if (this.isAudioSharing && this.isStreaming) {
                    this.stopScreenShareUI();
                }

                this.send({ type: 'audio', action: this.isAudioSharing ? 'start' : 'stop' });
                const status = document.getElementById('audioStatus');
                if (status) status.textContent = this.isAudioSharing ? 'Streaming system audio...' : '';
            };
        }

        // Keyboard section toggle
        const toggleKeyboard = document.getElementById('toggleKeyboard');
        const keyboardContainer = document.getElementById('keyboardContainer');
        if (toggleKeyboard && keyboardContainer) {
            toggleKeyboard.onclick = () => {
                const hidden = keyboardContainer.style.display === 'none';
                keyboardContainer.style.display = hidden ? '' : 'none';
                toggleKeyboard.textContent = hidden ? 'Hide' : 'Show';
            };
        }

        this.el.input.addEventListener('input', e => this.handleStableInput(e.target.value));
        this.el.input.addEventListener('keydown', e => this.handleKeyDown(e));

        // Modifiers - Ctrl, Alt, Shift toggle
        ['ctrl', 'alt'].forEach(m => {
            if (this.el[m]) this.el[m].onclick = () => this.toggleMod(m);
        });

        // Shift key with keyboard class toggle for dual-key visual
        if (this.el.shift) {
            this.el.shift.onclick = () => {
                this.toggleMod('shift');
                // Toggle keyboard class for dual-key highlighting
                if (this.el.keyboard) {
                    this.el.keyboard.classList.toggle('shift-active', this.modifiers.shift);
                }
            };
        }

        // Win key - single tap toggles, double tap opens Start menu
        if (this.el.win) {
            let lastWinTap = 0;
            this.el.win.onclick = () => {
                const now = Date.now();
                if (now - lastWinTap < 300) {
                    this.modifiers.win = false;
                    this.el.win.classList.remove('active');
                    this.send({ type: 'key', key: 'Win', modifiers: { ctrl: false, alt: false, shift: false, win: false } });
                    lastWinTap = 0;
                } else {
                    lastWinTap = now;
                    this.toggleMod('win');
                }
            };
        }

        // All key buttons (including dual-key with data-shift)
        document.querySelectorAll('[data-key]').forEach(btn => {
            btn.onclick = () => {
                const key = btn.dataset.key;
                const shiftChar = btn.dataset.shift;

                // If shift is held and button has shift character (e.g. numbers to symbols)
                if (this.modifiers.shift && shiftChar) {
                    this.el.input.value += shiftChar;
                    this.handleStableInput(this.el.input.value);
                    this.el.input.focus();
                    return;
                }

                if (this.hasModifiers()) {
                    this.sendKey(key);
                } else if (key.length === 1 && /[a-zA-Z0-9]/.test(key)) {
                    // Alphanumeric keys -> Stable Input
                    const char = this.modifiers.shift ? key.toUpperCase() : key.toLowerCase();
                    this.el.input.value += char;
                    this.handleStableInput(this.el.input.value);
                    this.el.input.focus();
                } else if (key.length === 1) {
                    // Other symbols -> Stable Input
                    this.el.input.value += key;
                    this.handleStableInput(this.el.input.value);
                    this.el.input.focus();
                } else if (key === 'Backspace') {
                    // Backspace -> Remove from local buffer
                    this.el.input.value = this.el.input.value.slice(0, -1);
                    this.handleStableInput(this.el.input.value);
                    this.el.input.focus();
                } else {
                    // Other special keys (Enter, Esc, etc) -> Send Key directly
                    this.sendKey(key);
                }
            };
        });

        // Symbol buttons (data-text)
        document.querySelectorAll('[data-text]').forEach(btn => {
            btn.onclick = () => {
                this.el.input.value += btn.dataset.text;
                this.handleStableInput(this.el.input.value);
                this.el.input.focus();
            };
        });

        // Shortcuts
        document.querySelectorAll('[data-shortcut]').forEach(btn => {
            btn.onclick = () => this.sendShortcut(btn.dataset.shortcut);
        });

        // Screen streaming is now auto-started by toggleMouse handler above

        // Screen viewer controls
        const fullscreenBtn = document.getElementById('fullscreenBtn');
        const rotateBtn = document.getElementById('rotateBtn');
        const screenViewer = document.getElementById('screenViewer');
        const exitFullscreenBtn = document.getElementById('exitFullscreenBtn');
        const resetScreenViewBtn = document.getElementById('resetScreenViewBtn');

        // Reset zoom/pan button
        if (resetScreenViewBtn) {
            resetScreenViewBtn.onclick = () => {
                this.screenOffsetX = 0;
                this.screenOffsetY = 0;
                this.screenZoom = 100;
                if (this.el.screenOffsetX) this.el.screenOffsetX.value = 0;
                if (this.el.screenOffsetXValue) this.el.screenOffsetXValue.value = 0;
                if (this.el.screenOffsetY) this.el.screenOffsetY.value = 0;
                if (this.el.screenOffsetYValue) this.el.screenOffsetYValue.value = 0;
                if (this.el.screenZoom) this.el.screenZoom.value = 100;
                if (this.el.screenZoomValue) this.el.screenZoomValue.value = 100;
                localStorage.setItem('screenOffsetX', '0');
                localStorage.setItem('screenOffsetY', '0');
                localStorage.setItem('screenZoom', '100');
                this.applyScreenTransform();
            };
        }

        // Helper to update back button visibility
        const updateBackBtn = () => {
            const isExpanded = screenViewer.classList.contains('fullscreen') || screenViewer.classList.contains('rotated');
            if (exitFullscreenBtn) exitFullscreenBtn.style.display = isExpanded ? 'block' : 'none';
        };

        // Fullscreen toggle - enables horizontal (rotated) mode automatically
        if (fullscreenBtn && screenViewer) {
            fullscreenBtn.onclick = () => {
                const isFullscreen = screenViewer.classList.contains('fullscreen');
                if (isFullscreen) {
                    // Exit fullscreen - remove both
                    screenViewer.classList.remove('fullscreen', 'rotated');
                    fullscreenBtn.style.display = 'block'; // Show Max button
                    fullscreenBtn.textContent = '⛶ Max';
                    if (rotateBtn) rotateBtn.textContent = '🔄 Rotate';
                } else {
                    // Enter fullscreen - add both for horizontal mode
                    screenViewer.classList.add('fullscreen', 'rotated');
                    fullscreenBtn.style.display = 'none'; // Hide Max button in fullscreen
                    if (rotateBtn) rotateBtn.textContent = '↺ Normal';
                    // Show floating toolbar
                    if (this.el.floatingToolbar) this.el.floatingToolbar.style.display = 'flex';
                }
                updateBackBtn();
            };
        }

        // Rotate toggle for landscape viewing
        if (rotateBtn && screenViewer) {
            rotateBtn.onclick = () => {
                screenViewer.classList.toggle('rotated');
                rotateBtn.textContent = screenViewer.classList.contains('rotated') ? '↺ Normal' : '🔄 Rotate';
                updateBackBtn();
            };
        }

        // Floating back button to exit both modes
        if (exitFullscreenBtn && screenViewer) {
            exitFullscreenBtn.onclick = () => {
                screenViewer.classList.remove('fullscreen', 'rotated');
                if (fullscreenBtn) {
                    fullscreenBtn.style.display = 'block'; // Show Max button again
                    fullscreenBtn.textContent = '⛶ Max';
                }
                if (rotateBtn) rotateBtn.textContent = '🔄 Rotate';
                exitFullscreenBtn.style.display = 'none';
                // Hide floating toolbar
                if (this.el.floatingToolbar) this.el.floatingToolbar.style.display = 'none';
            };
        }

        // Trackpad touch events on the overlay
        const trackpadOverlay = document.getElementById('trackpadOverlay');
        if (trackpadOverlay) {
            let lastTouch = null;
            let touchStartTime = 0;
            let touchMoved = false;
            const sensitivity = 2.5;

            // Two-finger gesture state
            let lastPinchDist = null;
            let lastPinchMid = null;

            trackpadOverlay.addEventListener('touchstart', (e) => {
                e.preventDefault();
                if (e.touches.length === 1) {
                    lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                    touchStartTime = Date.now();
                    touchMoved = false;
                } else if (e.touches.length === 2) {
                    // Initialize pinch/pan state
                    lastTouch = null;
                    const dx = e.touches[1].clientX - e.touches[0].clientX;
                    const dy = e.touches[1].clientY - e.touches[0].clientY;
                    lastPinchDist = Math.hypot(dx, dy);
                    lastPinchMid = {
                        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                        y: (e.touches[0].clientY + e.touches[1].clientY) / 2
                    };
                }
            }, { passive: false });

            trackpadOverlay.addEventListener('touchmove', (e) => {
                e.preventDefault();
                if (e.touches.length === 1 && lastTouch) {
                    let dx = (e.touches[0].clientX - lastTouch.x) * sensitivity;
                    let dy = (e.touches[0].clientY - lastTouch.y) * sensitivity;

                    // Rotate touch coordinates when screen is rotated 90° clockwise
                    if (screenViewer && screenViewer.classList.contains('rotated')) {
                        const temp = dx;
                        dx = dy;    // Flipped: Visual right = original down (+dy)
                        dy = -temp; // Flipped: Visual down = original left (-dx)
                    }

                    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
                        touchMoved = true;
                        this.sendMouse('move', { dx: Math.round(dx), dy: Math.round(dy) });
                        lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                    }
                } else if (e.touches.length === 2 && lastPinchDist !== null) {
                    // Pinch-to-zoom
                    const dx = e.touches[1].clientX - e.touches[0].clientX;
                    const dy = e.touches[1].clientY - e.touches[0].clientY;
                    const dist = Math.hypot(dx, dy);
                    const zoomDelta = (dist - lastPinchDist) * 0.5;
                    lastPinchDist = dist;

                    // Two-finger pan
                    const mid = {
                        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                        y: (e.touches[0].clientY + e.touches[1].clientY) / 2
                    };
                    let panDx = mid.x - lastPinchMid.x;
                    let panDy = mid.y - lastPinchMid.y;
                    lastPinchMid = mid;

                    // Rotate pan coordinates when screen is rotated 90° clockwise
                    if (screenViewer && screenViewer.classList.contains('rotated')) {
                        const temp = panDx;
                        panDx = panDy;
                        panDy = -temp;
                    }

                    // Apply zoom
                    if (Math.abs(zoomDelta) > 0.5) {
                        this.screenZoom = Math.max(50, Math.min(400, this.screenZoom + zoomDelta));
                        if (this.el.screenZoom) this.el.screenZoom.value = Math.min(this.screenZoom, 400);
                        if (this.el.screenZoomValue) this.el.screenZoomValue.value = Math.round(this.screenZoom);
                        localStorage.setItem('screenZoom', Math.round(this.screenZoom).toString());
                    }

                    // Apply pan
                    if (Math.abs(panDx) > 0.5 || Math.abs(panDy) > 0.5) {
                        this.screenOffsetX = Math.max(-200, Math.min(200, this.screenOffsetX + panDx));
                        this.screenOffsetY = Math.max(-200, Math.min(200, this.screenOffsetY + panDy));
                        if (this.el.screenOffsetX) this.el.screenOffsetX.value = this.screenOffsetX;
                        if (this.el.screenOffsetXValue) this.el.screenOffsetXValue.value = Math.round(this.screenOffsetX);
                        if (this.el.screenOffsetY) this.el.screenOffsetY.value = this.screenOffsetY;
                        if (this.el.screenOffsetYValue) this.el.screenOffsetYValue.value = Math.round(this.screenOffsetY);
                        localStorage.setItem('screenOffsetX', Math.round(this.screenOffsetX).toString());
                        localStorage.setItem('screenOffsetY', Math.round(this.screenOffsetY).toString());
                    }

                    this.applyScreenTransform();
                }
            }, { passive: false });

            trackpadOverlay.addEventListener('touchend', (e) => {
                if (e.touches.length < 2) {
                    // Reset pinch/pan state when fingers lift
                    lastPinchDist = null;
                    lastPinchMid = null;
                }
                // Tap to click (if touch was short and didn't move)
                if (e.touches.length === 0 && !touchMoved && Date.now() - touchStartTime < 200) {
                    this.sendMouse('left');
                }
                if (e.touches.length === 0) {
                    lastTouch = null;
                }
            });
        }

        // Mouse buttons
        document.getElementById('leftClick')?.addEventListener('click', () => this.sendMouse('left'));
        document.getElementById('rightClick')?.addEventListener('click', () => this.sendMouse('right'));
        document.getElementById('middleClick')?.addEventListener('click', () => this.sendMouse('middle'));
        document.getElementById('scrollUp')?.addEventListener('click', () => this.sendMouse('scroll', { delta: 120 }));
        document.getElementById('scrollDown')?.addEventListener('click', () => this.sendMouse('scroll', { delta: -120 }));

        // Toolbar button handlers (fullscreen mode controls)
        if (this.el.fsLeftClick) this.el.fsLeftClick.onclick = () => this.sendMouse('left');
        if (this.el.fsRightClick) this.el.fsRightClick.onclick = () => this.sendMouse('right');
        if (this.el.fsScrollUp) this.el.fsScrollUp.onclick = () => this.sendMouse('scroll', { delta: 120 });
        if (this.el.fsScrollDown) this.el.fsScrollDown.onclick = () => this.sendMouse('scroll', { delta: -120 });

        // Voice input button
        if (this.el.fsVoiceBtn) {
            this.el.fsVoiceBtn.onclick = async () => {
                try {
                    // Use Capacitor speech recognition if available
                    if (window.Capacitor?.Plugins?.SpeechRecognition) {
                        const { SpeechRecognition } = window.Capacitor.Plugins;
                        const permission = await SpeechRecognition.requestPermission();
                        if (permission.speechRecognition === 'granted') {
                            this.el.fsVoiceBtn.classList.add('listening');
                            await SpeechRecognition.start({
                                language: 'en-US',
                                partialResults: false,
                                popup: true
                            });
                            SpeechRecognition.addListener('partialResults', (data) => {
                                if (data.matches && data.matches.length > 0) {
                                    const text = data.matches[0];
                                    this.el.input.value += text + ' ';
                                    this.sendText(text + ' ');
                                }
                            });
                        }
                    } else {
                        // Fallback: focus input to trigger Android keyboard with voice
                        this.el.input?.focus();
                    }
                } catch (err) {
                    console.error('Voice input error:', err);
                    this.el.input?.focus();
                }
            };
        }

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                // Delegate to unified resume handler
                this.handleResume();
            } else {
                // Going to background
                this.handleBackground();
            }
        });
    }

    connect() {
        // Disconnect if already connected
        this.disconnect();

        // Always use P2P mode
        console.log('Connecting via P2P...');
        this.pendingPin = this.loginEl.pin ? this.loginEl.pin.value : '';
        this.connectP2P(this.pendingPin);
    }

    // P2P Connection Logic - DUAL CHANNEL (Pairing + Secure)
    connectP2P(pinOrHostId, isSecure = false, token = null, silent = false) {
        if (!pinOrHostId) {
            this.updateLoginStatus('Connection ID required', 'error');
            return;
        }

        const targetId = `keymote-${pinOrHostId}`;
        console.log(`[P2P] Connecting to: ${targetId} (${isSecure ? 'Secure' : 'Discovery'})`);

        if (!silent) {
            this.updateLoginStatus(isSecure ? 'Authenticating...' : 'Pairing...', 'connecting');
            this.showProcessingOverlay(isSecure ? 'Verifying Security Token...' : 'Pairing with Device...');
        }

        // Initialize Peer
        if (this.peer) this.peer.destroy();
        this.peer = new Peer({
            debug: 1,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            }
        });

        this.peer.on('call', (call) => {
            const isAudioOnly = call.metadata && call.metadata.type === 'audio-only';
            console.log(`[P2P] Incoming ${isAudioOnly ? 'Audio' : 'Video'} Call`);
            call.answer();

            call.on('stream', (stream) => {
                if (isAudioOnly) {
                    // Audio-only stream — route to audio element
                    console.log('[P2P] Audio Stream Received');
                    const audio = document.getElementById('remoteAudio');
                    if (audio) {
                        audio.srcObject = stream;
                        audio.play().catch(e => console.error('Audio play error:', e));
                    }
                } else {
                    // Screen share stream (may include audio)
                    console.log('[P2P] Video Stream Received');
                    const video = document.getElementById('remoteVideo');
                    const img = document.getElementById('screenImage');
                    if (video) {
                        video.srcObject = stream;
                        video.style.display = 'block';
                        if (img) img.style.display = 'none';
                        video.onloadedmetadata = () => {
                            video.play().catch(e => console.error('Play error:', e));
                            this.screenWidth = video.videoWidth;
                            this.screenHeight = video.videoHeight;
                        };
                    }
                }
            });
        });

        this.peer.on('open', (id) => {
            console.log('[P2P] My Peer ID:', id);
            const conn = this.peer.connect(targetId);

            conn.on('open', () => {
                console.log('[P2P] Data Channel Open');
                this.p2pConn = conn;

                if (isSecure) {
                    // --- SECURE AUTH FLOW ---
                    console.log('[P2P] Sending Auth Token...');
                    conn.send({
                        type: 'auth',
                        deviceId: this.deviceId,
                        token: token,
                        deviceName: 'Mobile Client' // TODO: Get real name if possible
                    });
                } else {
                    // --- PAIRING FLOW ---
                    console.log('[P2P] Sending Pairing Request...');
                    conn.send({
                        type: 'pair-request',
                        deviceId: this.deviceId,
                        deviceName: 'Mobile Client'
                    });
                }
            });

            conn.on('data', (data) => {
                // Handle Handshake Responses
                if (data.type === 'pair-success') {
                    console.log('[P2P] Pairing Successful! Token received.');
                    // Save credentials
                    this.saveDevice(data.hostId, this.computerName, data.token);

                    // Disconnect Discovery Peer
                    conn.close();

                    // Reconnect using Secure Channel
                    setTimeout(() => {
                        this.connectP2P(data.hostId, true, data.token, silent);
                    }, 500);
                    return;
                }

                if (data.type === 'auth-result') {
                    if (data.success) {
                        console.log('[P2P] Auth Successful!');
                        this.isConnected = true;
                        this.isAuthenticated = true;
                        this.autoReconnectAttempts = 0; // Reset reconnect counter on success

                        this.updateStatus('connected', 'Connected (Secure)');
                        if (!silent) {
                            this.updateLoginStatus('Connected securely!', 'success');
                            this.showSuccessOverlay('Connected!');
                        }

                        this.startPing();
                        this.onConnectionEstablished();
                        setTimeout(() => this.showScreen('main'), 500);
                    } else {
                        console.error('[P2P] Auth Failed:', data.error);
                        this.updateLoginStatus('Auth Failed: ' + data.error, 'error');
                        this.showErrorOverlay('Auth Failed');
                        // If token invalid, maybe delete saved device?
                    }
                    return;
                }

                this.handleMessage(data);
            });

            conn.on('close', () => {
                console.log('[P2P] Closed');
                this.isConnected = false;
                this.updateStatus('error', 'Disconnected');
                if (this.isAuthenticated) this.handleConnectionLost(); // Only if we were fully connected
            });

            conn.on('error', (err) => {
                console.error('[P2P] Conn Error:', err);
                this.updateLoginStatus('Connection Failed', 'error');
                this.showErrorOverlay('Connection Failed');
            });
        });

        // Auto-reconnect to signaling server (keeps call capability alive)
        this.peer.on('disconnected', () => {
            console.log('[P2P] Disconnected from signaling server, reconnecting...');
            if (this.peer && !this.peer.destroyed) {
                this.peer.reconnect();
            }
        });

        this.peer.on('error', (err) => {
            console.error('[P2P] Error:', err);
            // Don't show error overlay for call failures - data channel still works
            if (err.type === 'peer-unavailable') {
                console.warn('[P2P] Peer unavailable (call may retry)');
                return;
            }
            this.updateLoginStatus('P2P Error: ' + err.type, 'error');
            this.showErrorOverlay('Error: ' + err.type);
        });
    }

    // Saved Devices Management (P2P Mode - restored from previous UI)
    loadSavedDevices() {
        try {
            const saved = localStorage.getItem('savedDevices');
            return saved ? JSON.parse(saved) : {};
        } catch (e) {
            console.error('Failed to load saved devices:', e);
            return {};
        }
    }

    saveSavedDevices() {
        try {
            localStorage.setItem('savedDevices', JSON.stringify(this.savedDevices));
            this.renderSavedDevices();
        } catch (e) {
            console.error('Failed to save devices:', e);
        }
    }

    saveDevice(hostId, computerName, token) {
        if (!hostId || !token) return;

        // Use hostId as key for uniqueness
        this.savedDevices[hostId] = {
            hostId: hostId,
            computerName: computerName,
            token: token, // Secure Token
            savedAt: Date.now()
        };
        this.saveSavedDevices();
        console.log('Device saved securely:', hostId);
    }

    setDefaultDevice(key) {
        localStorage.setItem('defaultDevice', key);
        this.renderSavedDevices();
    }

    removeDevice(key) {
        delete this.savedDevices[key];
        // If default was removed, clear it
        if (localStorage.getItem('defaultDevice') === key) {
            localStorage.removeItem('defaultDevice');
        }
        this.saveSavedDevices();
    }

    renderSavedDevices() {
        const savedKeys = Object.keys(this.savedDevices);
        const defaultDevice = localStorage.getItem('defaultDevice');

        if (savedKeys.length === 0) {
            if (this.loginEl.savedConnections) this.loginEl.savedConnections.style.display = 'none';
            return;
        }

        if (this.loginEl.savedConnections) this.loginEl.savedConnections.style.display = 'block';

        if (this.loginEl.savedList) {
            this.loginEl.savedList.innerHTML = savedKeys.map(key => {
                const device = this.savedDevices[key];
                const isDefault = defaultDevice === key;
                return `
                    <div class="saved-card" data-key="${key}">
                        <div class="card-left">
                            <div class="device-icon-box">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                                    <line x1="8" y1="21" x2="16" y2="21"></line>
                                    <line x1="12" y1="17" x2="12" y2="21"></line>
                                </svg>
                            </div>
                            <div class="device-info">
                                <div class="device-name">${device.computerName || 'Unknown PC'}</div>
                                <div class="device-status">
                                    <span class="status-dot">●</span> Secure Connection
                                </div>
                            </div>
                        </div>
                        <div class="card-actions">
                            <button class="action-btn star-btn ${isDefault ? 'active' : ''}" data-key="${key}" title="${isDefault ? 'Default Device' : 'Set as Default'}">
                                ${isDefault ? '★' : '☆'}
                            </button>
                            <button class="action-btn trash-btn" data-key="${key}" title="Remove">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');

            // Click Handler: Main Card (Connect)
            this.loginEl.savedList.querySelectorAll('.saved-card').forEach(el => {
                el.onclick = (e) => {
                    // Ignore clicks on action buttons
                    if (e.target.closest('.action-btn')) return;
                    this.connectFromSaved(el.dataset.key);
                };
            });

            // Action Handlers
            this.loginEl.savedList.querySelectorAll('.star-btn').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    this.setDefaultDevice(btn.dataset.key);
                };
            });

            this.loginEl.savedList.querySelectorAll('.trash-btn').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    this.removeDevice(btn.dataset.key);
                };
            });
        }
    }

    connectFromSaved(key, silent = false) {
        const device = this.savedDevices[key];
        if (device) {
            this.computerName = device.computerName;
            if (!silent) this.updateLoginStatus('Connecting securely...', 'connecting');
            // Connect using Secure Channel (HostID + Token)
            this.connectP2P(device.hostId, true, device.token, silent);
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
        this.isAuthenticated = false;
        this.stopPing();
        this.onConnectionTornDown();
    }

    scheduleReconnect() {
        if (this.reconnectAttempts++ >= 10) return;
        setTimeout(() => { if (!this.isConnected) this.connect(); }, Math.min(1000 * Math.pow(1.5, this.reconnectAttempts - 1), 10000));
    }

    updateStatus(s, t) {
        if (this.el.connBtn) {
            this.el.connBtn.classList.remove('connected', 'error');
            if (s === 'connected') this.el.connBtn.classList.add('connected');
            else if (s === 'error') this.el.connBtn.classList.add('error');
        }
        if (this.el.connText) this.el.connText.textContent = t;
    }

    // Ping-Pong Heartbeat System
    startPing() {
        if (this.pingInt) clearInterval(this.pingInt);
        this.lastPongTime = Date.now();
        this.missedPongs = 0;

        // Send ping every 5 seconds (matches desktop rhythm, keeps NAT alive)
        this.pingInt = setInterval(() => {
            if (this.isConnected && this.isAuthenticated) {
                // Send ping
                if (this.p2pConn && this.p2pConn.open) {
                    this.p2pConn.send({ type: 'ping', time: Date.now() });
                }

                // Check if we've received a pong recently
                const timeSinceLastPong = Date.now() - this.lastPongTime;
                if (timeSinceLastPong > 25000) { // 25s without pong
                    this.missedPongs++;
                    console.warn(`[Ping] Missed pong #${this.missedPongs}`);

                    if (this.missedPongs >= 4) {
                        console.error('[Ping] Connection lost - disconnecting');
                        this.handleConnectionLost();
                    }
                } else {
                    this.missedPongs = 0; // Reset on successful pong
                }
            }
        }, 5000);
        console.log('[Ping] Started P2P heartbeat service');
    }

    stopPing() {
        if (this.pingInt) {
            clearInterval(this.pingInt);
            this.pingInt = null;
        }
    }

    // =============================================
    // BACKGROUND SURVIVAL SYSTEM
    // Keeps connection alive when phone sleeps/backgrounds
    // =============================================

    // Request Wake Lock to prevent CPU/screen sleep
    async acquireWakeLock() {
        // Try Web Wake Lock API (Chrome 84+, Android WebView)
        if ('wakeLock' in navigator) {
            try {
                this.wakeLock = await navigator.wakeLock.request('screen');
                console.log('[WakeLock] Acquired');
                this.wakeLock.addEventListener('release', () => {
                    console.log('[WakeLock] Released');
                    // Re-acquire if still connected (released due to tab switch)
                    if (this.isConnected && this.isAuthenticated && document.visibilityState === 'visible') {
                        this.acquireWakeLock();
                    }
                });
            } catch (err) {
                console.warn('[WakeLock] Failed:', err.message);
            }
        }

        // Try Capacitor KeepAwake plugin
        try {
            const { KeepAwake } = window.Capacitor?.Plugins || {};
            if (KeepAwake) {
                await KeepAwake.keepAwake();
                console.log('[KeepAwake] Capacitor keep-awake enabled');
            }
        } catch (err) {
            console.warn('[KeepAwake] Capacitor plugin not available:', err.message);
        }
    }

    async releaseWakeLock() {
        if (this.wakeLock) {
            try {
                await this.wakeLock.release();
            } catch { }
            this.wakeLock = null;
        }

        try {
            const { KeepAwake } = window.Capacitor?.Plugins || {};
            if (KeepAwake) {
                await KeepAwake.allowSleep();
            }
        } catch { }
    }

    // Silent audio keep-alive: prevents Android from killing WebView in background
    startKeepAliveAudio() {
        if (this.keepAliveAudio) return;

        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            // Create a silent oscillator
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();
            gainNode.gain.value = 0.001; // Near-silent
            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);
            oscillator.start();

            this.keepAliveAudio = { ctx, oscillator, gainNode };
            console.log('[KeepAlive] Silent audio started');
        } catch (err) {
            console.warn('[KeepAlive] Audio context failed:', err.message);
        }
    }

    stopKeepAliveAudio() {
        if (this.keepAliveAudio) {
            try {
                this.keepAliveAudio.oscillator.stop();
                this.keepAliveAudio.ctx.close();
            } catch { }
            this.keepAliveAudio = null;
            console.log('[KeepAlive] Silent audio stopped');
        }
    }

    // Setup all background survival listeners
    setupBackgroundSurvival() {
        // Capacitor App state change (native Android foreground/background)
        try {
            const { App } = window.Capacitor?.Plugins || {};
            if (App) {
                App.addListener('appStateChange', ({ isActive }) => {
                    console.log(`[Background] App state: ${isActive ? 'FOREGROUND' : 'BACKGROUND'}`);
                    if (isActive) {
                        this.handleResume();
                    } else {
                        this.handleBackground();
                    }
                });
                console.log('[Background] Capacitor App listener registered');
            }
        } catch (err) {
            console.warn('[Background] Capacitor App plugin not available:', err.message);
        }

        // Page Lifecycle API events
        document.addEventListener('freeze', () => {
            console.log('[Background] Page frozen');
            this.handleBackground();
        });

        document.addEventListener('resume', () => {
            console.log('[Background] Page resumed from freeze');
            this.handleResume();
        });
    }

    handleBackground() {
        this.backgroundTimestamp = Date.now();
        console.log('[Background] Entering background, connection state:', this.isConnected);

        // Send a last ping before going to background
        if (this.isConnected && this.p2pConn && this.p2pConn.open) {
            this.p2pConn.send({ type: 'ping', time: Date.now() });
        }
    }

    handleResume() {
        const bgDuration = this.backgroundTimestamp ? Date.now() - this.backgroundTimestamp : 0;
        console.log(`[Background] Resuming after ${Math.round(bgDuration / 1000)}s`);
        this.backgroundTimestamp = null;

        // Re-acquire wake lock (Android releases it on background)
        if (this.isConnected && this.isAuthenticated) {
            this.acquireWakeLock();
        }

        // Reset heartbeat timers to prevent false-positive death detection
        this.lastPongTime = Date.now();
        this.missedPongs = 0;

        if (this.isConnected && this.p2pConn) {
            if (this.p2pConn.open) {
                // Connection object says it's open - verify with a fast ping probe
                console.log('[Background] Sending probe ping...');
                this.p2pConn.send({ type: 'ping', time: Date.now() });

                // If no pong in 5s after resume, connection is dead - reconnect
                if (this.resumeProbeTimer) clearTimeout(this.resumeProbeTimer);
                this.resumeProbeTimer = setTimeout(() => {
                    if (Date.now() - this.lastPongTime > 4500) {
                        console.warn('[Background] Probe failed - no pong after resume, reconnecting...');
                        this.handleConnectionLost();
                    } else {
                        console.log('[Background] Probe succeeded - connection alive');
                    }
                }, 5000);
            } else {
                // Connection is already closed, reconnect immediately
                console.warn('[Background] Connection closed during background, reconnecting...');
                this.handleConnectionLost();
            }
        } else if (!this.isConnected) {
            // Not connected at all, try auto-reconnect
            const defaultDevice = localStorage.getItem('defaultDevice');
            if (defaultDevice && this.savedDevices[defaultDevice]) {
                console.log('[Background] Not connected, auto-reconnecting...');
                this.connectFromSaved(defaultDevice, true);
            }
        }
    }

    // Android Foreground Service — prevents Android from killing the app
    async startForegroundService() {
        try {
            const { ForegroundService } = window.Capacitor?.Plugins || {};
            if (!ForegroundService) {
                console.warn('[ForegroundService] Plugin not available');
                return;
            }
            await ForegroundService.startForegroundService({
                id: 1,
                title: 'Keymote Connected',
                body: 'Remote control session active',
                smallIcon: 'ic_stat_connected',
                buttons: [{ title: 'Disconnect', id: 1 }]
            });
            console.log('[ForegroundService] Started');

            // Handle disconnect button press from notification
            ForegroundService.addListener('buttonClicked', ({ buttonId }) => {
                if (buttonId === 1) {
                    this.handleConnectionLost();
                }
            });
        } catch (err) {
            console.warn('[ForegroundService] Failed to start:', err.message);
        }
    }

    async stopForegroundService() {
        try {
            const { ForegroundService } = window.Capacitor?.Plugins || {};
            if (ForegroundService) {
                await ForegroundService.stopForegroundService();
                console.log('[ForegroundService] Stopped');
            }
        } catch { }
    }

    // Called when connection is successfully established
    onConnectionEstablished() {
        this.acquireWakeLock();
        this.startKeepAliveAudio();
        this.startForegroundService();
    }

    // Called when connection is fully torn down
    onConnectionTornDown() {
        this.releaseWakeLock();
        this.stopKeepAliveAudio();
        this.stopForegroundService();
        if (this.resumeProbeTimer) {
            clearTimeout(this.resumeProbeTimer);
            this.resumeProbeTimer = null;
        }
    }

    handleConnectionLost() {
        this.stopPing();
        this.onConnectionTornDown();
        this.isConnected = false;
        this.isAuthenticated = false;

        if (this.p2pConn) {
            this.p2pConn.close();
            this.p2pConn = null;
        }

        // Destroy peer to release the ID/port
        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }

        // Auto-reconnect using saved device credentials
        const defaultDevice = localStorage.getItem('defaultDevice');
        if (defaultDevice && this.savedDevices[defaultDevice]) {
            this.autoReconnectAttempts = (this.autoReconnectAttempts || 0) + 1;

            if (this.autoReconnectAttempts <= 5) {
                // Exponential backoff: 2s, 4s, 8s, 16s, 30s
                const delay = Math.min(2000 * Math.pow(2, this.autoReconnectAttempts - 1), 30000);
                console.log(`[Reconnect] Attempt ${this.autoReconnectAttempts}/5 in ${delay / 1000}s...`);
                this.updateStatus('error', `Reconnecting (${this.autoReconnectAttempts}/5)...`);

                if (this.autoReconnectTimer) clearTimeout(this.autoReconnectTimer);
                this.autoReconnectTimer = setTimeout(() => {
                    if (!this.isConnected) {
                        this.connectFromSaved(defaultDevice, true);
                    }
                }, delay);
                return; // Don't show login screen during auto-reconnect
            } else {
                console.warn('[Reconnect] Max attempts reached, giving up');
                this.autoReconnectAttempts = 0;
            }
        }

        this.updateStatus('error', 'Connection Lost');
        this.showScreen('login');
        this.renderSavedDevices();
    }

    // Helper: collapse screen share UI without sending a message
    stopScreenShareUI() {
        this.isStreaming = false;
        if (this.el.mouseContainer) this.el.mouseContainer.style.display = 'none';
        if (this.el.toggleMouse) this.el.toggleMouse.textContent = 'Show';
        const hint = document.getElementById('trackpadHint');
        if (hint) hint.style.display = 'flex';
        this.send({ type: 'screen', action: 'stop' });
    }

    // Helper: collapse audio share UI without sending a message
    stopAudioShareUI() {
        this.isAudioSharing = false;
        const audioContainer = document.getElementById('audioContainer');
        const toggleAudio = document.getElementById('toggleAudio');
        const status = document.getElementById('audioStatus');
        if (audioContainer) audioContainer.style.display = 'none';
        if (toggleAudio) toggleAudio.textContent = 'Start';
        if (status) status.textContent = '';
        this.send({ type: 'audio', action: 'stop' });
    }

    handleMessage(data) {
        // DOM queries for cursor indicator
        const cursorIndicator = document.getElementById('cursorIndicator');
        const screenViewer = document.getElementById('screenViewer');

        try {
            // Handle both P2P objects (raw) and WebSocket strings (JSON)
            const m = (typeof data === 'string') ? JSON.parse(data) : data;

            // Respond to incoming Pings (Heartbeat from Desktop)
            if (m.type === 'ping') {
                this.send({ type: 'pong', time: Date.now() });
                return;
            }

            // Handle server connection response
            if (m.type === 'connected') {
                this.authRequired = m.authRequired;
                if (!m.authRequired) {
                    // No auth required, we're connected - show main app
                    this.isAuthenticated = true;
                    this.updateStatus('connected', 'Connected');
                    this.updateLoginStatus('Connected!', 'success');
                    this.startPing();
                    this.showScreen('main');
                } else {
                    // Auth required - try token first, then PIN
                    if (this.pendingToken) {
                        // Try token auth
                        this.send({
                            type: 'auth',
                            token: this.pendingToken,
                            deviceId: this.deviceId
                        });
                        this.updateLoginStatus('Connecting with saved credentials...', 'connecting');
                    } else if (this.pendingPin) {
                        // PIN auth with rememberMe
                        this.send({
                            type: 'auth',
                            pin: this.pendingPin,
                            computerName: this.computerName,
                            rememberMe: this.pendingRememberMe,
                            deviceId: this.deviceId
                        });
                        this.pendingPin = null;
                        this.updateLoginStatus('Authenticating...', 'connecting');
                    } else {
                        // No PIN or token, update login screen
                        this.updateLoginStatus('PIN required', 'error');
                    }
                }
                return;
            }

            // Handle auth result
            if (m.type === 'auth_result') {
                if (m.success) {
                    this.isAuthenticated = true;
                    this.updateStatus('connected', 'Connected');
                    this.updateLoginStatus('Authenticated!', 'success');
                    this.startPing();

                    // Save device if token was returned (rememberMe was true)
                    if (m.token) {
                        const computerName = m.computerName || this.computerName;
                        this.saveDevice(this.customServer, computerName, m.token);
                    }

                    // Clear pending data
                    this.pendingToken = null;
                    this.pendingRememberMe = false;

                    // Show main app after successful auth
                    setTimeout(() => this.showScreen('main'), 500);
                } else {
                    // Auth failed
                    this.pendingToken = null; // Clear invalid token

                    // If token expired, remove from saved and prompt for PIN
                    if (m.requirePin) {
                        const key = this.customServer || 'local';
                        this.removeDevice(key);
                        this.updateLoginStatus('Session expired. Enter PIN to reconnect.', 'error');
                    } else {
                        this.updateStatus('error', m.error || 'Auth failed');
                        this.updateLoginStatus(m.error || 'Authentication failed', 'error');
                    }
                }
                return;
            }

            if (m.type === 'pong') {
                this.latencies.push(Date.now() - m.time);
                if (this.latencies.length > 10) this.latencies.shift();
                this.el.latency.textContent = Math.round(this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length) + 'ms';
            } else if (m.type === 'screen-chunk') {
                // Legacy chunk handling removed
                return;
            } else if (m.data) {
                // Legacy frame handling removed
                return;
            }
            // For 'cursor' frameType, we just update cursor position below

            // Position cursor indicator (for all frame types)
            if (cursorIndicator && m.cursorX !== undefined && m.cursorY !== undefined && screenViewer) {
                const viewerRect = screenViewer.getBoundingClientRect();
                const isRotated = screenViewer.classList.contains('rotated');
                const effectiveWidth = isRotated ? viewerRect.height : viewerRect.width;
                const effectiveHeight = isRotated ? viewerRect.width : viewerRect.height;

                const screenW = m.width || this.screenWidth || 1920;
                const screenH = m.height || this.screenHeight || 1080;
                const imgAspect = screenW / screenH;
                const viewerAspect = effectiveWidth / effectiveHeight;

                let imgWidth, imgHeight, offsetX = 0, offsetY = 0;
                if (imgAspect > viewerAspect) {
                    imgWidth = effectiveWidth;
                    imgHeight = effectiveWidth / imgAspect;
                    offsetY = (effectiveHeight - imgHeight) / 2;
                } else {
                    imgHeight = effectiveHeight;
                    imgWidth = effectiveHeight * imgAspect;
                    offsetX = (effectiveWidth - imgWidth) / 2;
                }

                let cursorXPx = offsetX + (m.cursorX / screenW) * imgWidth;
                let cursorYPx = offsetY + (m.cursorY / screenH) * imgHeight;

                cursorIndicator.style.left = cursorXPx + 'px';
                cursorIndicator.style.top = cursorYPx + 'px';
                cursorIndicator.style.display = 'block';
            }

            // Handle pong response
            if (m.type === 'pong') {
                console.log('[Ping] Received pong');
                this.lastPongTime = Date.now();
                this.missedPongs = 0;
            }

        } catch { }
    }

    send(m) {
        // P2P Only
        if (this.p2pConn && this.p2pConn.open) {
            this.p2pConn.send(m);
            return true;
        }
        return false;
    }

    handleInput(e) {
        const v = e.target.value;
        if (v.length > this.lastValue.length) this.sendText(v.slice(this.lastValue.length));
        this.lastValue = v;
    }

    handleKeyDown(e) {
        const special = ['Backspace', 'Delete', 'Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'];
        if (special.includes(e.key)) {
            e.preventDefault();
            this.sendKey(e.key);
            if (e.key === 'Backspace') {
                const p = e.target.selectionStart;
                if (p > 0) { e.target.value = e.target.value.slice(0, p - 1) + e.target.value.slice(p); e.target.selectionStart = e.target.selectionEnd = p - 1; }
            } else if (e.key === 'Enter') {
                const p = e.target.selectionStart;
                e.target.value = e.target.value.slice(0, p) + '\n' + e.target.value.slice(p);
                e.target.selectionStart = e.target.selectionEnd = p + 1;
            }
            this.lastValue = e.target.value;
        }
    }

    sendText(t, delay = 0) {
        if (t) {
            this.send({ type: 'text', text: t, modifiers: this.getMods(), delay: delay });
            if (this.hasModifiers()) this.releaseMods();
        }
    }
    sendKey(k) { this.send({ type: 'key', key: k, modifiers: this.getMods() }); this.releaseMods(); }
    sendShortcut(s) {
        const parts = s.toLowerCase().split('+');
        const mods = { ctrl: parts.includes('ctrl'), alt: parts.includes('alt'), shift: parts.includes('shift'), win: parts.includes('win') };
        const key = parts[parts.length - 1].toUpperCase();
        this.send({ type: 'shortcut', key, modifiers: mods });
    }

    sendMouse(action, opts = {}) {
        this.send({ type: 'mouse', action, ...opts });
    }

    toggleMod(m) { this.modifiers[m] = !this.modifiers[m]; this.el[m]?.classList.toggle('active', this.modifiers[m]); }
    getMods() { return { ...this.modifiers }; }
    hasModifiers() { return this.modifiers.ctrl || this.modifiers.alt || this.modifiers.shift || this.modifiers.win; }
    releaseMods() { ['ctrl', 'alt', 'shift', 'win'].forEach(m => { this.modifiers[m] = false; this.el[m]?.classList.remove('active'); }); }

    // Screen settings methods
    loadScreenSettings() {
        this.screenOffsetX = parseInt(localStorage.getItem('screenOffsetX') || '0', 10);
        this.screenOffsetY = parseInt(localStorage.getItem('screenOffsetY') || '0', 10);
        this.screenZoom = parseInt(localStorage.getItem('screenZoom') || '100', 10);
        this.applyScreenTransform();
    }

    setupScreenSettingsListeners() {
        const updateX = (val) => {
            this.screenOffsetX = Math.max(-200, Math.min(200, val));
            if (this.el.screenOffsetX) this.el.screenOffsetX.value = this.screenOffsetX;
            if (this.el.screenOffsetXValue) this.el.screenOffsetXValue.value = this.screenOffsetX;
            localStorage.setItem('screenOffsetX', this.screenOffsetX.toString());
            this.applyScreenTransform();
        };

        const updateY = (val) => {
            this.screenOffsetY = Math.max(-200, Math.min(200, val));
            if (this.el.screenOffsetY) this.el.screenOffsetY.value = this.screenOffsetY;
            if (this.el.screenOffsetYValue) this.el.screenOffsetYValue.value = this.screenOffsetY;
            localStorage.setItem('screenOffsetY', this.screenOffsetY.toString());
            this.applyScreenTransform();
        };

        const updateZoom = (val) => {
            this.screenZoom = Math.max(50, Math.min(400, val));
            if (this.el.screenZoom) this.el.screenZoom.value = this.screenZoom;
            if (this.el.screenZoomValue) this.el.screenZoomValue.value = this.screenZoom;
            localStorage.setItem('screenZoom', this.screenZoom.toString());
            this.applyScreenTransform();
        };

        // X offset controls
        if (this.el.screenOffsetX) {
            this.el.screenOffsetX.value = this.screenOffsetX;
            this.el.screenOffsetX.oninput = () => updateX(parseInt(this.el.screenOffsetX.value, 10));
        }
        if (this.el.screenOffsetXValue) {
            this.el.screenOffsetXValue.value = this.screenOffsetX;
            this.el.screenOffsetXValue.onchange = () => updateX(parseInt(this.el.screenOffsetXValue.value, 10) || 0);
        }
        if (this.el.screenOffsetXMinus) this.el.screenOffsetXMinus.onclick = () => updateX(this.screenOffsetX - 10);
        if (this.el.screenOffsetXPlus) this.el.screenOffsetXPlus.onclick = () => updateX(this.screenOffsetX + 10);

        // Y offset controls
        if (this.el.screenOffsetY) {
            this.el.screenOffsetY.value = this.screenOffsetY;
            this.el.screenOffsetY.oninput = () => updateY(parseInt(this.el.screenOffsetY.value, 10));
        }
        if (this.el.screenOffsetYValue) {
            this.el.screenOffsetYValue.value = this.screenOffsetY;
            this.el.screenOffsetYValue.onchange = () => updateY(parseInt(this.el.screenOffsetYValue.value, 10) || 0);
        }
        if (this.el.screenOffsetYMinus) this.el.screenOffsetYMinus.onclick = () => updateY(this.screenOffsetY - 10);
        if (this.el.screenOffsetYPlus) this.el.screenOffsetYPlus.onclick = () => updateY(this.screenOffsetY + 10);

        // Zoom controls
        if (this.el.screenZoom) {
            this.el.screenZoom.value = this.screenZoom;
            this.el.screenZoom.oninput = () => updateZoom(parseInt(this.el.screenZoom.value, 10));
        }
        if (this.el.screenZoomValue) {
            this.el.screenZoomValue.value = this.screenZoom;
            this.el.screenZoomValue.onchange = () => updateZoom(parseInt(this.el.screenZoomValue.value, 10) || 100);
        }

        // Reset button
        if (this.el.resetScreenSettings) {
            this.el.resetScreenSettings.onclick = () => {
                updateX(0);
                updateY(0);
                updateZoom(100);
            };
        }
    }

    applyScreenTransform() {
        const wrapper = document.getElementById('screenTransformWrapper');
        if (wrapper) {
            const scale = this.screenZoom / 100;
            wrapper.style.transform = `translate(${this.screenOffsetX}px, ${this.screenOffsetY}px) scale(${scale})`;
            wrapper.style.transformOrigin = 'center center';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new RemoteInputApp();
});
