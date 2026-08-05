import { getZXingModule, readBarcodesFromImageData } from 'zxing-wasm/reader';
import { unpackBinaryChunk } from '../transmitter/chunker';
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

// Mensagens trocadas com a Thread Principal
export type WorkerInputMessage = {
  type: 'INIT';
} | {
  type: 'SCAN_FRAME';
  imageData: ImageData;
  maxSymbols: number;
};

export type WorkerOutputMessage = {
  type: 'INIT_DONE';
} | {
  type: 'QRS_DETECTED';
  results: ScannedQRInfo[];
} | {
  type: 'ERROR';
  error: string;
};

let isWasmReady = false;

self.onmessage = async (e: MessageEvent<WorkerInputMessage>) => {
  const msg = e.data;

  if (msg.type === 'INIT') {
    try {
      await getZXingModule();
      isWasmReady = true;
      self.postMessage({ type: 'INIT_DONE' } as WorkerOutputMessage);
    } catch (err: unknown) {
      self.postMessage({ type: 'ERROR', error: String(err) } as WorkerOutputMessage);
    }
    return;
  }

  if (msg.type === 'SCAN_FRAME') {
    if (!isWasmReady) return;

    try {
      // Tenta decodificar usando BarcodeDetector nativo com aceleração por hardware se disponível na Worker Thread
      let barcodes: Array<{ text?: string; bytes?: Uint8Array; position: ScannedQRInfo['position'] }> = [];

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
        } catch (_) {
          // Fallback para zxing-wasm
        }
      }

      // Se a API nativa não retornou barcodes ou não está disponível, utiliza zxing-wasm
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
          const dataToUnpack = barcode.bytes && barcode.bytes.length > 0 ? barcode.bytes : (barcode.text || '');
          if (!dataToUnpack) continue;

          const unpacked = unpackBinaryChunk(dataToUnpack);
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
        }
      }
    } catch (_) {
      // Ignora erros ocasionais em frames sem QR Code
    }
  }
};
