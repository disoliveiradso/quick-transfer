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

  public onQRsDetected?: (results: ScannedQRInfo[]) => void;

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
        type: 'SCAN_FRAME',
        imageData,
        maxSymbols: 9
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

      if (msg.type === 'QRS_DETECTED' && msg.results.length > 0) {
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

        if (this.onQRsDetected) {
          this.onQRsDetected(msg.results);
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
      // Fallback para câmera padrão sem resolução ideal caso falhe no dispositivo
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

    if (this.videoElement.readyState >= this.videoElement.HAVE_CURRENT_DATA && this.offscreenCtx) {
      if (!this.isWorkerProcessingFrame) {
        const width = this.videoElement.videoWidth || 640;
        const height = this.videoElement.videoHeight || 480;

        if (this.offscreenCanvas.width !== width || this.offscreenCanvas.height !== height) {
          this.offscreenCanvas.width = width;
          this.offscreenCanvas.height = height;
        }

        this.offscreenCtx.drawImage(this.videoElement, 0, 0, width, height);
        const imageData = this.offscreenCtx.getImageData(0, 0, width, height);

        this.isWorkerProcessingFrame = true;
        this.worker.postMessage({
          type: 'SCAN_FRAME',
          imageData,
          maxSymbols: 9
        } as WorkerInputMessage);
      }
    }

    if (this.isScanning) {
      this.animationFrameId = requestAnimationFrame(this.scanLoop);
    }
  };
}
