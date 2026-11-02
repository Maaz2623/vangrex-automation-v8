import screenshot from "screenshot-desktop";
import sharp from "sharp";

const WIDTH = 640;
const HEIGHT = 480;

const CAPTURE_INTERVAL_MS = 20_000;
const SEND_INTERVAL_MS = 20_000;

export interface ScreenFrame {
  data: string;
  mimeType: "image/jpeg";
  timestamp: number;
}

export class ScreenCapture {
  private captureTimer?: ReturnType<typeof setInterval>;
  private sendTimer?: ReturnType<typeof setInterval>;

  private latestFrame?: ScreenFrame;
  private capturing = false;
  private running = false;

  async captureFrame(): Promise<ScreenFrame> {
    const original = await screenshot({ format: "jpg" });

    const resized = await sharp(original)
      .resize(WIDTH, HEIGHT, { fit: "fill" })
      .jpeg({ quality: 75 })
      .toBuffer();

    return {
      data: resized.toString("base64"),
      mimeType: "image/jpeg",
      timestamp: Date.now(),
    };
  }

  async start(
    onFrame: (frame: ScreenFrame) => void | Promise<void>,
  ): Promise<void> {
    if (this.running) {
      throw new Error("Screen capture is already running");
    }

    this.running = true;

    console.log(
      `[ScreenCapture] Capturing every ${CAPTURE_INTERVAL_MS / 1000}s`,
    );
    console.log(`[ScreenCapture] Sending every ${SEND_INTERVAL_MS / 1000}s`);

    // Capture immediately, then capture every second.
    const captureLatest = async () => {
      if (!this.running || this.capturing) return;

      this.capturing = true;

      try {
        const frame = await this.captureFrame();

        if (this.running) {
          this.latestFrame = frame;
          console.log("[ScreenCapture] Frame captured");
        }
      } catch (error) {
        console.error("[ScreenCapture] Capture failed:", error);
      } finally {
        this.capturing = false;
      }
    };

    await captureLatest();

    this.captureTimer = setInterval(() => {
      void captureLatest();
    }, CAPTURE_INTERVAL_MS);

    // Send only the latest captured frame every five seconds.
    this.sendTimer = setInterval(() => {
      if (!this.running || !this.latestFrame) return;

      const frame = this.latestFrame;
      this.latestFrame = undefined;

      void Promise.resolve(onFrame(frame)).catch((error) => {
        console.error("[ScreenCapture] Frame send failed:", error);
      });
    }, SEND_INTERVAL_MS);
  }

  stop(): void {
    this.running = false;

    if (this.captureTimer) {
      clearInterval(this.captureTimer);
      this.captureTimer = undefined;
    }

    if (this.sendTimer) {
      clearInterval(this.sendTimer);
      this.sendTimer = undefined;
    }

    this.latestFrame = undefined;

    console.log("[ScreenCapture] Stopped");
  }
}
