import { unpackChunkString } from '../transmitter/chunker';
import type { FileChunkHeader } from '../transmitter/chunker';

export interface ScannedQRInfo {
  header: FileChunkHeader;
  dataBytes: Uint8Array;
}

export type WorkerInputMessage = {
  type: 'PROCESS_FRAME_DATA';
  imageData: ImageData;
} | {
  type: 'PROCESS_FRAME_ACK';
  imageData: ImageData;
};

export type WorkerOutputMessage = {
  type: 'FRAME_DECODED_DATA';
  results: ScannedQRInfo[];
} | {
  type: 'FRAME_DECODED_ACK';
  ackContent: string | null;
} | {
  type: 'IDLE_DONE';
};

self.onmessage = async (e: MessageEvent<WorkerInputMessage>) => {
  const msg = e.data;

  if (msg.type === 'PROCESS_FRAME_DATA') {
    try {
      const { readBarcodesFromImageData } = await import('zxing-wasm/reader');
      const wasmResults = await readBarcodesFromImageData(msg.imageData, {
        formats: ['QRCode'],
        tryHarder: false, // Otimizado para velocidade
        maxNumberOfSymbols: 1 // Somente 1 QR por frame agora!
      });

      if (wasmResults && wasmResults.length > 0) {
        const detectedList: ScannedQRInfo[] = [];

        for (const barcode of wasmResults) {
          let textData = barcode.text || '';
          if (!textData && barcode.bytes && barcode.bytes.length > 0) {
            try {
              textData = new TextDecoder('utf-8').decode(barcode.bytes);
            } catch (_) {}
          }

          if (!textData) continue;

          const unpacked = unpackChunkString(textData);
          if (!unpacked) continue;

          detectedList.push({
            header: unpacked.header,
            dataBytes: unpacked.dataBytes
          });
        }

        if (detectedList.length > 0) {
          self.postMessage({
            type: 'FRAME_DECODED_DATA',
            results: detectedList
          } as WorkerOutputMessage);
          return;
        }
      }
    } catch (err) {}

    self.postMessage({ type: 'IDLE_DONE' } as WorkerOutputMessage);
    return;
  }

  if (msg.type === 'PROCESS_FRAME_ACK') {
    try {
      let ackContent: string | null = null;

      // 1. Prioriza BarcodeDetector para ACK por ser string simples e ultrarrápido
      if ('BarcodeDetector' in self) {
        try {
          const detector = new (self as unknown as { BarcodeDetector: new (opts: { formats: string[] }) => { detect: (data: ImageData) => Promise<Array<{ rawValue: string }>> } })
            .BarcodeDetector({ formats: ['qr_code'] });
          const nativeResults = await detector.detect(msg.imageData);
          if (nativeResults && nativeResults.length > 0) {
            ackContent = nativeResults[0].rawValue;
          }
        } catch (_) {}
      }

      // 2. Fallback para zxing se falhar
      if (!ackContent) {
        try {
          const { readBarcodesFromImageData } = await import('zxing-wasm/reader');
          const wasmResults = await readBarcodesFromImageData(msg.imageData, {
            formats: ['QRCode'],
            tryHarder: false,
            maxNumberOfSymbols: 1
          });
          if (wasmResults && wasmResults.length > 0) {
            ackContent = wasmResults[0].text;
          }
        } catch (_) {}
      }

      if (ackContent && ackContent.startsWith('ACK:')) {
        self.postMessage({
          type: 'FRAME_DECODED_ACK',
          ackContent
        } as WorkerOutputMessage);
        return;
      }
    } catch (_) {}

    self.postMessage({ type: 'IDLE_DONE' } as WorkerOutputMessage);
  }
};
