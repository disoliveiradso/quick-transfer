import QRCode from 'qrcode';

/**
 * Gera um Data URL/Canvas de QR Code em Nível L com alta densidade
 */
export async function renderQRCodeToCanvas(
  canvas: HTMLCanvasElement,
  data: string
): Promise<void> {
  try {
    await QRCode.toCanvas(canvas, data, {
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
