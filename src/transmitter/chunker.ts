export interface FileChunkHeader {
  fId: string;    // fileId
  fn: string;     // fileName
  fs: number;     // fileSize
  ft: string;     // fileType
  p: number;      // page (1-based)
  tp: number;     // totalPages
  i: number;      // indexInPage (0-based)
  tip: number;    // totalInPage
  ci: number;     // chunkIndex
  tc: number;     // totalChunks
}

export interface ChunkPayload {
  header: FileChunkHeader;
  rawPayload: Uint8Array;
  qrSegmentData: Uint8Array | string;
}

export function generateFileId(file: File): string {
  const str = `${file.name}-${file.size}-${file.lastModified}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Monta o segmento binário completo do QR Code injetando bytes brutos (Byte Mode):
 * Estrutura Binária Otimizada (Raw Byte Format):
 * [0..3]: Prefix Identifier 'QT1|'
 * [4..N]: JSON Header Minificado em UTF-8
 * [N+1]: Delimitador '|' (ASCII 124)
 * [N+2..End]: Raw Payload Bytes (`Uint8Array`) sem sobrecusto de Base64!
 */
export function packBinaryChunk(header: FileChunkHeader, payloadBytes: Uint8Array): Uint8Array {
  const encoder = new TextEncoder();
  const headerJson = JSON.stringify(header);
  const prefixBytes = encoder.encode(`QT1|${headerJson}|`);

  const fullLength = prefixBytes.byteLength + payloadBytes.byteLength;
  const result = new Uint8Array(fullLength);

  result.set(prefixBytes, 0);
  result.set(payloadBytes, prefixBytes.byteLength);

  return result;
}

/**
 * Desembala tanto formato binário bruto quanto em fallback de texto
 */
export function unpackBinaryChunk(data: Uint8Array | string): { header: FileChunkHeader; dataBytes: Uint8Array } | null {
  try {
    const textDecoder = new TextDecoder();

    let bytes: Uint8Array;
    if (typeof data === 'string') {
      const encoder = new TextEncoder();
      bytes = encoder.encode(data);
    } else {
      bytes = data;
    }

    // Procura os delimitadores '|' (ASCII 124)
    const PIPE_CHAR = 124;
    const firstPipe = bytes.indexOf(PIPE_CHAR);
    if (firstPipe === -1) return null;

    const prefix = textDecoder.decode(bytes.subarray(0, firstPipe));
    if (prefix !== 'QT1') return null;

    const secondPipe = bytes.indexOf(PIPE_CHAR, firstPipe + 1);
    if (secondPipe === -1) return null;

    const headerJson = textDecoder.decode(bytes.subarray(firstPipe + 1, secondPipe));
    const header: FileChunkHeader = JSON.parse(headerJson);
    const dataBytes = bytes.subarray(secondPipe + 1);

    return { header, dataBytes };
  } catch (e) {
    return null;
  }
}

/**
 * Divide o arquivo em Chunks em Byte Mode (Uint8Array) otimizados
 */
export async function chunkFileForGrid(
  file: File,
  bytesPerQr: number = 2000,
  itemsPerPage: number = 4
): Promise<{ pages: ChunkPayload[][]; totalChunks: number; fileId: string }> {
  const fileId = generateFileId(file);
  const arrayBuffer = await file.arrayBuffer();
  const fileBytes = new Uint8Array(arrayBuffer);
  const fileSize = fileBytes.byteLength;

  const totalChunks = Math.ceil(fileSize / bytesPerQr);
  const chunks: { header: FileChunkHeader; rawPayload: Uint8Array }[] = [];

  for (let ci = 0; ci < totalChunks; ci++) {
    const start = ci * bytesPerQr;
    const end = Math.min(start + bytesPerQr, fileSize);
    const chunkBytes = fileBytes.subarray(start, end);

    chunks.push({
      header: {
        fId: fileId,
        fn: file.name,
        fs: fileSize,
        ft: file.type || 'application/octet-stream',
        p: 0,
        tp: 0,
        i: 0,
        tip: 0,
        ci,
        tc: totalChunks
      },
      rawPayload: chunkBytes
    });
  }

  const totalPages = Math.ceil(totalChunks / itemsPerPage);
  const pages: ChunkPayload[][] = [];

  for (let p = 0; p < totalPages; p++) {
    const pageIndex = p + 1;
    const startIdx = p * itemsPerPage;
    const endIdx = Math.min(startIdx + itemsPerPage, totalChunks);
    const pageChunks: ChunkPayload[] = [];
    const totalInPage = endIdx - startIdx;

    for (let i = 0; i < totalInPage; i++) {
      const chunk = chunks[startIdx + i];
      chunk.header.p = pageIndex;
      chunk.header.tp = totalPages;
      chunk.header.i = i;
      chunk.header.tip = totalInPage;

      // Pacote binário puro injetado diretamente em Byte Mode (sem Base64)
      const packedBinary = packBinaryChunk(chunk.header, chunk.rawPayload);

      pageChunks.push({
        header: { ...chunk.header },
        rawPayload: chunk.rawPayload,
        qrSegmentData: packedBinary
      });
    }

    pages.push(pageChunks);
  }

  return { pages, totalChunks, fileId };
}
