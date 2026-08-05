import type { WorkerInputMessage, WorkerOutputMessage } from './qrScanner.worker';

export class ScannerEngine {
  private isScanning: boolean = false;
  private videoElement: HTMLVideoElement | null = null;
  private animationFrameId: number | null = null;
  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D | null;
  private worker: Worker | null = null;
  private isWorkerProcessingFrame: boolean = false;
  private lastScanTime: number = 0;

  public onDataDecoded?: (results: string[]) => void;

  constructor() {
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
  }

  public async start(
    videoEl: HTMLVideoElement
  ): Promise<void> {
    this.videoElement = videoEl;
    this.isScanning = true;

    // Inicializa o Web Worker dedicado
    this.worker = new Worker(new URL('./qrScanner.worker.ts', import.meta.url), { type: 'module' });

    this.worker.onmessage = async (e: MessageEvent<WorkerOutputMessage>) => {
      const msg = e.data;
      this.isWorkerProcessingFrame = false;

      if (msg.type === 'FRAME_DECODED_DATA' && msg.results.length > 0) {
        if (this.onDataDecoded) {
          this.onDataDecoded(msg.results);
        }
      }
    };

    const constraints: MediaStreamConstraints = {
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } }
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.videoElement.srcObject = stream;
      await this.videoElement.play();
    } catch (_) {
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true });
        this.videoElement.srcObject = fallbackStream;
        await this.videoElement.play();
      } catch (e) {
        console.error("Camera access failed", e);
      }
    }

    this.scanLoop();
  }

  public stop(): void {
    this.isScanning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.videoElement && this.videoElement.srcObject) {
      const stream = this.videoElement.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      this.videoElement.srcObject = null;
    }
  }

  private scanLoop = () => {
    if (!this.isScanning || !this.videoElement || !this.worker) return;

    const now = performance.now();
    if (this.videoElement.readyState >= this.videoElement.HAVE_CURRENT_DATA && this.offscreenCtx && !this.isWorkerProcessingFrame && (now - this.lastScanTime > 30)) {
      this.lastScanTime = now;

      let videoW = this.videoElement.videoWidth;
      let videoH = this.videoElement.videoHeight;
      if (!videoW || !videoH) {
        videoW = 640;
        videoH = 480;
      }

      const maxDim = 800; // Alta resolução para Fountain Codes (até 1500 bytes de carga por frame)
      let targetW = videoW;
      let targetH = videoH;

      if (videoW > maxDim) {
        targetW = maxDim;
        targetH = Math.round((videoH * maxDim) / videoW);
      }

      if (this.offscreenCanvas.width !== targetW || this.offscreenCanvas.height !== targetH) {
        this.offscreenCanvas.width = targetW;
        this.offscreenCanvas.height = targetH;
      }

      this.offscreenCtx.drawImage(this.videoElement, 0, 0, targetW, targetH);
      const imageData = this.offscreenCtx.getImageData(0, 0, targetW, targetH);

      this.isWorkerProcessingFrame = true;
      this.worker.postMessage({
        type: 'PROCESS_FRAME_DATA',
        imageData
      } as WorkerInputMessage);
    }

    if (this.isScanning) {
      this.animationFrameId = requestAnimationFrame(this.scanLoop);
    }
  };
}
