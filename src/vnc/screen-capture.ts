/**
 * Screen capture manager for VNC functionality
 * Handles serialized frame capture and adaptive quality
 */

import { capturePrimaryScreen, nativeResizeJpeg } from './native-capture';
import crypto from 'crypto';
import { ResizeStrategy } from 'jimp';
import { createImage } from './image-utils';
import { getScreenSize } from './input-handler';
import type { VNCQualitySettings, ScreenDimensions, FrameCallback } from './types';

/**
 * Singleton class that manages screen capture for all connected VNC clients
 * Features:
 * - Immediate encoding, with one capture in flight
 * - Adaptive quality (FPS, JPEG quality, resolution)
 * - Frame hash comparison to skip unchanged frames
 * - Performance monitoring and auto-adjustment
 */
export class ScreenCaptureManager {
  private static instance: ScreenCaptureManager;
  private isCapturing = false;
  private captureInterval: NodeJS.Timeout | null = null;

  // Base configuration with defaults
  private quality: VNCQualitySettings = {
    width: 1440,
    jpegQuality: 85,
    fps: 30,
  };

  // Frame management
  private lastFrameHash: string | null = null;
  private lastFrameSize = 0;

  // Capture cadence
  private readonly MIN_FRAME_INTERVAL = 33;  // ~30fps cap

  // Performance tracking
  private frameProcessingTimes: number[] = [];
  private lastPerformanceCheck = Date.now();
  private droppedFrames = 0;
  private framesSent = 0;

  // Quality control bounds
  private readonly MIN_QUALITY = 55;
  private readonly MAX_QUALITY = 90;
  private readonly MIN_WIDTH = 1024;
  private readonly MAX_WIDTH = 1920;
  private readonly PERFORMANCE_CHECK_INTERVAL = 2000; // ms

  // Subscribers
  private subscribers: FrameCallback[] = [];
  private screenSize: ScreenDimensions;
  private cachedDimensions: ScreenDimensions;

  // Performance monitoring interval
  private performanceMonitorInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.screenSize = getScreenSize();
    this.cachedDimensions = this.getScaledDimensions();
    this.setupPerformanceMonitoring();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): ScreenCaptureManager {
    if (!ScreenCaptureManager.instance) {
      ScreenCaptureManager.instance = new ScreenCaptureManager();
    }
    return ScreenCaptureManager.instance;
  }

  /**
   * Set up performance monitoring interval
   */
  private setupPerformanceMonitoring(): void {
    this.performanceMonitorInterval = setInterval(() => {
      if (!this.isCapturing) return;

      const totalFrames = this.droppedFrames + this.framesSent;
      const dropRate = totalFrames > 0 ? (this.droppedFrames / totalFrames) * 100 : 0;
      const avgFrameSize = this.lastFrameSize / 1024;
      const avgProcessingTime = this.getAverageProcessingTime();

      console.debug(
        `[VNC] Performance: FPS=${this.framesSent}, Dropped=${this.droppedFrames}, ` +
        `Drop Rate=${dropRate.toFixed(1)}%, Size=${avgFrameSize.toFixed(1)}KB, ` +
        `Processing=${avgProcessingTime.toFixed(1)}ms, Quality=${this.quality.jpegQuality}`
      );

      // Reset counters
      this.droppedFrames = 0;
      this.framesSent = 0;
    }, 1000);
  }

  /**
   * Subscribe to frame updates
   * Returns unsubscribe function
   */
  public subscribe(callback: FrameCallback): () => void {
    this.subscribers.push(callback);
    this.lastFrameHash = null;

    if (!this.isCapturing) {
      this.startCaptureLoop();
    }

    return () => {
      this.subscribers = this.subscribers.filter((cb) => cb !== callback);
      if (this.subscribers.length === 0) {
        this.stopCaptureLoop();
      }
    };
  }

  /**
   * Get current subscriber count
   */
  public getSubscriberCount(): number {
    return this.subscribers.length;
  }

  /**
   * Start the capture loop
   */
  private generation = 0;
  private inFlight = false;
  private lastRefresh = 0;

  private startCaptureLoop() {
    if (this.isCapturing) return;
    this.isCapturing = true;
    const generation = ++this.generation;
    const active = () => this.isCapturing && generation === this.generation;
    const captureFrame = async () => {
      if (!active()) return;
      if (this.inFlight) { this.captureInterval = setTimeout(captureFrame, 16); return; }
      this.inFlight = true;
      const started = performance.now();
      try {
        const raw = await capturePrimaryScreen();
        if (!active()) return;
        const hash = crypto.createHash('sha256').update(raw).digest('hex');
        // Periodic refresh allows a slow/new subscriber to recover on an idle desktop.
        if (hash !== this.lastFrameHash || Date.now() - this.lastRefresh >= 1000) {
          const dimensions = { ...this.cachedDimensions };
          const frame = await this.processFrame(raw, dimensions);
          if (!active()) return;
          this.lastFrameHash = hash;
          this.lastRefresh = Date.now();
          this.lastFrameSize = frame.length;
          this.framesSent++;
          this.updatePerformanceMetrics(performance.now() - started);
          for (const subscriber of this.subscribers) {
            try { subscriber(frame, dimensions); } catch { /* A closed client cannot stop capture. */ }
          }
          this.adjustQualityIfNeeded();
        }
      } catch { console.error('Screen capture failed; retrying.'); }
      finally {
        this.inFlight = false;
        if (active()) this.captureInterval = setTimeout(captureFrame,
          Math.max(1, 1000 / this.quality.fps - (performance.now() - started)));
      }
    };
    void captureFrame();
  }

  private async processFrame(frame: Buffer, dimensions: { width: number; height: number }): Promise<Buffer> {
    const nativeFrame = await nativeResizeJpeg(frame, dimensions, this.quality.jpegQuality);
    if (nativeFrame) return nativeFrame;

    const image = await createImage(frame);

    // Resize if needed
    if (image.width !== dimensions.width ||
        image.height !== dimensions.height) {
      const resizeMode = this.isProcessingSlow()
        ? ResizeStrategy.NEAREST_NEIGHBOR  // Faster but lower quality
        : ResizeStrategy.BILINEAR;         // Better quality

      image.resize({
        w: dimensions.width,
        h: dimensions.height,
        mode: resizeMode,
      });
    }

    // Adjust quality based on motion detection
    const quality = this.detectHighMotion()
      ? Math.max(this.MIN_QUALITY, this.quality.jpegQuality - 10)
      : this.quality.jpegQuality;

    return await image.getBuffer('image/jpeg', {
      quality,
    });
  }

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(processingTime: number): void {
    this.frameProcessingTimes.push(processingTime);
    if (this.frameProcessingTimes.length > 30) {
      this.frameProcessingTimes.shift();
    }
  }

  /**
   * Detect high motion based on processing times
   */
  private detectHighMotion(): boolean {
    if (this.frameProcessingTimes.length < 5) return false;
    const recentTimes = this.frameProcessingTimes.slice(-5);
    const avgTime = recentTimes.reduce((a, b) => a + b, 0) / recentTimes.length;
    return avgTime > this.MIN_FRAME_INTERVAL * 0.7;
  }

  /**
   * Check if processing is slow
   */
  private isProcessingSlow(): boolean {
    const avgTime = this.getAverageProcessingTime();
    return avgTime > this.MIN_FRAME_INTERVAL * 0.8;
  }

  /**
   * Get average processing time
   */
  private getAverageProcessingTime(): number {
    if (this.frameProcessingTimes.length === 0) return 0;
    return (
      this.frameProcessingTimes.reduce((a, b) => a + b, 0) /
      this.frameProcessingTimes.length
    );
  }

  /**
   * Adjust quality settings based on performance
   */
  private adjustQualityIfNeeded(): void {
    const now = Date.now();
    if (now - this.lastPerformanceCheck < this.PERFORMANCE_CHECK_INTERVAL) return;

    const avgProcessingTime = this.getAverageProcessingTime();
    const totalFrames = this.droppedFrames + this.framesSent;
    const dropRate = totalFrames > 0 ? this.droppedFrames / totalFrames : 0;

    if (dropRate > 0.2 || avgProcessingTime > this.MIN_FRAME_INTERVAL) {
      // Reduce quality more aggressively when dropping frames
      this.quality.jpegQuality = Math.max(
        this.MIN_QUALITY,
        this.quality.jpegQuality - 5
      );
      this.quality.width = Math.max(
        this.MIN_WIDTH,
        this.quality.width - 128
      );
      this.cachedDimensions = this.getScaledDimensions();
    } else if (dropRate < 0.05 && avgProcessingTime < this.MIN_FRAME_INTERVAL * 0.5) {
      // Gradually improve quality when performance is good
      this.quality.jpegQuality = Math.min(
        this.MAX_QUALITY,
        this.quality.jpegQuality + 1
      );
      this.quality.width = Math.min(
        this.MAX_WIDTH,
        this.quality.width + 64
      );
      this.cachedDimensions = this.getScaledDimensions();
    }

    this.lastPerformanceCheck = now;
  }

  /**
   * Calculate scaled dimensions maintaining aspect ratio
   */
  private getScaledDimensions(): ScreenDimensions {
    const width = Math.min(this.quality.width, this.screenSize.width);
    const { width: realWidth, height: realHeight } = this.screenSize;
    const height = Math.floor(width * (realHeight / realWidth));
    return { width, height };
  }

  /**
   * Update quality settings from client
   */
  public updateQualitySettings(settings: Partial<VNCQualitySettings>): void {
    let changed = false;

    if (settings.width !== undefined &&
        settings.width >= this.MIN_WIDTH &&
        settings.width <= this.MAX_WIDTH &&
        settings.width !== this.quality.width) {
      this.quality.width = settings.width;
      this.cachedDimensions = this.getScaledDimensions();
      changed = true;
    }

    if (settings.jpegQuality !== undefined &&
        settings.jpegQuality >= this.MIN_QUALITY &&
        settings.jpegQuality <= this.MAX_QUALITY &&
        settings.jpegQuality !== this.quality.jpegQuality) {
      this.quality.jpegQuality = settings.jpegQuality;
      changed = true;
    }

    if (settings.fps !== undefined &&
        settings.fps >= 1 &&
        settings.fps <= 60 &&
        settings.fps !== this.quality.fps) {
      this.quality.fps = settings.fps;
      changed = true;
    }

    if (changed) {
        this.lastFrameHash = null;
      this.resetPerformanceMetrics();
    }
  }

  /**
   * Reset performance metrics
   */
  private resetPerformanceMetrics(): void {
    this.frameProcessingTimes = [];
    this.lastPerformanceCheck = Date.now();
    this.droppedFrames = 0;
    this.framesSent = 0;
  }

  /**
   * Stop the capture loop
   */
  private stopCaptureLoop(): void {
    this.generation++;
    console.log('[VNC] Stopping screen capture loop');

    if (this.captureInterval) {
      clearTimeout(this.captureInterval);
      this.captureInterval = null;
    }
    this.isCapturing = false;
    this.lastFrameHash = null;
    this.resetPerformanceMetrics();
  }

  /**
   * Get current quality settings
   */
  public getQualitySettings(): VNCQualitySettings {
    return { ...this.quality };
  }

  /**
   * Get current screen dimensions
   */
  public getScreenDimensions(): ScreenDimensions {
    return { ...this.cachedDimensions };
  }

  /**
   * Check if capture is active
   */
  public isActive(): boolean {
    return this.isCapturing;
  }

  /**
   * Shutdown the capture manager
   */
  public shutdown(): void {
    this.stopCaptureLoop();
    if (this.performanceMonitorInterval) {
      clearInterval(this.performanceMonitorInterval);
      this.performanceMonitorInterval = null;
    }
    this.subscribers = [];
  }
}

export default ScreenCaptureManager;
