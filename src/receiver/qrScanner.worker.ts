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
  type: 'DETECT_MULTI';
  imageData: ImageData;
} | {
  type: 'DECODE_SNAPSHOT';
  imageData: ImageData;
};

export type WorkerOutputMessage = {
  type: 'MULTI_QR_DETECTED_AUTO_TRIGGER';
  count: number;
} | {
  type: 'SNAPSHOT_DECODED';
  results: ScannedQRInfo[];
} | {
  type: 'IDLE_DONE';
};

/**
 * Calcula a variância do Laplaciano para medir o nível de nitidez (foco) da imagem.
 * Imagens desfocadas/borradas possuem variância baixa (< 80).
 * Imagens nítidas/focadas possuem variância alta (> 150).
 */
function computeBlurSharpnessScore(imageData: ImageData): number {
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;

  // Converte para escala de cinza em sub-amostragem (stride 2) para ultra performance
  const grayWidth = Math.floor(width / 2);
  const grayHeight = Math.floor(height / 2);
  const gray = new Float32Array(grayWidth * grayHeight);

  for (let y = 0; y < grayHeight; y++) {
    for (let x = 0; x < grayWidth; x++) {
      const srcIdx = ((y * 2) * width + (x * 2)) * 4;
      gray[y * grayWidth + x] = 0.299 * data[srcIdx] + 0.587 * data[srcIdx + 1] + 0.114 * data[srcIdx + 2];
    }
  }

  // Kernel Laplaciano [0, 1, 0; 1, -4, 1; 0, 1, 0]
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < grayHeight - 1; y++) {
    for (let x = 1; x < grayWidth - 1; x++) {
      const idx = y * grayWidth + x;
      const lap = gray[idx - grayWidth] + gray[idx + grayWidth] + gray[idx - 1] + gray[idx + 1] - 4 * gray[idx];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  const variance = (sumSq / count) - (mean * mean);
  return variance;
}

self.onmessage = async (e: MessageEvent<WorkerInputMessage>) => {
  const msg = e.data;

  // MODO 1: Detecção Rápida Light em tempo real para disparo automático de captura quando focado
  if (msg.type === 'DETECT_MULTI') {
    try {
      let qrCount = 0;

      // 1. Tenta API Nativa BarcodeDetector ultrarrápida
      if ('BarcodeDetector' in self) {
        try {
          const detector = new (self as unknown as { BarcodeDetector: new (opts: { formats: string[] }) => { detect: (data: ImageData) => Promise<Array<{ rawValue: string }>> } })
            .BarcodeDetector({ formats: ['qr_code'] });
          const nativeResults = await detector.detect(msg.imageData);
          if (nativeResults) {
            qrCount = nativeResults.length;
          }
        } catch (_) {}
      }

      // 2. Fallback para zxing-wasm leve se BarcodeDetector falhar ou não achar nada
      if (qrCount === 0) {
        try {
          const { readBarcodesFromImageData } = await import('zxing-wasm/reader');
          const wasmResults = await readBarcodesFromImageData(msg.imageData, {
            formats: ['QRCode'],
            tryHarder: false, // modo rápido
            maxNumberOfSymbols: 4
          });
          if (wasmResults) {
            qrCount = wasmResults.length;
          }
        } catch (_) {}
      }

      // Se detectou mais de 1 QR Code na visão ao vivo
      if (qrCount > 1) {
        // Verifica a nitidez/foco da imagem usando variância Laplaciana
        const sharpness = computeBlurSharpnessScore(msg.imageData);

        // Se a nitidez estiver razoável (> 30 indica imagem não totalmente borrada)
        if (sharpness > 30) {
          self.postMessage({
            type: 'MULTI_QR_DETECTED_AUTO_TRIGGER',
            count: qrCount
          } as WorkerOutputMessage);
          return;
        }
      }
    } catch (_) {}

    self.postMessage({ type: 'IDLE_DONE' } as WorkerOutputMessage);
    return;
  }

  // MODO 2: Decodificação Profunda da Foto Estática Capturada (Roda APENAS na foto congelada sem pesar no vídeo ao vivo!)
  if (msg.type === 'DECODE_SNAPSHOT') {
    try {
      const { readBarcodesFromImageData } = await import('zxing-wasm/reader');
      const wasmResults = await readBarcodesFromImageData(msg.imageData, {
        formats: ['QRCode'],
        tryHarder: true,
        maxNumberOfSymbols: 9
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
            dataBytes: unpacked.dataBytes,
            position: barcode.position,
            timestamp: Date.now()
          });
        }

        if (detectedList.length > 0) {
          self.postMessage({
            type: 'SNAPSHOT_DECODED',
            results: detectedList
          } as WorkerOutputMessage);
          return;
        }
      }
    } catch (err) {}

    self.postMessage({ type: 'IDLE_DONE' } as WorkerOutputMessage);
  }
};
