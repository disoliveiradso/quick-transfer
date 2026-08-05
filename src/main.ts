import { chunkFileForGrid } from './transmitter/chunker';
import type { ChunkPayload } from './transmitter/chunker';
import { renderQRCodeToCanvas } from './transmitter/qrGenerator';
import { ScannerEngine } from './receiver/qrScanner';
import type { ScannedQRInfo } from './receiver/qrScanner';
import { AudioFeedback } from './receiver/audioFeedback';
import { getReceivedChunksCount, assembleFile, clearFile } from './db/storage';

// ESTADO DA APLICAÇÃO
let selectedFile: File | null = null;
let currentPages: ChunkPayload[][] = [];
let currentPageIndex: number = 0; // 0-based
let itemsPerPage: number = 4;
let bytesPerQr: number = 2000;
let autoTimerSec: number = 0;
let autoTimerIntervalId: number | null = null;

// Scanner & Feedback
const scanner = new ScannerEngine();
const audio = new AudioFeedback();
let currentFileIdBeingReceived: string | null = null;
let activeScannedChunksInPage = new Set<number>();
let completedPageToastTimeout: number | null = null;

// ELEMENTOS DOM
const tabSendBtn = document.getElementById('tab-send-btn') as HTMLButtonElement;
const tabReceiveBtn = document.getElementById('tab-receive-btn') as HTMLButtonElement;
const transmitterSection = document.getElementById('transmitter-section') as HTMLElement;
const receiverSection = document.getElementById('receiver-section') as HTMLElement;

// Transmissor Elements
const matrixSizeSelect = document.getElementById('matrix-size-select') as HTMLSelectElement;
const qrDensityInput = document.getElementById('qr-density-input') as HTMLInputElement;
const autoTimerInput = document.getElementById('auto-timer-input') as HTMLInputElement;
const fileDropzone = document.getElementById('file-dropzone') as HTMLElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const transmitterDisplayCard = document.getElementById('transmitter-display-card') as HTMLElement;
const qrGridContainer = document.getElementById('qr-grid-container') as HTMLElement;
const txFileInfo = document.getElementById('tx-file-info') as HTMLElement;
const txPageIndicator = document.getElementById('tx-page-indicator') as HTMLElement;
const prevPageBtn = document.getElementById('prev-page-btn') as HTMLButtonElement;
const nextPageBtn = document.getElementById('next-page-btn') as HTMLButtonElement;
const autoToggleBtn = document.getElementById('auto-toggle-btn') as HTMLButtonElement;

// Receptor Elements
const scannerVideo = document.getElementById('scanner-video') as HTMLVideoElement;
const scannerOverlay = document.getElementById('scanner-overlay') as HTMLCanvasElement;
const rxFileInfo = document.getElementById('rx-file-info') as HTMLElement;
const rxProgressFill = document.getElementById('rx-progress-fill') as HTMLElement;
const rxProgressText = document.getElementById('rx-progress-text') as HTMLElement;
const rxChunksText = document.getElementById('rx-chunks-text') as HTMLElement;
const rxPageStatusGrid = document.getElementById('rx-page-status-grid') as HTMLElement;
const downloadFileBtn = document.getElementById('download-file-btn') as HTMLButtonElement;
const resetRxBtn = document.getElementById('reset-rx-btn') as HTMLButtonElement;
const alertToast = document.getElementById('alert-toast') as HTMLElement;

// EVENT LISTENERS & INICIALIZAÇÃO
function init() {
  setupTabs();
  setupTransmitterEvents();
}

// Alternância de Abas
function setupTabs() {
  tabSendBtn.addEventListener('click', () => switchTab('send'));
  tabReceiveBtn.addEventListener('click', () => switchTab('receive'));
}

function switchTab(tab: 'send' | 'receive') {
  if (tab === 'send') {
    tabSendBtn.classList.add('active');
    tabReceiveBtn.classList.remove('active');
    transmitterSection.classList.add('active');
    receiverSection.classList.remove('active');
    scanner.stop();
  } else {
    tabReceiveBtn.classList.add('active');
    tabSendBtn.classList.remove('active');
    receiverSection.classList.add('active');
    transmitterSection.classList.remove('active');
    stopAutoTimer();
    startReceiverScanner();
  }
}

// LÓGICA DO TRANSMISSOR
function setupTransmitterEvents() {
  matrixSizeSelect.addEventListener('change', () => {
    const val = matrixSizeSelect.value;
    if (val === '1x1') itemsPerPage = 1;
    else if (val === '2x2') itemsPerPage = 4;
    else if (val === '3x3') itemsPerPage = 9;
    qrGridContainer.setAttribute('data-matrix', val);
    rebuildTransmission();
  });

  qrDensityInput.addEventListener('change', () => {
    bytesPerQr = parseInt(qrDensityInput.value, 10) || 2000;
    rebuildTransmission();
  });

  autoTimerInput.addEventListener('change', () => {
    autoTimerSec = parseInt(autoTimerInput.value, 10) || 0;
    if (autoTimerSec > 0 && autoTimerIntervalId) {
      restartAutoTimer();
    }
  });

  fileDropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const files = (e.target as HTMLInputElement).files;
    if (files && files[0]) {
      selectedFile = files[0];
      rebuildTransmission();
    }
  });

  prevPageBtn.addEventListener('click', () => {
    if (currentPageIndex > 0) {
      currentPageIndex--;
      renderCurrentTransmitterPage();
    }
  });

  nextPageBtn.addEventListener('click', () => {
    if (currentPageIndex < currentPages.length - 1) {
      currentPageIndex++;
      renderCurrentTransmitterPage();
    }
  });

  autoToggleBtn.addEventListener('click', () => {
    if (autoTimerIntervalId) {
      stopAutoTimer();
    } else {
      startAutoTimer();
    }
  });
}

async function rebuildTransmission() {
  if (!selectedFile) return;
  
  transmitterDisplayCard.style.display = 'flex';
  const { pages, totalChunks } = await chunkFileForGrid(selectedFile, bytesPerQr, itemsPerPage);
  currentPages = pages;
  currentPageIndex = 0;

  txFileInfo.textContent = `${selectedFile.name} (${formatBytes(selectedFile.size)}) • ${totalChunks} QRs no total`;
  renderCurrentTransmitterPage();
}

async function renderCurrentTransmitterPage() {
  if (!currentPages || currentPages.length === 0) return;

  const pageChunks = currentPages[currentPageIndex];
  txPageIndicator.textContent = `Página ${currentPageIndex + 1} de ${currentPages.length}`;

  prevPageBtn.disabled = currentPageIndex === 0;
  nextPageBtn.disabled = currentPageIndex === currentPages.length - 1;

  qrGridContainer.innerHTML = '';

  for (const chunk of pageChunks) {
    const itemEl = document.createElement('div');
    itemEl.className = 'qr-item';

    const canvas = document.createElement('canvas');
    await renderQRCodeToCanvas(canvas, chunk.dataBase64);

    const label = document.createElement('div');
    label.className = 'qr-label';
    label.textContent = `QR ${chunk.header.ci + 1}/${chunk.header.tc} (Pos ${chunk.header.i + 1}/${chunk.header.tip})`;

    itemEl.appendChild(canvas);
    itemEl.appendChild(label);
    qrGridContainer.appendChild(itemEl);
  }
}

function startAutoTimer() {
  const interval = (autoTimerSec > 0 ? autoTimerSec : 4) * 1000;
  autoToggleBtn.textContent = '⏸ Pausar Auto-Passo';
  autoToggleBtn.classList.add('btn-secondary');

  autoTimerIntervalId = window.setInterval(() => {
    if (currentPageIndex < currentPages.length - 1) {
      currentPageIndex++;
    } else {
      currentPageIndex = 0; // Loop contínuo
    }
    renderCurrentTransmitterPage();
  }, interval);
}

function restartAutoTimer() {
  stopAutoTimer();
  startAutoTimer();
}

function stopAutoTimer() {
  if (autoTimerIntervalId) {
    clearInterval(autoTimerIntervalId);
    autoTimerIntervalId = null;
  }
  autoToggleBtn.textContent = '▶ Iniciar Auto-Passo';
  autoToggleBtn.classList.remove('btn-secondary');
}

// LÓGICA DO RECEPTOR
function startReceiverScanner() {
  scanner.onQRsDetected = handleQRsDetected;
  scanner.start(scannerVideo).catch(err => {
    console.error('Erro ao acessar a câmera:', err);
    alert('Erro ao acessar a câmera. Certifique-se de conceder permissão.');
  });
}

function handleQRsDetected(results: ScannedQRInfo[]) {
  if (!results || results.length === 0) return;

  const first = results[0];
  const header = first.header;

  if (currentFileIdBeingReceived !== header.fId) {
    currentFileIdBeingReceived = header.fId;
    activeScannedChunksInPage.clear();
    rxFileInfo.textContent = `${header.fn} (${formatBytes(header.fs)})`;
  }

  let isNewChunkAdded = false;
  results.forEach(res => {
    if (!activeScannedChunksInPage.has(res.header.ci)) {
      activeScannedChunksInPage.add(res.header.ci);
      isNewChunkAdded = true;
    }
  });

  if (isNewChunkAdded) {
    audio.playSuccessBeep();
    updateReceiverProgress(header);
    drawOverlayFeedbacks(results);
  }
}

async function updateReceiverProgress(header: ScannedQRInfo['header']) {
  const receivedSet = await getReceivedChunksCount(header.fId);
  const total = header.tc;
  const received = receivedSet.size;
  const pct = Math.round((received / total) * 100);

  rxProgressFill.style.width = `${pct}%`;
  rxProgressText.textContent = `${pct}% recebido`;
  rxChunksText.textContent = `${received} / ${total} chunks`;

  // Renderiza badges da página atual
  rxPageStatusGrid.innerHTML = '';
  const startChunkInPage = (header.p - 1) * header.tip;

  for (let i = 0; i < header.tip; i++) {
    const chunkIdx = startChunkInPage + i;
    const isDone = receivedSet.has(chunkIdx);

    const badge = document.createElement('div');
    badge.className = `status-badge ${isDone ? 'success' : 'pending'}`;
    badge.innerHTML = `${isDone ? '✓' : '⏳'} Item ${i + 1} (${chunkIdx + 1}/${total})`;
    rxPageStatusGrid.appendChild(badge);
  }

  // Verifica se TODOS os QRs da página atual foram lidos
  let pageComplete = true;
  for (let i = 0; i < header.tip; i++) {
    const chunkIdx = startChunkInPage + i;
    if (!receivedSet.has(chunkIdx)) {
      pageComplete = false;
      break;
    }
  }

  if (pageComplete) {
    showCompletedPageToast();
  }

  // Se 100% do arquivo foi concluído
  if (received >= total) {
    downloadFileBtn.style.display = 'inline-flex';
    downloadFileBtn.onclick = () => handleDownloadFile(header.fId, header.fn);
  }
}

function drawOverlayFeedbacks(results: ScannedQRInfo[]) {
  const ctx = scannerOverlay.getContext('2d');
  if (!ctx || !scannerVideo) return;

  scannerOverlay.width = scannerVideo.videoWidth || 640;
  scannerOverlay.height = scannerVideo.videoHeight || 480;

  ctx.clearRect(0, 0, scannerOverlay.width, scannerOverlay.height);

  results.forEach(res => {
    if (res.points && res.points.length >= 1) {
      const p1 = res.points[0];

      // Desenha caixa verde sobre o QR Code lido
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(p1.getX(), p1.getY(), 15, 0, 2 * Math.PI);
      ctx.stroke();

      // Descreve ícone CHECK (✓)
      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 20px Inter, sans-serif';
      ctx.fillText('✓', p1.getX() - 6, p1.getY() + 6);
    }
  });

  setTimeout(() => {
    ctx.clearRect(0, 0, scannerOverlay.width, scannerOverlay.height);
  }, 600);
}

function showCompletedPageToast() {
  audio.playPageCompleteChime();
  alertToast.classList.add('show');

  if (completedPageToastTimeout) clearTimeout(completedPageToastTimeout);
  completedPageToastTimeout = window.setTimeout(() => {
    alertToast.classList.remove('show');
  }, 2500);
}

async function handleDownloadFile(fileId: string, fileName: string) {
  const blob = await assembleFile(fileId);
  if (!blob) {
    alert('Erro ao montar o arquivo final.');
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

resetRxBtn.addEventListener('click', async () => {
  if (currentFileIdBeingReceived) {
    await clearFile(currentFileIdBeingReceived);
  }
  currentFileIdBeingReceived = null;
  activeScannedChunksInPage.clear();
  rxProgressFill.style.width = '0%';
  rxProgressText.textContent = '0% recebido';
  rxChunksText.textContent = '0 / 0 chunks';
  rxPageStatusGrid.innerHTML = '';
  rxFileInfo.textContent = 'Nenhum arquivo sendo lido';
  downloadFileBtn.style.display = 'none';
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

document.addEventListener('DOMContentLoaded', init);
