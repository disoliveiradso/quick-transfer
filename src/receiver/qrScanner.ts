import { saveChunk } from '../db/storage';
import type { ScannedQRInfo, WorkerInputMessage, WorkerOutputMessage } from './qrScanner.worker';

export type { ScannedQRInfo };

export class ScannerEngine {
  private isScanning: boolean = false;
  private videoElement: HTMLVideoElement | null = null;
  private animationFrameId: number | null = null;
  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D | null;
  private worker: Worker | null = null;
  private isWorkerProcessingFrame: boolean = false;
  private lastScanTime: number = 0;

  public onMultiQrAutoTrigger?: () => void;
  public onSnapshotDecoded?: (results: ScannedQRInfo[]) => void;

  constructor() {
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
  }

  public captureSnapshot(snapshotCanvas: HTMLCanvasElement): ImageData | null {
    if (!this.videoElement || this.videoElement.readyState < this.videoElement.HAVE_CURRENT_DATA || !this.offscreenCtx) {
      return null;
    }

    const width = this.videoElement.videoWidth || 640;
    const height = this.videoElement.videoHeight || 480;

    snapshotCanvas.width = width;
    snapshotCanvas.height = height;

    const snapCtx = snapshotCanvas.getContext('2d');
    if (snapCtx) {
      snapCtx.drawImage(this.videoElement, 0, 0, width, height);
    }

    if (this.offscreenCanvas.width !== width || this.offscreenCanvas.height !== height) {
      this.offscreenCanvas.width = width;
      this.offscreenCanvas.height = height;
    }

    this.offscreenCtx.drawImage(this.videoElement, 0, 0, width, height);
    return this.offscreenCtx.getImageData(0, 0, width, height);
  }

  public processSnapshotImageData(imageData: ImageData) {
    if (this.worker) {
      this.isWorkerProcessingFrame = true;
      this.worker.postMessage({
        type: 'DECODE_SNAPSHOT',
        imageData
      } as WorkerInputMessage);
    }
  }

  public async start(
    videoEl: HTMLVideoElement,
    deviceId?: string
  ): Promise<void> {
    this.videoElement = videoEl;
    this.isScanning = true;

    // Inicializa o Web Worker dedicado
    this.worker = new Worker(new URL('./qrScanner.worker.ts', import.meta.url), { type: 'module' });

    this.worker.onmessage = async (e: MessageEvent<WorkerOutputMessage>) => {
      const msg = e.data;
      this.isWorkerProcessingFrame = false;

      if (msg.type === 'MULTI_QR_DETECTED_AUTO_TRIGGER') {
        if (this.onMultiQrAutoTrigger) {
          this.onMultiQrAutoTrigger();
        }
      } else if (msg.type === 'SNAPSHOT_DECODED' && msg.results.length > 0) {
        for (const res of msg.results) {
          // Salva no IndexedDB
          await saveChunk({
            fileId: res.header.fId,
            chunkIndex: res.header.ci,
            totalChunks: res.header.tc,
            fileName: res.header.fn,
            fileSize: res.header.fs,
            fileType: res.header.ft,
            data: res.dataBytes.buffer as ArrayBuffer
          });
        }

        if (this.onSnapshotDecoded) {
          this.onSnapshotDecoded(msg.results);
        }
      }
    };

    // Solicita câmera
    const constraints: MediaStreamConstraints = {
      video: deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.videoElement.srcObject = stream;
      await this.videoElement.play();
    } catch (_) {
      const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      this.videoElement.srcObject = fallbackStream;
      await this.videoElement.play();
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

    if (this.videoElement.readyState >= this.videoElement.HAVE_CURRENT_DATA && this.offscreenCtx) {
      // Detecção ultraleve a cada 300ms exclusivamente para disparar o auto-snapshot quando focado
      if (!this.isWorkerProcessingFrame && now - this.lastScanTime >= 300) {
        this.lastScanTime = now;

        const videoW = this.videoElement.videoWidth || 640;
        const videoH = this.videoElement.videoHeight || 480;

        // Subamostragem super leve (max 480px) para zero impacto de performance no vídeo ao vivo
        const maxDim = 480;
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
          type: 'DETECT_MULTI',
          imageData
        } as WorkerInputMessage);
      }
    }

    if (this.isScanning) {
      this.animationFrameId = requestAnimationFrame(this.scanLoop);
    }
  };
}
