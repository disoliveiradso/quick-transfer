import { chunkFileForGrid } from './transmitter/chunker';
import type { ChunkPayload } from './transmitter/chunker';
import { renderQRCodeToCanvas } from './transmitter/qrGenerator';
import { ScannerEngine } from './receiver/qrScanner';
import type { ScannedQRInfo } from './receiver/qrScanner';
import { AudioFeedback } from './receiver/audioFeedback';
import { getReceivedChunksCount, assembleFile, clearFile } from './db/storage';

interface UserSettings {
  isCustom: boolean;
  matrixSize: '1x1' | '2x2' | '3x3';
  bytesPerQr: number;
  autoTimerSec: number;
}

const SETTINGS_STORAGE_KEY = 'quick_transfer_user_settings';

// ESTADO DA APLICAÇÃO
let selectedFile: File | null = null;
let currentPages: ChunkPayload[][] = [];
let currentPageIndex: number = 0; // 0-based
let itemsPerPage: number = 4;
let bytesPerQr: number = 2000;
let autoTimerSec: number = 0;
let autoTimerIntervalId: number | null = null;

// Estado de Configurações
let userSettings: UserSettings = loadSettingsFromLocalStorage();

// Scanner & Feedback
const scanner = new ScannerEngine();
const audio = new AudioFeedback();
let currentFileIdBeingReceived: string | null = null;
let activeScannedChunksInPage = new Set<number>();
let completedPageToastTimeout: number | null = null;

// ELEMENTOS DOM
const tabSendBtn = document.getElementById('tab-send-btn') as HTMLButtonElement;
const tabReceiveBtn = document.getElementById('tab-receive-btn') as HTMLButtonElement;
const backToSendBtn = document.getElementById('back-to-send-btn') as HTMLButtonElement;
const transmitterSection = document.getElementById('transmitter-section') as HTMLElement;
const receiverSection = document.getElementById('receiver-section') as HTMLElement;

// Modal & Configurações Elements
const settingsToggleBtn = document.getElementById('settings-toggle-btn') as HTMLButtonElement;
const settingsModal = document.getElementById('settings-modal') as HTMLElement;
const closeSettingsBtn = document.getElementById('close-settings-btn') as HTMLButtonElement;
const saveSettingsBtn = document.getElementById('save-settings-btn') as HTMLButtonElement;
const resetAutoSettingsBtn = document.getElementById('reset-auto-settings-btn') as HTMLButtonElement;

// Custom Select Elements
const customMatrixSelect = document.getElementById('custom-matrix-select') as HTMLElement;
const customSelectValue = document.getElementById('custom-select-value') as HTMLElement;
const customOptions = document.querySelectorAll('.custom-option');

const qrDensityInput = document.getElementById('qr-density-input') as HTMLInputElement;
const autoTimerInput = document.getElementById('auto-timer-input') as HTMLInputElement;

// Modal Pop-up de Dialogs
const appDialogModal = document.getElementById('app-dialog-modal') as HTMLElement;
const appDialogTitle = document.getElementById('app-dialog-title') as HTMLElement;
const appDialogMessage = document.getElementById('app-dialog-message') as HTMLElement;
const appDialogOkBtn = document.getElementById('app-dialog-ok-btn') as HTMLButtonElement;

// Transmissor Elements
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

// INICIALIZAÇÃO
function init() {
  setupTabs();
  setupSettingsModal();
  setupCustomSelect();
  setupAppDialogModal();
  setupTransmitterEvents();
  syncUIWithSettings();
}

/**
 * Exibe pop-ups de aviso/erro customizados na UI da aplicação em substituição ao alert nativo
 */
function showAppDialog(message: string, title: string = 'Aviso') {
  appDialogTitle.textContent = title;
  appDialogMessage.textContent = message;
  appDialogModal.style.display = 'flex';
}

function setupAppDialogModal() {
  appDialogOkBtn.addEventListener('click', () => {
    appDialogModal.style.display = 'none';
  });
  appDialogModal.addEventListener('click', (e) => {
    if (e.target === appDialogModal) {
      appDialogModal.style.display = 'none';
    }
  });
}

function loadSettingsFromLocalStorage(): UserSettings {
  const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (_) {}
  }
  return {
    isCustom: false,
    matrixSize: '2x2',
    bytesPerQr: 2000,
    autoTimerSec: 0
  };
}

function saveSettingsToLocalStorage(settings: UserSettings) {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function syncUIWithSettings() {
  updateCustomSelectUI(userSettings.matrixSize);
  qrDensityInput.value = userSettings.bytesPerQr.toString();
  autoTimerInput.value = userSettings.autoTimerSec.toString();
}

// Configuração do Custom Select Dropdown
function setupCustomSelect() {
  const trigger = customMatrixSelect.querySelector('.custom-select-trigger');
  
  trigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    customMatrixSelect.classList.toggle('open');
  });

  document.addEventListener('click', () => {
    customMatrixSelect.classList.remove('open');
  });

  customOptions.forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = (opt as HTMLElement).dataset.value as UserSettings['matrixSize'];
      updateCustomSelectUI(val);
      customMatrixSelect.classList.remove('open');
    });
  });
}

function updateCustomSelectUI(val: UserSettings['matrixSize']) {
  customOptions.forEach(opt => {
    const optEl = opt as HTMLElement;
    if (optEl.dataset.value === val) {
      optEl.classList.add('selected');
      customSelectValue.textContent = optEl.textContent || '';
    } else {
      optEl.classList.remove('selected');
    }
  });
  customMatrixSelect.dataset.value = val;
}

// Configurações e Modal
function setupSettingsModal() {
  settingsToggleBtn.addEventListener('click', () => {
    syncUIWithSettings();
    settingsModal.style.display = 'flex';
  });

  closeSettingsBtn.addEventListener('click', () => {
    settingsModal.style.display = 'none';
  });

  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.style.display = 'none';
    }
  });

  saveSettingsBtn.addEventListener('click', () => {
    const selectedMatrix = (customMatrixSelect.dataset.value as UserSettings['matrixSize']) || '2x2';
    userSettings = {
      isCustom: true,
      matrixSize: selectedMatrix,
      bytesPerQr: parseInt(qrDensityInput.value, 10) || 2000,
      autoTimerSec: parseInt(autoTimerInput.value, 10) || 0
    };
    saveSettingsToLocalStorage(userSettings);
    settingsModal.style.display = 'none';
    rebuildTransmission();
  });

  resetAutoSettingsBtn.addEventListener('click', () => {
    userSettings = {
      isCustom: false,
      matrixSize: '2x2',
      bytesPerQr: 2000,
      autoTimerSec: 0
    };
    saveSettingsToLocalStorage(userSettings);
    syncUIWithSettings();
    settingsModal.style.display = 'none';
    rebuildTransmission();
  });
}

// Alternância de Abas e Navegação Dedicada do Receptor
function setupTabs() {
  tabSendBtn.addEventListener('click', () => switchTab('send'));
  tabReceiveBtn.addEventListener('click', () => switchTab('receive'));
  if (backToSendBtn) {
    backToSendBtn.addEventListener('click', () => switchTab('send'));
  }
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

/**
 * Ajusta automaticamente o tamanho da matriz e a densidade com base no tamanho do arquivo
 */
function applyAutomaticSettings(fileSize: number): { matrixStr: '1x1' | '2x2' | '3x3'; items: number; bytes: number } {
  if (userSettings.isCustom) {
    let items = 4;
    if (userSettings.matrixSize === '1x1') items = 1;
    if (userSettings.matrixSize === '3x3') items = 9;
    return {
      matrixStr: userSettings.matrixSize,
      items,
      bytes: userSettings.bytesPerQr
    };
  }

  if (fileSize < 200 * 1024) {
    return { matrixStr: '1x1', items: 1, bytes: 2000 };
  } else if (fileSize < 2 * 1024 * 1024) {
    return { matrixStr: '2x2', items: 4, bytes: 2200 };
  } else {
    return { matrixStr: '3x3', items: 9, bytes: 2500 };
  }
}

async function rebuildTransmission() {
  if (!selectedFile) return;
  
  transmitterDisplayCard.style.display = 'flex';

  const autoConfig = applyAutomaticSettings(selectedFile.size);
  itemsPerPage = autoConfig.items;
  bytesPerQr = autoConfig.bytes;
  autoTimerSec = userSettings.autoTimerSec;

  qrGridContainer.setAttribute('data-matrix', autoConfig.matrixStr);

  const { pages, totalChunks } = await chunkFileForGrid(selectedFile, bytesPerQr, itemsPerPage);
  currentPages = pages;
  currentPageIndex = 0;

  txFileInfo.textContent = `${selectedFile.name} (${formatBytes(selectedFile.size)}) • Grid ${autoConfig.matrixStr} (${totalChunks} QRs)`;
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
  autoToggleBtn.textContent = '⏸ Pausar Auto';
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

function stopAutoTimer() {
  if (autoTimerIntervalId) {
    clearInterval(autoTimerIntervalId);
    autoTimerIntervalId = null;
  }
  autoToggleBtn.textContent = '▶ Auto-Passo';
  autoToggleBtn.classList.remove('btn-secondary');
}

// LÓGICA DO RECEPTOR
function startReceiverScanner() {
  scanner.onQRsDetected = handleQRsDetected;
  scanner.start(scannerVideo).catch(err => {
    console.error('Erro ao acessar a câmera:', err);
    showAppDialog('Erro ao acessar a câmera. Certifique-se de conceder permissão no navegador.', 'Permissão Negada');
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

  scannerOverlay.width = scannerVideo.videoWidth || 480;
  scannerOverlay.height = scannerVideo.videoHeight || 640;

  ctx.clearRect(0, 0, scannerOverlay.width, scannerOverlay.height);

  results.forEach(res => {
    if (res.position) {
      const { topLeft, topRight, bottomRight, bottomLeft } = res.position;

      // Desenha o polígono delimitador sobre o QR Code lido
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(topLeft.x, topLeft.y);
      ctx.lineTo(topRight.x, topRight.y);
      ctx.lineTo(bottomRight.x, bottomRight.y);
      ctx.lineTo(bottomLeft.x, bottomLeft.y);
      ctx.closePath();
      ctx.stroke();

      // Fundo semi-transparente verde no QR lido
      ctx.fillStyle = 'rgba(16, 185, 129, 0.2)';
      ctx.fill();

      // Desenha o ícone de Check verde (✓) no centro do QR Code
      const centerX = (topLeft.x + bottomRight.x) / 2;
      const centerY = (topLeft.y + bottomRight.y) / 2;

      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 26px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✓', centerX, centerY);
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
    showAppDialog('Erro ao montar o arquivo final a partir dos pedaços salvos.', 'Erro de Leitura');
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
  rxFileInfo.textContent = 'Nenhum arquivo lido';
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
