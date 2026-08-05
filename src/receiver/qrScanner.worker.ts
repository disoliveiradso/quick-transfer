export type WorkerInputMessage = {
  type: 'PROCESS_FRAME_DATA';
  imageData: ImageData;
};

export type WorkerOutputMessage = {
  type: 'FRAME_DECODED_DATA';
  results: string[];
} | {
  type: 'IDLE_DONE';
};

self.onmessage = async (e: MessageEvent<WorkerInputMessage>) => {
  const msg = e.data;

  if (msg.type === 'PROCESS_FRAME_DATA') {
    try {
      // 1. Prioriza BarcodeDetector para ser ultrarrápido
      if ('BarcodeDetector' in self) {
        try {
          const detector = new (self as unknown as { BarcodeDetector: new (opts: { formats: string[] }) => { detect: (data: ImageData) => Promise<Array<{ rawValue: string }>> } })
            .BarcodeDetector({ formats: ['qr_code'] });
          const nativeResults = await detector.detect(msg.imageData);
          if (nativeResults && nativeResults.length > 0) {
            const results = nativeResults.map(r => r.rawValue);
            self.postMessage({
              type: 'FRAME_DECODED_DATA',
              results
            } as WorkerOutputMessage);
            return;
          }
        } catch (_) {}
      }

      // 2. Fallback para zxing se não tiver BarcodeDetector ou falhar
      const { readBarcodesFromImageData } = await import('zxing-wasm/reader');
      const wasmResults = await readBarcodesFromImageData(msg.imageData, {
        formats: ['QRCode'],
        tryHarder: false, // Otimizado para velocidade
        maxNumberOfSymbols: 1 // Somente 1 QR por frame agora!
      });

      if (wasmResults && wasmResults.length > 0) {
        const results = wasmResults
          .map(b => b.text)
          .filter((t): t is string => !!t);

        if (results.length > 0) {
          self.postMessage({
            type: 'FRAME_DECODED_DATA',
            results
          } as WorkerOutputMessage);
          return;
        }
      }
    } catch (err) {}

    self.postMessage({ type: 'IDLE_DONE' } as WorkerOutputMessage);
  }
};
