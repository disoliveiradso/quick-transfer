import {
  createDecoder,
  LtDecoder,
  binaryToBlock,
  readFileHeaderMetaFromBuffer
} from 'luby-transform';

/**
 * Initializes a new Fountain Decoder session.
 */
export function initializeFountainDecoder(): LtDecoder {
  return createDecoder();
}

/**
 * Decodes a Base64 string from a QR Code into an LTBlock and feeds it to the decoder.
 * Returns true if the block was uniquely added, false if duplicated or invalid.
 */
export function feedDecoderWithBase64(decoder: LtDecoder, base64Data: string): boolean {
  try {
    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const binary = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      binary[i] = binaryString.charCodeAt(i);
    }

    const block = binaryToBlock(binary);
    return decoder.addBlock(block);
  } catch (err) {
    // console.warn("Invalid fountain block received", err);
    return false;
  }
}

/**
 * Extracts the file payload and metadata from a successfully reconstructed LTDecoder buffer.
 */
export function extractFileFromDecoder(decoder: LtDecoder): { file: File } | null {
  const decodedBuffer = decoder.getDecoded();
  if (!decodedBuffer) return null;

  try {
    const [fileData, meta] = readFileHeaderMetaFromBuffer(decodedBuffer);
    const blob = new Blob([new Uint8Array(fileData)], { type: meta.contentType || 'application/octet-stream' });
    const file = new File([blob], meta.filename || 'reconstructed-file.bin', { type: blob.type });
    return { file };
  } catch (e) {
    console.error("Failed to parse file metadata from decoded buffer", e);
    // Fallback: return raw data
    const blob = new Blob([new Uint8Array(decodedBuffer)], { type: 'application/octet-stream' });
    const file = new File([blob], 'reconstructed-file.bin', { type: blob.type });
    return { file };
  }
}
