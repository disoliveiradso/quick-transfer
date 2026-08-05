import QRCode from 'qrcode';

/**
 * Gera um Data URL/Canvas de QR Code em Nível L com suporte a Byte Mode (Uint8Array puro)
 */
export async function renderQRCodeToCanvas(
  canvas: HTMLCanvasElement,
  data: Uint8Array | string
): Promise<void> {
  try {
    const qrSegments = typeof data === 'string' 
      ? data 
      : [{ data: data, mode: 'byte' as const }];

    await QRCode.toCanvas(canvas, qrSegments as unknown as string, {
      errorCorrectionLevel: 'L', // Nível L para máxima capacidade de bytes útil (~7% redundância)
      margin: 1,
      scale: 6,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
  } catch (err) {
    console.error('Erro ao renderizar QR Code no Canvas:', err);
  }
}
