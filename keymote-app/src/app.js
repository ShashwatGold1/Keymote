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
        this.theme = localStorage.getItem('theme') || 'dark';
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
            // newConnectionToggle removed
            loginForm: document.getElementById('loginForm'),
            // screen: document.getElementById('loginScreen'), // (Already in this.screens.login?) -- wait, let's keep it simple
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
        this.applyTheme(this.theme);
        this.setupListeners();
        this.setupLoginListeners();

        // Check if running in Capacitor (native app) or browser
        const isCapacitor = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();

        if (!isCapacitor) {
            // Block browser access
            this.showScreen('blocked');
            return;
        }

        // Start with splash screen, transition to login after configurable duration
        const splashDuration = parseInt(localStorage.getItem('splashDuration') || '2500', 10);
        this.showScreen('splash');
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
            } else if (result && result.barcodes) {
                // Cancelled or no code
            } else {
                console.log("Unexpected result format:", result);
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
        try {
            const connectionData = JSON.parse(data);
            console.log('QR Connection data:', connectionData);

            // Extract connection info
            this.customServer = connectionData.url
                ? connectionData.url.replace('http://', '').replace('https://', '')
                : `${connectionData.ip}:${connectionData.port}`;
            this.computerName = connectionData.name || '';
            this.pendingPin = connectionData.pin || '';
            this.pendingRememberMe = true;

            // Save settings
            localStorage.setItem('customServer', this.customServer);
            localStorage.setItem('computerName', this.computerName);

            // If PIN is present, use P2P mode directly (for internet connections)
            if (this.pendingPin) {
                console.log('QR has PIN, using P2P mode...');
                // Overlay already shown in startNativeQrScanner
                this.updateLoginStatus('Connecting via P2P...', 'connecting');
                this.connectP2P(this.pendingPin);
                return;
            }

            // Fallback to regular connect (WebSocket for local network)
            this.updateLoginStatus('Connecting via QR...', 'connecting');
            this.connect();
        } catch (error) {
            console.error('Invalid QR data:', error);
            // Try treating it as a simple URL
            if (data && data.includes(':')) {
                this.customServer = data.replace('http://', '').replace('https://', '');
                localStorage.setItem('customServer', this.customServer);
                this.updateLoginStatus('Connecting...', 'connecting');
                this.connect();
            } else {
                alert('Invalid QR code. Please scan the QR from your Keymote PC app.');
            }
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
        const list = this.loginEl.savedList;
        const container = this.loginEl.savedConnections;
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
                    this.connect();
                }
            });
        });

        list.querySelectorAll('.saved-device-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const key = e.target.dataset.key;
                this.removeDevice(key);
                this.renderSavedDevices();
            });
        });
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

        this.el.input.addEventListener('input', e => this.handleInput(e));
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

                // If shift is held and button has shift character, send the shift character
                if (this.modifiers.shift && shiftChar) {
                    this.sendText(shiftChar);
                    return;
                }

                if (this.hasModifiers()) {
                    this.sendKey(key);
                } else if (key.length === 1 && /[a-zA-Z0-9]/.test(key)) {
                    this.sendText(this.modifiers.shift ? key.toUpperCase() : key.toLowerCase());
                } else if (key.length === 1) {
                    this.sendText(key);
                } else {
                    this.sendKey(key);
                }
            };
        });

        // Symbol buttons (data-text)
        document.querySelectorAll('[data-text]').forEach(btn => {
            btn.onclick = () => this.sendText(btn.dataset.text);
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

            trackpadOverlay.addEventListener('touchstart', (e) => {
                e.preventDefault();
                if (e.touches.length === 1) {
                    lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                    touchStartTime = Date.now();
                    touchMoved = false;
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
                }
            }, { passive: false });

            trackpadOverlay.addEventListener('touchend', (e) => {
                // Tap to click (if touch was short and didn't move)
                if (!touchMoved && Date.now() - touchStartTime < 200) {
                    this.sendMouse('left');
                }
                lastTouch = null;
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
            if (document.visibilityState === 'visible' && !this.isConnected) this.connect();
        });
    }

    connect() {
        // Disconnect if already connected
        this.disconnect();

        // Check for Internet Mode (P2P)
        const internetMode = document.getElementById('internetMode');
        if (internetMode && internetMode.checked) {
            console.log('Connecting via Internet (P2P)...');
            this.pendingPin = this.loginEl.pin.value;
            this.connectP2P(this.pendingPin);
            return;
        }

        // Determine server URL
        let url = '';
        if (this.customServer) {
            let server = this.customServer.trim();
            // Convert HTTP/HTTPS URLs to WebSocket protocols
            if (server.startsWith('https://')) {
                server = 'wss://' + server.slice(8);
            } else if (server.startsWith('http://')) {
                server = 'ws://' + server.slice(7);
            } else if (!server.includes('://')) {
                // No protocol - default to ws://
                server = `ws://${server}`;
            }
            url = server;
        } else {
            url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
        }

        this.websocketConnect(url);
    }

    websocketConnect(url) {
        this.updateStatus('connecting', 'Connecting...');
        this.isAuthenticated = false;

        try {
            this.ws = new WebSocket(url);
            this.ws.onopen = () => {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.updateStatus('connected', 'Auth...');
                this.p2pConn = null; // Clear P2P if WS connects
            };
            this.ws.onclose = () => {
                this.isConnected = false;
                this.isAuthenticated = false;
                this.stopPing();
                this.updateStatus('error', 'Disconnected');
                // Only schedule reconnect if not intentionally P2P
                if (!this.p2pConn) this.scheduleReconnect();
            };
            this.ws.onerror = () => this.updateStatus('error', 'Error');
            this.ws.onmessage = e => this.handleMessage(e.data);
        } catch { this.updateStatus('error', 'Failed'); this.scheduleReconnect(); }
    }

    // P2P Connection Logic
    connectP2P(pin) {
        if (!pin) {
            this.updateLoginStatus('PIN required for Internet Mode', 'error');
            return;
        }

        this.updateLoginStatus('Initializing P2P...', 'connecting');

        // Initialize Peer
        if (this.peer) this.peer.destroy();
        this.peer = new Peer({
            debug: 1,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:global.stun.twilio.com:3478' }
                ]
            }
        });

        this.peer.on('call', (call) => {
            console.log('[P2P] Incoming Video Call');
            call.answer(); // Answer automatically

            call.on('stream', (stream) => {
                console.log('[P2P] Stream Received');
                const video = document.getElementById('remoteVideo');
                const img = document.getElementById('screenImage');

                if (video) {
                    video.srcObject = stream;
                    video.style.display = 'block';
                    if (img) img.style.display = 'none'; // Hide fallback

                    video.onloadedmetadata = () => {
                        video.play().catch(e => console.error('Play error:', e));
                        this.screenWidth = video.videoWidth;
                        this.screenHeight = video.videoHeight;
                        if (this.el.statusText) this.el.statusText.textContent = `Video: ${video.videoWidth}x${video.videoHeight} (Stream)`;
                    };
                }
            });

            call.on('error', (err) => console.error('[P2P] Call error:', err));
        });

        this.peer.on('open', (id) => {
            console.log('[P2P] My Peer ID:', id);
            this.updateLoginStatus('Contacting PC...', 'connecting');

            // Connect to PC peer: keymote-<PIN>
            const targetId = `keymote-${pin}`;
            console.log('[P2P] Connecting to:', targetId);

            const conn = this.peer.connect(targetId);

            conn.on('open', () => {
                console.log('[P2P] Connected!');
                this.p2pConn = conn;
                this.isConnected = true;
                this.isAuthenticated = true; // P2P implies auth via PIN knowledge? Or we should send auth frame.
                // Ideally we send an auth frame, but for now let's assume PIN knowledge = access since PeerID is derived from PIN.

                this.updateStatus('connected', 'Internet Connected');
                this.updateLoginStatus('Connected via Internet!', 'success');
                this.startPing();

                // Auto-transition
                setTimeout(() => this.showScreen('main'), 500);
            });

            conn.on('data', (data) => {
                this.handleMessage(data); // P2P Data is usually objects, WS is strings.
            });

            conn.on('close', () => {
                console.log('[P2P] Closed');
                this.isConnected = false;
                this.p2pConn = null;
                this.updateStatus('error', 'Disconnected');
            });

            conn.on('error', (err) => {
                console.error('[P2P] Conn Error:', err);
                this.updateLoginStatus('Connection Failed', 'error');
            });
        });

        this.peer.on('error', (err) => {
            console.error('[P2P] Error:', err);
            this.updateLoginStatus('P2P Error: ' + err.type, 'error');
        });
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
        this.isAuthenticated = false;
        this.stopPing();
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

    startPing() { this.pingInt = setInterval(() => { if (this.isConnected) this.send({ type: 'ping', time: Date.now() }); }, 5000); }
    stopPing() { if (this.pingInt) { clearInterval(this.pingInt); this.pingInt = null; } }

    handleMessage(data) {
        // DOM queries for cursor indicator
        const cursorIndicator = document.getElementById('cursorIndicator');
        const screenViewer = document.getElementById('screenViewer');

        try {
            // Handle both P2P objects (raw) and WebSocket strings (JSON)
            const m = (typeof data === 'string') ? JSON.parse(data) : data;

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

        } catch { }
    }

    send(m) {
        // P2P Priority
        if (this.p2pConn && this.p2pConn.open) {
            this.p2pConn.send(m);
            return true;
        }
        // WebSocket Fallback
        if (this.isConnected && this.ws) {
            m.id = ++this.messageId;
            this.ws.send(JSON.stringify(m));
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

    sendText(t) { if (t) { this.send({ type: 'text', text: t, modifiers: this.getMods() }); if (this.hasModifiers()) this.releaseMods(); } }
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
            this.screenZoom = Math.max(50, Math.min(200, val));
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
        if (this.el.screenImage) {
            const scale = this.screenZoom / 100;
            this.el.screenImage.style.transform = `translate(${this.screenOffsetX}px, ${this.screenOffsetY}px) scale(${scale})`;
            this.el.screenImage.style.transformOrigin = 'center center';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new RemoteInputApp();
});
