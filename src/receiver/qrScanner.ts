import { getZXingModule, readBarcodesFromImageData } from 'zxing-wasm/reader';
import { unpackChunk } from '../transmitter/chunker';
import type { FileChunkHeader } from '../transmitter/chunker';
import { saveChunk } from '../db/storage';

export interface ScannedQRInfo {
  header: FileChunkHeader;
  dataBytes: Uint8Array;
  position: {
    topRight: { x: number; y: number };
    topLeft: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
  };
  timestamp: number;
}

export class ScannerEngine {
  private isScanning: boolean = false;
  private videoElement: HTMLVideoElement | null = null;
  private animationFrameId: number | null = null;
  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D | null;

  public onQRsDetected?: (results: ScannedQRInfo[]) => void;

  constructor() {
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
  }

  public async start(
    videoEl: HTMLVideoElement,
    deviceId?: string
  ): Promise<void> {
    this.videoElement = videoEl;
    this.isScanning = true;

    // Pré-carrega o módulo WebAssembly do ZXing para leitura simultânea de múltiplos QR Codes
    await getZXingModule();

    const constraints: MediaStreamConstraints = {
      video: deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.videoElement.srcObject = stream;
    await this.videoElement.play();

    this.scanLoop();
  }

  public stop(): void {
    this.isScanning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.videoElement && this.videoElement.srcObject) {
      const stream = this.videoElement.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      this.videoElement.srcObject = null;
    }
  }

  private scanLoop = async () => {
    if (!this.isScanning || !this.videoElement) return;

    if (this.videoElement.readyState === this.videoElement.HAVE_ENOUGH_DATA && this.offscreenCtx) {
      try {
        const width = this.videoElement.videoWidth;
        const height = this.videoElement.videoHeight;

        if (this.offscreenCanvas.width !== width || this.offscreenCanvas.height !== height) {
          this.offscreenCanvas.width = width;
          this.offscreenCanvas.height = height;
        }

        // Desenha o frame de vídeo no canvas oculto
        this.offscreenCtx.drawImage(this.videoElement, 0, 0, width, height);
        const imageData = this.offscreenCtx.getImageData(0, 0, width, height);

        // Lê MÚLTIPLOS QR Codes SIMULTANEAMENTE via WebAssembly
        const barcodes = await readBarcodesFromImageData(imageData, {
          formats: ['QRCode'],
          tryHarder: true,
          maxNumberOfSymbols: 9 // Lê até 9 QR Codes simultâneos no mesmo frame (grade 3x3 inteira)
        });

        if (barcodes && barcodes.length > 0) {
          const detectedList: ScannedQRInfo[] = [];

          for (const barcode of barcodes) {
            if (!barcode.text) continue;
            const unpacked = unpackChunk(barcode.text);
            if (!unpacked) continue;

            const scannedInfo: ScannedQRInfo = {
              header: unpacked.header,
              dataBytes: unpacked.dataBytes,
              position: barcode.position,
              timestamp: Date.now()
            };

            // Salva no IndexedDB imediatamente
            await saveChunk({
              fileId: unpacked.header.fId,
              chunkIndex: unpacked.header.ci,
              totalChunks: unpacked.header.tc,
              fileName: unpacked.header.fn,
              fileSize: unpacked.header.fs,
              fileType: unpacked.header.ft,
              data: unpacked.dataBytes.buffer as ArrayBuffer
            });

            detectedList.push(scannedInfo);
          }

          if (detectedList.length > 0 && this.onQRsDetected) {
            this.onQRsDetected(detectedList);
          }
        }
      } catch (err) {
        // Ignora erros ocasionais de frame
      }
    }

    // Intervalo suave de captura para alto desempenho sem travar
    setTimeout(() => {
      if (this.isScanning) {
        this.animationFrameId = requestAnimationFrame(this.scanLoop);
      }
    }, 100);
  };
}
