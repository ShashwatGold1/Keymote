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
            main: document.getElementById('mainApp')
        };

        // Login screen elements
        this.loginEl = {
            serverAddress: document.getElementById('loginServerAddress'),
            computerName: document.getElementById('loginComputerName'),
            pin: document.getElementById('loginPin'),
            connectBtn: document.getElementById('loginConnectBtn'),
            status: document.getElementById('loginStatus'),
            savedConnections: document.getElementById('savedConnections'),
            savedList: document.getElementById('savedList'),
            newConnectionToggle: document.getElementById('newConnectionToggle'),
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
            // Settings modal elements
            settingsBtn: document.getElementById('settingsBtn'),
            settingsModal: document.getElementById('settingsModal'),
            closeSettingsBtn: document.getElementById('closeSettingsBtn'),
            serverAddressInput: document.getElementById('serverAddress'),
            computerNameInput: document.getElementById('computerNameInput'),
            pinInput: document.getElementById('pinInput'),
            saveSettingsBtn: document.getElementById('saveSettingsBtn'),
            authStatus: document.getElementById('authStatus'),
            splashDurationInput: document.getElementById('splashDurationInput'),
            splashDurationValue: document.getElementById('splashDurationValue')
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
        }, splashDuration);
    }

    showScreen(screen) {
        // Hide all screens
        if (this.screens.blocked) this.screens.blocked.style.display = 'none';
        if (this.screens.splash) this.screens.splash.style.display = 'none';
        if (this.screens.login) this.screens.login.style.display = 'none';
        if (this.screens.main) this.screens.main.style.display = 'none';

        // Show requested screen
        if (screen === 'blocked' && this.screens.blocked) {
            this.screens.blocked.style.display = 'flex';
        } else if (screen === 'splash' && this.screens.splash) {
            this.screens.splash.style.display = 'flex';
        } else if (screen === 'login' && this.screens.login) {
            this.screens.login.style.display = 'flex';
        } else if (screen === 'main' && this.screens.main) {
            this.screens.main.style.display = 'flex';
        }
    }

    setupLoginListeners() {
        // Show saved connections if any exist
        this.renderSavedDevices();

        // Toggle for new connection form
        if (this.loginEl.newConnectionToggle) {
            this.loginEl.newConnectionToggle.onclick = () => {
                if (this.loginEl.loginForm) {
                    this.loginEl.loginForm.classList.toggle('collapsed');
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

        // Settings modal handlers
        if (this.el.settingsBtn) {
            this.el.settingsBtn.onclick = () => {
                // Pre-populate fields with saved values
                this.el.serverAddressInput.value = this.customServer;
                this.el.computerNameInput.value = this.computerName;
                this.el.pinInput.value = '';
                this.el.authStatus.textContent = '';
                this.el.authStatus.className = 'auth-status';
                // Set splash duration slider
                const savedSplashDuration = parseInt(localStorage.getItem('splashDuration') || '2500', 10);
                if (this.el.splashDurationInput) this.el.splashDurationInput.value = savedSplashDuration;
                if (this.el.splashDurationValue) this.el.splashDurationValue.textContent = (savedSplashDuration / 1000).toFixed(1) + 's';
                this.el.settingsModal.style.display = 'flex';
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

        if (this.el.closeSettingsBtn) {
            this.el.closeSettingsBtn.onclick = () => {
                this.el.settingsModal.style.display = 'none';
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

                // Close modal and reconnect
                this.el.settingsModal.style.display = 'none';
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

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !this.isConnected) this.connect();
        });
    }

    connect() {
        if (this.ws?.readyState === WebSocket.OPEN) return;

        // Use custom server if set, otherwise auto-detect from current page
        let url;
        if (this.customServer) {
            // Add ws:// or wss:// prefix if not present
            const server = this.customServer.includes('://')
                ? this.customServer
                : `ws://${this.customServer}`;
            url = server;
        } else {
            url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
        }

        this.updateStatus('connecting', 'Connecting...');
        this.isAuthenticated = false;

        try {
            this.ws = new WebSocket(url);
            this.ws.onopen = () => {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.updateStatus('connected', 'Auth...');
            };
            this.ws.onclose = () => {
                this.isConnected = false;
                this.isAuthenticated = false;
                this.stopPing();
                this.updateStatus('error', 'Disconnected');
                this.scheduleReconnect();
            };
            this.ws.onerror = () => this.updateStatus('error', 'Error');
            this.ws.onmessage = e => this.handleMessage(e.data);
        } catch { this.updateStatus('error', 'Failed'); this.scheduleReconnect(); }
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
        try {
            const m = JSON.parse(data);

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
            } else if (m.type === 'screen-frame') {
                // Display screen frame
                const screenImg = document.getElementById('screenImage');
                const cursorIndicator = document.getElementById('cursorIndicator');
                const screenViewer = document.getElementById('screenViewer');

                // Handle full frame (full, key, sync, or no frameType)
                if ((m.frameType === 'full' || m.frameType === 'key' || m.frameType === 'sync' || !m.frameType) && m.data) {
                    if (screenImg) {
                        screenImg.src = m.data;
                        screenImg.style.display = 'block';
                        // Store dimensions for cursor positioning
                        this.screenWidth = m.width;
                        this.screenHeight = m.height;
                    }
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
            }
        } catch { }
    }

    send(m) { if (this.isConnected && this.ws) { m.id = ++this.messageId; this.ws.send(JSON.stringify(m)); return true; } return false; }

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
}

document.addEventListener('DOMContentLoaded', () => { window.app = new RemoteInputApp(); });
