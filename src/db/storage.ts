import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';

export interface ChunkRecord {
  fileId: string;
  chunkIndex: number;
  totalChunks: number;
  fileName: string;
  fileSize: number;
  fileType: string;
  data: ArrayBuffer;
}

export interface FileMetadata {
  fileId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  totalChunks: number;
  receivedChunks: number;
  completed: boolean;
  createdAt: number;
}

interface QuickTransferDB extends DBSchema {
  chunks: {
    key: [string, number]; // [fileId, chunkIndex]
    value: ChunkRecord;
    indexes: { 'by-fileId': string };
  };
  files: {
    key: string;
    value: FileMetadata;
  };
}

let dbPromise: Promise<IDBPDatabase<QuickTransferDB>> | null = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<QuickTransferDB>('quick-transfer-db', 1, {
      upgrade(db) {
        const chunkStore = db.createObjectStore('chunks', {
          keyPath: ['fileId', 'chunkIndex']
        });
        chunkStore.createIndex('by-fileId', 'fileId');

        db.createObjectStore('files', {
          keyPath: 'fileId'
        });
      }
    });
  }
  return dbPromise;
}

export async function saveChunk(chunk: ChunkRecord): Promise<{ isComplete: boolean; progress: number }> {
  const db = await getDB();
  const tx = db.transaction(['chunks', 'files'], 'readwrite');
  
  // Salva o chunk se ainda não existir
  const existingChunk = await tx.objectStore('chunks').get([chunk.fileId, chunk.chunkIndex]);
  if (!existingChunk) {
    await tx.objectStore('chunks').put(chunk);
  }

  // Atualiza ou cria os metadados do arquivo
  let fileMeta = await tx.objectStore('files').get(chunk.fileId);
  if (!fileMeta) {
    fileMeta = {
      fileId: chunk.fileId,
      fileName: chunk.fileName,
      fileSize: chunk.fileSize,
      fileType: chunk.fileType,
      totalChunks: chunk.totalChunks,
      receivedChunks: 0,
      completed: false,
      createdAt: Date.now()
    };
  }

  // Conta os chunks recebidos para este arquivo
  const allChunksForFile = await tx.objectStore('chunks').index('by-fileId').getAllKeys(chunk.fileId);
  fileMeta.receivedChunks = allChunksForFile.length;
  if (fileMeta.receivedChunks >= fileMeta.totalChunks) {
    fileMeta.completed = true;
  }

  await tx.objectStore('files').put(fileMeta);
  await tx.done;

  const progress = Math.round((fileMeta.receivedChunks / fileMeta.totalChunks) * 100);
  return {
    isComplete: fileMeta.completed,
    progress
  };
}

export async function getReceivedChunksCount(fileId: string): Promise<Set<number>> {
  const db = await getDB();
  const keys = await db.getAllKeysFromIndex('chunks', 'by-fileId', fileId);
  const indexes = new Set<number>();
  for (const key of keys) {
    // key é [fileId, chunkIndex]
    indexes.add(key[1]);
  }
  return indexes;
}

export async function assembleFile(fileId: string): Promise<Blob | null> {
  const db = await getDB();
  const fileMeta = await db.get('files', fileId);
  if (!fileMeta) return null;

  const chunks = await db.getAllFromIndex('chunks', 'by-fileId', fileId);
  if (chunks.length < fileMeta.totalChunks) return null;

  // Ordena pelo chunkIndex
  chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

  const buffers = chunks.map(c => c.data);
  return new Blob(buffers, { type: fileMeta.fileType || 'application/octet-stream' });
}

export async function clearFile(fileId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['chunks', 'files'], 'readwrite');
  const keys = await tx.objectStore('chunks').index('by-fileId').getAllKeys(fileId);
  for (const key of keys) {
    await tx.objectStore('chunks').delete(key);
  }
  await tx.objectStore('files').delete(fileId);
  await tx.done;
}
