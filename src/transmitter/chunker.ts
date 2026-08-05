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
  qrSegmentData: string;
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

export function packChunkString(header: FileChunkHeader, payloadBytes: Uint8Array): string {
  let binaryString = '';
  const len = payloadBytes.byteLength;
  for (let i = 0; i < len; i++) {
    binaryString += String.fromCharCode(payloadBytes[i]);
  }
  const base64Data = btoa(binaryString);
  const headerJson = JSON.stringify(header);
  return `QT1|${headerJson}|${base64Data}`;
}

export function unpackChunkString(dataStr: string): { header: FileChunkHeader; dataBytes: Uint8Array } | null {
  try {
    if (!dataStr.startsWith('QT1|')) return null;
    const parts = dataStr.split('|');
    if (parts.length < 3) return null;

    const headerJson = parts[1];
    const base64Data = parts[2];

    const header: FileChunkHeader = JSON.parse(headerJson);
    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return { header, dataBytes: bytes };
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

      // Pacote string pré-compactado para máxima compatibilidade com leitoras
      const packedString = packChunkString(chunk.header, chunk.rawPayload);

      pageChunks.push({
        header: { ...chunk.header },
        rawPayload: chunk.rawPayload,
        qrSegmentData: packedString
      });
    }

    pages.push(pageChunks);
  }

  return { pages, totalChunks, fileId };
}
