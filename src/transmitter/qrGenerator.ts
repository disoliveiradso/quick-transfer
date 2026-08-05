import QRCode from 'qrcode';

/**
 * Gera um Data URL SVG/PNG de QR Code em Nível L com máxima densidade de payload
 */
export async function renderQRCodeToCanvas(
  canvas: HTMLCanvasElement,
  textData: string
): Promise<void> {
  try {
    await QRCode.toCanvas(canvas, textData, {
      errorCorrectionLevel: 'L', // Nível L para máxima capacidade (~7% redundância)
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
