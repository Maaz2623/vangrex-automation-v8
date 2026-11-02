/**
 * MediaHandler: Manages audio/video capture and playback.
 *
 * Browser environment required.
 * Make sure pcm-processor.js is available at /static/pcm-processor.js.
 */

type AudioDataCallback = (pcm16: ArrayBuffer) => void;
type VideoFrameCallback = (base64: string) => void;
type VideoEndedCallback = () => void;

class MediaHandler {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private audioWorkletNode: AudioWorkletNode | null = null;
  private audioSource: MediaStreamAudioSourceNode | null = null;
  private muteGain: GainNode | null = null;

  private videoStream: MediaStream | null = null;
  private videoInterval: ReturnType<typeof setInterval> | null = null;

  private nextStartTime = 0;
  private scheduledSources: AudioBufferSourceNode[] = [];
  private isRecording = false;

  private readonly videoCanvas: HTMLCanvasElement;
  private readonly canvasCtx: CanvasRenderingContext2D;

  constructor() {
    this.videoCanvas = document.createElement("canvas");

    const context = this.videoCanvas.getContext("2d");

    if (!context) {
      throw new Error("Failed to create canvas 2D context.");
    }

    this.canvasCtx = context;
  }

  // --------------------------------------------------
  // AUDIO INITIALIZATION
  // --------------------------------------------------

  async initializeAudio(): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();

      await this.audioContext.audioWorklet.addModule(
        "/static/pcm-processor.js",
      );
    }

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  // --------------------------------------------------
  // START MICROPHONE CAPTURE
  // --------------------------------------------------

  async startAudio(onAudioData: AudioDataCallback): Promise<void> {
    await this.initializeAudio();

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      const audioContext = this.audioContext;

      if (!audioContext) {
        throw new Error("AudioContext is not initialized.");
      }

      this.audioSource = audioContext.createMediaStreamSource(this.mediaStream);

      this.audioWorkletNode = new AudioWorkletNode(
        audioContext,
        "pcm-processor",
      );

      this.audioWorkletNode.port.onmessage = (
        event: MessageEvent<Float32Array | ArrayBuffer>,
      ): void => {
        if (!this.isRecording) {
          return;
        }

        const input =
          event.data instanceof Float32Array
            ? event.data
            : new Float32Array(event.data);

        const downsampled = this.downsampleBuffer(
          input,
          audioContext.sampleRate,
          16000,
        );

        const pcm16 = this.convertFloat32ToInt16(downsampled);

        onAudioData(pcm16);
      };

      this.audioSource.connect(this.audioWorkletNode);

      // Prevent microphone monitoring and audio feedback.
      this.muteGain = audioContext.createGain();
      this.muteGain.gain.value = 0;

      this.audioWorkletNode.connect(this.muteGain);
      this.muteGain.connect(audioContext.destination);

      this.isRecording = true;
    } catch (error: unknown) {
      console.error("Error starting audio:", error);

      this.stopAudio();

      throw error;
    }
  }

  // --------------------------------------------------
  // STOP MICROPHONE CAPTURE
  // --------------------------------------------------

  stopAudio(): void {
    this.isRecording = false;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => {
        track.stop();
      });

      this.mediaStream = null;
    }

    if (this.audioSource) {
      this.audioSource.disconnect();
      this.audioSource = null;
    }

    if (this.audioWorkletNode) {
      this.audioWorkletNode.port.onmessage = null;
      this.audioWorkletNode.disconnect();
      this.audioWorkletNode = null;
    }

    if (this.muteGain) {
      this.muteGain.disconnect();
      this.muteGain = null;
    }
  }

  // --------------------------------------------------
  // START CAMERA
  // --------------------------------------------------

  async startVideo(
    videoElement: HTMLVideoElement,
    onFrame: VideoFrameCallback,
  ): Promise<void> {
    try {
      this.videoStream = await navigator.mediaDevices.getUserMedia({
        video: true,
      });

      videoElement.srcObject = this.videoStream;

      await videoElement.play();

      this.startFrameCapture(videoElement, onFrame);
    } catch (error: unknown) {
      console.error("Error starting video:", error);

      this.stopVideo(videoElement);

      throw error;
    }
  }

  // --------------------------------------------------
  // START SCREEN SHARING
  // --------------------------------------------------

  async startScreen(
    videoElement: HTMLVideoElement,
    onFrame: VideoFrameCallback,
    onEnded?: VideoEndedCallback,
  ): Promise<void> {
    try {
      this.videoStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });

      videoElement.srcObject = this.videoStream;

      const videoTrack = this.videoStream.getVideoTracks()[0];

      if (videoTrack) {
        videoTrack.onended = (): void => {
          this.stopVideo(videoElement);
          onEnded?.();
        };
      }

      await videoElement.play();

      this.startFrameCapture(videoElement, onFrame);
    } catch (error: unknown) {
      console.error("Error starting screen share:", error);

      this.stopVideo(videoElement);

      throw error;
    }
  }

  // --------------------------------------------------
  // FRAME CAPTURE
  // --------------------------------------------------

  private startFrameCapture(
    videoElement: HTMLVideoElement,
    onFrame: VideoFrameCallback,
  ): void {
    // Avoid duplicate capture intervals.
    if (this.videoInterval !== null) {
      clearInterval(this.videoInterval);
    }

    // Capture one frame per second.
    this.videoInterval = setInterval((): void => {
      this.captureFrame(videoElement, onFrame);
    }, 1000);
  }

  captureFrame(
    videoElement: HTMLVideoElement,
    onFrame: VideoFrameCallback,
  ): void {
    if (!this.videoStream) {
      return;
    }

    if (videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }

    const width = videoElement.videoWidth;
    const height = videoElement.videoHeight;

    if (width === 0 || height === 0) {
      return;
    }

    // Preserve the original aspect ratio.
    const targetWidth = 640;
    const targetHeight = Math.round((height / width) * targetWidth);

    this.videoCanvas.width = targetWidth;
    this.videoCanvas.height = targetHeight;

    this.canvasCtx.drawImage(videoElement, 0, 0, targetWidth, targetHeight);

    const base64 = this.videoCanvas.toDataURL("image/jpeg", 0.7).split(",")[1];

    if (base64) {
      onFrame(base64);
    }
  }

  // --------------------------------------------------
  // STOP CAMERA / SCREEN SHARING
  // --------------------------------------------------

  stopVideo(videoElement?: HTMLVideoElement): void {
    if (this.videoInterval !== null) {
      clearInterval(this.videoInterval);
      this.videoInterval = null;
    }

    if (this.videoStream) {
      this.videoStream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });

      this.videoStream = null;
    }

    if (videoElement) {
      videoElement.pause();
      videoElement.srcObject = null;
    }
  }

  // --------------------------------------------------
  // PLAY PCM AUDIO
  // --------------------------------------------------

  playAudio(arrayBuffer: ArrayBuffer): void {
    const audioContext = this.audioContext;

    if (!audioContext || arrayBuffer.byteLength < 2) {
      return;
    }

    if (audioContext.state === "suspended") {
      void audioContext.resume();
    }

    // PCM signed 16-bit little-endian samples.
    const pcmData = new Int16Array(arrayBuffer);

    const float32Data = new Float32Array(pcmData.length);

    for (let i = 0; i < pcmData.length; i++) {
      float32Data[i] = pcmData[i]! / 32768;
    }

    // Assumes the incoming PCM audio is 24 kHz, mono.
    const sampleRate = 24000;

    const buffer = audioContext.createBuffer(1, float32Data.length, sampleRate);

    buffer.getChannelData(0).set(float32Data);

    const source = audioContext.createBufferSource();

    source.buffer = buffer;
    source.connect(audioContext.destination);

    const now = audioContext.currentTime;

    this.nextStartTime = Math.max(now, this.nextStartTime);

    source.start(this.nextStartTime);

    this.nextStartTime += buffer.duration;

    this.scheduledSources.push(source);

    source.onended = (): void => {
      const index = this.scheduledSources.indexOf(source);

      if (index !== -1) {
        this.scheduledSources.splice(index, 1);
      }

      source.disconnect();
    };
  }

  // --------------------------------------------------
  // STOP AUDIO PLAYBACK
  // --------------------------------------------------

  stopAudioPlayback(): void {
    for (const source of this.scheduledSources) {
      try {
        source.stop();
      } catch {
        // The source may already have stopped.
      }
    }

    this.scheduledSources = [];

    if (this.audioContext) {
      this.nextStartTime = this.audioContext.currentTime;
    }
  }

  // --------------------------------------------------
  // DOWNSAMPLE AUDIO
  // --------------------------------------------------

  downsampleBuffer(
    buffer: Float32Array,
    sampleRate: number,
    outSampleRate: number,
  ): Float32Array {
    if (outSampleRate === sampleRate) {
      return buffer;
    }

    if (outSampleRate > sampleRate) {
      throw new Error("Output sample rate must not exceed input sample rate.");
    }

    const ratio = sampleRate / outSampleRate;

    const newLength = Math.round(buffer.length / ratio);

    const result = new Float32Array(newLength);

    let offsetBuffer = 0;

    for (let offsetResult = 0; offsetResult < newLength; offsetResult++) {
      const nextOffsetBuffer = Math.min(
        Math.round((offsetResult + 1) * ratio),
        buffer.length,
      );

      let accum = 0;
      let count = 0;

      for (let i = offsetBuffer; i < nextOffsetBuffer; i++) {
        accum += buffer[i]!;
        count++;
      }

      result[offsetResult] = count > 0 ? accum / count : 0;

      offsetBuffer = nextOffsetBuffer;
    }

    return result;
  }

  // --------------------------------------------------
  // FLOAT32 TO PCM16
  // --------------------------------------------------

  convertFloat32ToInt16(buffer: Float32Array): ArrayBuffer {
    const result = new Int16Array(buffer.length);

    for (let i = 0; i < buffer.length; i++) {
      const sample = Math.max(-1, Math.min(1, buffer[i]!));

      result[i] =
        sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
    }

    return result.buffer as ArrayBuffer;
  }

  // --------------------------------------------------
  // CLEANUP
  // --------------------------------------------------

  async dispose(): Promise<void> {
    this.stopAudio();
    this.stopAudioPlayback();
    this.stopVideo();

    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }

    this.nextStartTime = 0;
  }
}

export default MediaHandler;
