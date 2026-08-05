export interface FileChunkHeader {
  fId: string;    // fileId (MD5/SHA hash curto ou timestamp único)
  fn: string;     // fileName
  fs: number;     // fileSize
  ft: string;     // fileType
  p: number;      // page (1-based)
  tp: number;     // totalPages
  i: number;      // indexInPage (0-based: 0..gridSize-1)
  tip: number;    // totalInPage
  ci: number;     // chunkIndex (0-based)
  tc: number;     // totalChunks
}

export interface ChunkPayload {
  header: FileChunkHeader;
  dataBase64: string;
}

/**
 * Calcula um hash simples e ultra rápido para identificar o arquivo
 */
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
 * Converte Uint8Array para Base64 de alta velocidade
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Converte Base64 para Uint8Array
 */
export function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Embala o cabeçalho e payload em formato de string pré-compactada com prefixo 'QT1|'
 * Exemplo: QT1|<header_json_minificado>|<payload_base64>
 */
export function packChunk(header: FileChunkHeader, dataBytes: Uint8Array): string {
  const base64Data = bytesToBase64(dataBytes);
  const headerJson = JSON.stringify(header);
  return `QT1|${headerJson}|${base64Data}`;
}

/**
 * Desembala a string do QR Code lido
 */
export function unpackChunk(qrContent: string): { header: FileChunkHeader; dataBytes: Uint8Array } | null {
  try {
    if (!qrContent.startsWith('QT1|')) return null;
    const parts = qrContent.split('|');
    if (parts.length < 3) return null;
    
    const headerJson = parts[1];
    const base64Data = parts[2];

    const header: FileChunkHeader = JSON.parse(headerJson);
    const dataBytes = base64ToBytes(base64Data);

    return { header, dataBytes };
  } catch (e) {
    console.error('Falha ao desembalar QR chunk:', e);
    return null;
  }
}

/**
 * Divide um arquivo File em uma matriz de páginas contendo fragmentos para o Grid
 * @param file Arquivo selecionado
 * @param bytesPerQr Bytes brutos por QR (padrão 2000 bytes para estabilidade no Level L)
 * @param itemsPerPage Quantidade de QRs na tela por página (ex: 1, 4 ou 9)
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
  const chunks: { header: FileChunkHeader; dataBytes: Uint8Array }[] = [];

  for (let ci = 0; ci < totalChunks; ci++) {
    const start = ci * bytesPerQr;
    const end = Math.min(start + bytesPerQr, fileSize);
    const chunkBytes = fileBytes.subarray(start, end);

    // O header e page/indexInPage serão preenchidos na passagem de montagem por página
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
      dataBytes: chunkBytes
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

      pageChunks.push({
        header: { ...chunk.header },
        dataBase64: packChunk(chunk.header, chunk.dataBytes)
      });
    }

    pages.push(pageChunks);
  }

  return { pages, totalChunks, fileId };
}
