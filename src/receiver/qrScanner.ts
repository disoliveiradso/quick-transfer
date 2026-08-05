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
  private mode: 'DATA' | 'ACK' = 'DATA';
  private lastScanTime: number = 0;

  public onDataDecoded?: (results: ScannedQRInfo[]) => void;
  public onAckDecoded?: (ackContent: string) => void;

  constructor() {
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
  }

  public async start(
    videoEl: HTMLVideoElement,
    mode: 'DATA' | 'ACK'
  ): Promise<void> {
    this.videoElement = videoEl;
    this.mode = mode;
    this.isScanning = true;

    // Inicializa o Web Worker dedicado
    this.worker = new Worker(new URL('./qrScanner.worker.ts', import.meta.url), { type: 'module' });

    this.worker.onmessage = async (e: MessageEvent<WorkerOutputMessage>) => {
      const msg = e.data;
      this.isWorkerProcessingFrame = false;

      if (msg.type === 'FRAME_DECODED_DATA' && msg.results.length > 0) {
        // Receptor processou um bloco de dados!
        for (const res of msg.results) {
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
        if (this.onDataDecoded) {
          this.onDataDecoded(msg.results);
        }
      } else if (msg.type === 'FRAME_DECODED_ACK' && msg.ackContent) {
        // Transmissor recebeu o ACK!
        if (this.onAckDecoded) {
          this.onAckDecoded(msg.ackContent);
        }
      }
    };

    // Solicita câmera: receptor usa câmera traseira; transmissor usa câmera frontal por padrão (ou traseira se celular apontado)
    const constraints: MediaStreamConstraints = {
      video: { facingMode: mode === 'DATA' ? 'environment' : 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } }
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
    // 60FPS scan rate = ~16ms. Limit to ~30FPS (33ms) processing max.
    if (this.videoElement.readyState >= this.videoElement.HAVE_CURRENT_DATA && this.offscreenCtx && !this.isWorkerProcessingFrame && (now - this.lastScanTime > 30)) {
      this.lastScanTime = now;

      let videoW = this.videoElement.videoWidth;
      let videoH = this.videoElement.videoHeight;
      if (!videoW || !videoH) {
        videoW = 640;
        videoH = 480;
      }

      // Resize para processamento mais rápido (Handshake é otimizado)
      const maxDim = this.mode === 'ACK' ? 320 : 640; // ACK é super pequeno e fácil de ler, DATA precisa de mais resolução
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
        type: this.mode === 'DATA' ? 'PROCESS_FRAME_DATA' : 'PROCESS_FRAME_ACK',
        imageData
      } as WorkerInputMessage);
    }

    if (this.isScanning) {
      this.animationFrameId = requestAnimationFrame(this.scanLoop);
    }
  };
}
