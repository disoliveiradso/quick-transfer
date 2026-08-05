import QRCode from 'qrcode';

/**
 * Gera um Data URL/Canvas de QR Code em Nível L com alta capacidade para SDPs
 */
export async function renderQRCodeToCanvas(
  canvas: HTMLCanvasElement,
  data: string
): Promise<void> {
  try {
    await QRCode.toCanvas(canvas, data, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 280,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
  } catch (err) {
    console.error('Erro ao renderizar QR Code no Canvas:', err);
  }
}
