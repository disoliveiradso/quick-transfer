import {
  createEncoder,
  LtEncoder,
  appendFileHeaderMetaToBuffer,
  blockToBinary
} from 'luby-transform';
import type { EncodedBlock } from 'luby-transform';

/**
 * Prepares a file to be transmitted using Fountain Codes (Luby Transform).
 */
export async function initializeFountainEncoder(
  file: File,
  sliceSize: number = 1024
): Promise<LtEncoder> {
  // Read file as Uint8Array
  const arrayBuffer = await file.arrayBuffer();
  const fileData = new Uint8Array(arrayBuffer);

  // Pack metadata (filename, mime-type) directly into the buffer
  const bufferWithMeta = appendFileHeaderMetaToBuffer(fileData, {
    filename: file.name,
    contentType: file.type || 'application/octet-stream',
  });

  // Create the encoder with compression enabled (if luby-transform supports it, passing true)
  // LTEncoder will compress the data internally using pako
  return createEncoder(bufferWithMeta, sliceSize, true);
}

/**
 * Encodes an LTBlock to a Base64 string for QR Code injection.
 */
export function encodeBlockToBase64(block: EncodedBlock): string {
  const binary = blockToBinary(block);
  
  // Convert binary to base64
  let binaryString = '';
  const len = binary.length;
  for (let i = 0; i < len; i++) {
    binaryString += String.fromCharCode(binary[i]);
  }
  return btoa(binaryString);
}
