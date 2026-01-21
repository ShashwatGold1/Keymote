/**
 * Screen Capturer - Simple 5 FPS JPEG streaming
 */

const { desktopCapturer, screen } = require('electron');
const EventEmitter = require('events');

class ScreenCapturer extends EventEmitter {
    constructor(wsServer) {
        super(); // Initialize EventEmitter
        this.wsServer = wsServer;
        this.isStreaming = false;
        this.interval = null;
        // Reduced resolution for better performance
        this.screenWidth = 1280;
        this.screenHeight = 720;
        this.quality = 35; // Lower quality for speed
        this.lastFrameTime = 0;
        this.fps = 5;
    }

    async startStreaming() {
        if (this.isStreaming) return;

        // Force 480p resolution for P2P reliability
        // 1920x1080 is too big for WebRTC Data Channels
        this.screenWidth = 854;
        this.screenHeight = 480;

        console.log('[ScreenCapturer] Starting at', this.fps, 'FPS,',
            this.screenWidth, 'x', this.screenHeight, '(Forced 480p)');

        this.isStreaming = true;
        this.intervalId = setInterval(() => this.captureFrame(), 1000 / this.fps);
    }

    async captureFrame() {
        if (!this.isStreaming) return;

        try {
            console.log('[ScreenCapturer] Capturing...'); // DEBUG
            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: { width: this.screenWidth, height: this.screenHeight }
            });

            console.log('[ScreenCapturer] Sources found:', sources.length); // DEBUG

            if (sources.length === 0) return;

            const thumbnail = sources[0].thumbnail;
            if (!thumbnail || thumbnail.isEmpty()) return;

            const cursorPos = screen.getCursorScreenPoint();
            const dataUrl = thumbnail.toJPEG(this.quality).toString('base64');

            const frameData = {
                type: 'screen-frame',
                data: 'data:image/jpeg;base64,' + dataUrl,
                width: this.screenWidth,
                height: this.screenHeight,
                cursorX: cursorPos.x,
                cursorY: cursorPos.y,
                timestamp: Date.now()
            };

            // Broadcast to WebSocket clients
            if (this.wsServer) {
                this.wsServer.broadcast(frameData);
            }

            // Emit locally (for P2P)
            console.log('[ScreenCapturer] Emitting frame event'); // DEBUG
            this.emit('frame', frameData);

        } catch (error) {
            console.error('[ScreenCapturer] Error:', error.message);
        }
    }

    stopStreaming() {
        if (!this.isStreaming) return;

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        this.isStreaming = false;
        console.log('[ScreenCapturer] Stopped');
    }

    setFps(fps) {
        this.fps = Math.max(1, Math.min(30, fps));
        if (this.isStreaming) {
            clearInterval(this.intervalId);
            this.intervalId = setInterval(() => this.captureFrame(), 1000 / this.fps);
        }
    }

    getStatus() {
        return {
            isStreaming: this.isStreaming,
            fps: this.fps,
            quality: this.quality,
            width: this.screenWidth,
            height: this.screenHeight
        };
    }
}

module.exports = ScreenCapturer;
