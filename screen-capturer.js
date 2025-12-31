/**
 * Screen Capturer - Simple 5 FPS JPEG streaming
 */

const { desktopCapturer, screen } = require('electron');

class ScreenCapturer {
    constructor(wsServer) {
        this.wsServer = wsServer;
        this.isStreaming = false;
        this.intervalId = null;
        this.fps = 5;
        this.quality = 60;
        this.screenWidth = 0;
        this.screenHeight = 0;
    }

    async startStreaming() {
        if (this.isStreaming) return;

        const primaryDisplay = screen.getPrimaryDisplay();
        this.screenWidth = primaryDisplay.size.width;
        this.screenHeight = primaryDisplay.size.height;

        console.log('[ScreenCapturer] Starting at', this.fps, 'FPS,',
            this.screenWidth, 'x', this.screenHeight);

        this.isStreaming = true;
        this.intervalId = setInterval(() => this.captureFrame(), 1000 / this.fps);
    }

    async captureFrame() {
        if (!this.isStreaming) return;

        try {
            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: { width: this.screenWidth, height: this.screenHeight }
            });

            if (sources.length === 0) return;

            const thumbnail = sources[0].thumbnail;
            if (!thumbnail || thumbnail.isEmpty()) return;

            const cursorPos = screen.getCursorScreenPoint();
            const dataUrl = thumbnail.toJPEG(this.quality).toString('base64');

            if (this.wsServer) {
                this.wsServer.broadcast({
                    type: 'screen-frame',
                    data: 'data:image/jpeg;base64,' + dataUrl,
                    width: this.screenWidth,
                    height: this.screenHeight,
                    cursorX: cursorPos.x,
                    cursorY: cursorPos.y,
                    timestamp: Date.now()
                });
            }
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
