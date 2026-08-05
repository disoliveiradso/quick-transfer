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
      errorCorrectionLevel: 'L', // Nível L para máxima capacidade de bytes (até 2953 bytes no V40)
      margin: 2,
      scale: 3, // Menor escala para caber na tela
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
  } catch (err) {
    console.error('Erro ao renderizar QR Code no Canvas:', err);
  }
}
