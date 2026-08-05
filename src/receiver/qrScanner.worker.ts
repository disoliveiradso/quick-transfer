import { readBarcodesFromImageData } from 'zxing-wasm/reader';
import { unpackChunkString } from '../transmitter/chunker';
import type { FileChunkHeader } from '../transmitter/chunker';

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

export type WorkerInputMessage = {
  type: 'SCAN_FRAME';
  imageData: ImageData;
  maxSymbols: number;
};

export type WorkerOutputMessage = {
  type: 'QRS_DETECTED';
  results: ScannedQRInfo[];
} | {
  type: 'DONE_SCANNING';
};

self.onmessage = async (e: MessageEvent<WorkerInputMessage>) => {
  const msg = e.data;

  if (msg.type === 'SCAN_FRAME') {
    try {
      let barcodes: Array<{ text?: string; bytes?: Uint8Array; position: ScannedQRInfo['position'] }> = [];

      // 1. Tenta API Nativa BarcodeDetector se disponível
      if ('BarcodeDetector' in self) {
        try {
          const detector = new (self as unknown as { BarcodeDetector: new (opts: { formats: string[] }) => { detect: (data: ImageData) => Promise<Array<{ rawValue: string; cornerPoints: Array<{ x: number; y: number }> }>> } })
            .BarcodeDetector({ formats: ['qr_code'] });
          
          const nativeResults = await detector.detect(msg.imageData);
          if (nativeResults && nativeResults.length > 0) {
            barcodes = nativeResults.map(r => ({
              text: r.rawValue,
              position: {
                topLeft: r.cornerPoints[0] || { x: 0, y: 0 },
                topRight: r.cornerPoints[1] || { x: 0, y: 0 },
                bottomRight: r.cornerPoints[2] || { x: 0, y: 0 },
                bottomLeft: r.cornerPoints[3] || { x: 0, y: 0 }
              }
            }));
          }
        } catch (_) {}
      }

      // 2. Fallback / Complemento ZXing-WASM
      if (barcodes.length === 0) {
        const wasmResults = await readBarcodesFromImageData(msg.imageData, {
          formats: ['QRCode'],
          tryHarder: true,
          maxNumberOfSymbols: msg.maxSymbols || 9
        });
        if (wasmResults) {
          barcodes = wasmResults.map(b => ({
            text: b.text,
            bytes: b.bytes,
            position: b.position
          }));
        }
      }

      if (barcodes && barcodes.length > 0) {
        const detectedList: ScannedQRInfo[] = [];

        for (const barcode of barcodes) {
          let textData = barcode.text || '';
          if (!textData && barcode.bytes && barcode.bytes.length > 0) {
            try {
              const textDecoder = new TextDecoder('utf-8');
              textData = textDecoder.decode(barcode.bytes);
            } catch (_) {}
          }

          if (!textData) continue;

          const unpacked = unpackChunkString(textData);
          if (!unpacked) continue;

          detectedList.push({
            header: unpacked.header,
            dataBytes: unpacked.dataBytes,
            position: barcode.position,
            timestamp: Date.now()
          });
        }

        if (detectedList.length > 0) {
          self.postMessage({
            type: 'QRS_DETECTED',
            results: detectedList
          } as WorkerOutputMessage);
          return;
        }
      }
    } catch (err) {
      // Catch e continua
    }

    self.postMessage({ type: 'DONE_SCANNING' } as WorkerOutputMessage);
  }
};
