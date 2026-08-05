import { BrowserMultiFormatReader, Result } from '@zxing/library';
import { unpackChunk } from '../transmitter/chunker';
import type { FileChunkHeader } from '../transmitter/chunker';
import { saveChunk } from '../db/storage';

export interface ScannedQRInfo {
  header: FileChunkHeader;
  dataBytes: Uint8Array;
  points: any[];
  timestamp: number;
}

export class ScannerEngine {
  private reader: BrowserMultiFormatReader;
  private isScanning: boolean = false;
  private videoElement: HTMLVideoElement | null = null;
  private animationFrameId: number | null = null;

  public onQRsDetected?: (results: ScannedQRInfo[]) => void;

  constructor() {
    this.reader = new BrowserMultiFormatReader();
  }

  public async start(
    videoEl: HTMLVideoElement,
    deviceId?: string
  ): Promise<void> {
    this.videoElement = videoEl;
    this.isScanning = true;

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

    if (this.videoElement.readyState === this.videoElement.HAVE_ENOUGH_DATA) {
      try {
        const result = await this.reader.decodeFromVideoElement(this.videoElement);
        if (result) {
          await this.processResult(result);
        }
      } catch (_) {
        // Ignora erros de frame sem QR Code
      }
    }

    this.animationFrameId = requestAnimationFrame(this.scanLoop);
  };

  private async processResult(result: Result) {
    const text = result.getText();
    const unpacked = unpackChunk(text);
    if (!unpacked) return;

    const scannedInfo: ScannedQRInfo = {
      header: unpacked.header,
      dataBytes: unpacked.dataBytes,
      points: result.getResultPoints() || [],
      timestamp: Date.now()
    };

    // Salvar diretamente no IndexedDB para não bloquear o frame rate
    await saveChunk({
      fileId: unpacked.header.fId,
      chunkIndex: unpacked.header.ci,
      totalChunks: unpacked.header.tc,
      fileName: unpacked.header.fn,
      fileSize: unpacked.header.fs,
      fileType: unpacked.header.ft,
      data: unpacked.dataBytes.buffer as ArrayBuffer
    });

    if (this.onQRsDetected) {
      this.onQRsDetected([scannedInfo]);
    }
  }
}
