import { initializeFountainEncoder, encodeBlockToBase64 } from './fountain/encoder';
import { initializeFountainDecoder, feedDecoderWithBase64, extractFileFromDecoder } from './fountain/decoder';
import { renderQRCodeToCanvas } from './transmitter/qrGenerator';
import { ScannerEngine } from './receiver/qrScanner';
import { AudioFeedback } from './receiver/audioFeedback';
import type { LtEncoder, LtDecoder } from 'luby-transform';

// ESTADO DA APLICAÇÃO - TRANSMISSOR
let selectedFiles: File[] = [];
let previewViewMode: 'list' | 'grid' = 'list';
let txFountainEncoder: LtEncoder | null = null;
let txFountainGenerator: Generator<any, never> | null = null;
let txFountainLoopId: number | null = null;
let txSpeedMs: number = 150;
let txBlocksSent: number = 0;
let isTxPaused: boolean = false;

// ESTADO DA APLICAÇÃO - RECEPTOR
let rxScanner: ScannerEngine = new ScannerEngine();
let rxFountainDecoder: LtDecoder | null = null;

// FEEDBACK
const audio = new AudioFeedback();

// ELEMENTOS DOM - NAVEGAÇÃO
const tabSendBtn = document.getElementById('tab-send-btn') as HTMLButtonElement;
const tabReceiveBtn = document.getElementById('tab-receive-btn') as HTMLButtonElement;
const backToUploadBtn = document.getElementById('back-to-upload-btn') as HTMLButtonElement;
const backToSendBtn = document.getElementById('back-to-send-btn') as HTMLButtonElement;

// SEÇÕES
const transmitterUploadSection = document.getElementById('transmitter-upload-section') as HTMLElement;
const transmitterDisplaySection = document.getElementById('transmitter-display-section') as HTMLElement;
const receiverSection = document.getElementById('receiver-section') as HTMLElement;
const fullscreenToggleBtn = document.getElementById('fullscreen-toggle-btn') as HTMLButtonElement;

// PREVIEW UPLOAD
const fileDropzone = document.getElementById('file-dropzone') as HTMLElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const filePreviewContainer = document.getElementById('file-preview-container') as HTMLDivElement;
const fileListWrapper = document.getElementById('file-list-wrapper') as HTMLDivElement;
const toggleViewBtn = document.getElementById('toggle-view-btn') as HTMLButtonElement;
const viewIconList = document.getElementById('view-icon-list') as unknown as SVGElement;
const viewIconGrid = document.getElementById('view-icon-grid') as unknown as SVGElement;
const startTransferBtn = document.getElementById('start-transfer-btn') as HTMLButtonElement;
const addAnotherFileBtn = document.getElementById('add-another-file-btn') as HTMLButtonElement;

// TRANSMISSOR DISPLAY
const txFileInfo = document.getElementById('tx-file-info') as HTMLElement;
const txPageIndicator = document.getElementById('tx-page-indicator') as HTMLElement;
const txQrContainer = document.getElementById('tx-qr-container') as HTMLElement;
const txSpeedSlider = document.getElementById('tx-speed-slider') as HTMLInputElement;
const txSpeedLabel = document.getElementById('tx-speed-label') as HTMLElement;
const txToggleLoopBtn = document.getElementById('tx-toggle-loop-btn') as HTMLButtonElement;
const txDrawerToggleBtn = document.getElementById('tx-drawer-toggle-btn') as HTMLButtonElement;
const txDrawer = document.getElementById('tx-drawer') as HTMLElement;
const txDrawerIcon = document.getElementById('tx-drawer-icon') as unknown as SVGElement;

// RECEPTOR DISPLAY
const rxScannerVideo = document.getElementById('rx-scanner-video') as HTMLVideoElement;
const rxScannerOverlay = document.getElementById('rx-scanner-overlay') as HTMLCanvasElement;
const rxFileInfo = document.getElementById('rx-file-info') as HTMLElement;
const rxProgressFill = document.getElementById('rx-progress-fill') as HTMLElement;
const rxProgressText = document.getElementById('rx-progress-text') as HTMLElement;
const rxChunksText = document.getElementById('rx-chunks-text') as HTMLElement;
const downloadFileBtn = document.getElementById('download-file-btn') as HTMLButtonElement;
const resetRxBtn = document.getElementById('reset-rx-btn') as HTMLButtonElement;

// Modal Pop-up de Dialogs
const appDialogModal = document.getElementById('app-dialog-modal') as HTMLElement;
const appDialogTitle = document.getElementById('app-dialog-title') as HTMLElement;
const appDialogMessage = document.getElementById('app-dialog-message') as HTMLElement;
const appDialogOkBtn = document.getElementById('app-dialog-ok-btn') as HTMLButtonElement;

// INICIALIZAÇÃO
function init() {
  setupTabs();
  setupAppDialogModal();
  setupTransmitterEvents();
  setupDisplayControls();
}

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

function setupTabs() {
  window.addEventListener('popstate', (e) => {
    const state = e.state;
    if (state) {
      if (state.tab === 'send') {
        if (state.view === 'display' && selectedFiles.length > 0) {
          showTransmitterDisplayView(false);
        } else {
          showTransmitterUploadView(false);
        }
      } else if (state.tab === 'receive') {
        showReceiverView(false);
      }
    } else {
      showTransmitterUploadView(false);
    }
  });

  history.replaceState({ tab: 'send', view: 'upload' }, '');

  tabSendBtn.addEventListener('click', () => {
    if (selectedFiles.length > 0 && txFountainEncoder) {
      showTransmitterDisplayView(true);
    } else {
      showTransmitterUploadView(true);
    }
  });
  
  tabReceiveBtn.addEventListener('click', () => showReceiverView(true));

  if (backToSendBtn) {
    backToSendBtn.addEventListener('click', () => showTransmitterUploadView(true));
  }
  if (backToUploadBtn) {
    backToUploadBtn.addEventListener('click', () => showTransmitterUploadView(true));
  }
}

function showTransmitterUploadView(pushHistory: boolean) {
  tabSendBtn.classList.add('active');
  tabReceiveBtn.classList.remove('active');
  transmitterUploadSection.classList.add('active');
  transmitterDisplaySection.classList.remove('active');
  receiverSection.classList.remove('active');
  
  stopFountainLoop();
  rxScanner.stop();

  if (pushHistory) {
    history.pushState({ tab: 'send', view: 'upload' }, '');
  }
}

function showTransmitterDisplayView(pushHistory: boolean) {
  tabSendBtn.classList.add('active');
  tabReceiveBtn.classList.remove('active');
  transmitterUploadSection.classList.remove('active');
  transmitterDisplaySection.classList.add('active');
  receiverSection.classList.remove('active');
  rxScanner.stop();
  
  startOpticalTransmitter();

  if (pushHistory) {
    history.pushState({ tab: 'send', view: 'display' }, '');
  }
}

function showReceiverView(pushHistory: boolean) {
  tabReceiveBtn.classList.add('active');
  tabSendBtn.classList.remove('active');
  receiverSection.classList.add('active');
  transmitterUploadSection.classList.remove('active');
  transmitterDisplaySection.classList.remove('active');
  
  stopFountainLoop();
  startOpticalReceiver();

  if (pushHistory) {
    history.pushState({ tab: 'receive' }, '');
  }
}

function setupDisplayControls() {
  fullscreenToggleBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      transmitterDisplaySection.requestFullscreen?.().catch(_ => {});
    } else {
      document.exitFullscreen?.().catch(_ => {});
    }
  });
}

function getFileIconSVG(type: string, ext: string): string {
  if (type.startsWith('audio/')) return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>';
  if (type.startsWith('video/')) return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>';
  if (type.startsWith('image/')) return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';
  if (type.startsWith('text/')) return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>';
  if (ext === 'pdf') return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M9 15v-4"></path><path d="M12 15v-4"></path><path d="M15 15v-4"></path></svg>';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>';
  if (['exe', 'apk', 'bin', 'msi'].includes(ext)) return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
  return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
}

function handleFilesSelection(files: FileList | File[]) {
  if (!files || files.length === 0) return;
  for (let i = 0; i < files.length; i++) {
    selectedFiles.push(files[i]);
  }
  renderFilesPreview();
}

function renderFilesPreview() {
  if (selectedFiles.length === 0) {
    filePreviewContainer.style.display = 'none';
    if (fileDropzone.parentElement) {
      fileDropzone.parentElement.style.display = 'block';
    }
    return;
  }
  
  if (fileDropzone.parentElement) {
    fileDropzone.parentElement.style.display = 'none';
  }
  filePreviewContainer.style.display = 'block';
  fileListWrapper.innerHTML = '';

  if (previewViewMode === 'grid') {
    fileListWrapper.style.flexDirection = 'row';
    fileListWrapper.style.flexWrap = 'wrap';
    fileListWrapper.style.justifyContent = 'center';
  } else {
    fileListWrapper.style.flexDirection = 'column';
    fileListWrapper.style.flexWrap = 'nowrap';
    fileListWrapper.style.justifyContent = 'flex-start';
  }

  selectedFiles.forEach((file, index) => {
    const nameParts = file.name.split('.');
    const ext = nameParts.length > 1 ? nameParts.pop()!.toLowerCase() : '';
    const type = file.type;

    const item = document.createElement('div');
    if (previewViewMode === 'grid') {
      item.style.cssText = 'display: flex; flex-direction: column; align-items: center; padding: 1rem; background: var(--bg-secondary); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); text-align: center; width: 140px; gap: 0.5rem; position: relative;';
      const iconWrap = document.createElement('div');
      iconWrap.innerHTML = getFileIconSVG(type, ext);
      iconWrap.style.transform = 'scale(1.5)';
      iconWrap.style.margin = '0.5rem 0';
      iconWrap.style.color = 'var(--text-main)';
      const textWrap = document.createElement('div');
      textWrap.style.fontSize = '0.85rem';
      textWrap.style.fontWeight = '600';
      textWrap.style.wordBreak = 'break-word';
      textWrap.style.lineHeight = '1.2';
      textWrap.style.maxHeight = '3em';
      textWrap.style.overflow = 'hidden';
      textWrap.textContent = file.name;
      const sizeText = document.createElement('div');
      sizeText.style.fontSize = '0.75rem';
      sizeText.style.color = 'var(--text-muted)';
      sizeText.textContent = formatBytes(file.size);

      const removeBtn = document.createElement('button');
      removeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
      removeBtn.style.cssText = 'position: absolute; top: 0.25rem; right: 0.25rem; background: transparent; border: none; color: #ef4444; cursor: pointer; padding: 0.25rem;';
      removeBtn.onclick = () => removeFile(index);

      item.appendChild(removeBtn);
      item.appendChild(iconWrap);
      item.appendChild(textWrap);
      item.appendChild(sizeText);
    } else {
      item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 0.75rem; background: var(--bg-secondary); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); gap: 1rem;';
      const leftCol = document.createElement('div');
      leftCol.style.cssText = 'display: flex; align-items: center; gap: 0.75rem; overflow: hidden;';
      const iconWrap = document.createElement('div');
      iconWrap.innerHTML = getFileIconSVG(type, ext);
      iconWrap.style.color = 'var(--text-main)';
      const textWrap = document.createElement('div');
      textWrap.style.display = 'flex';
      textWrap.style.flexDirection = 'column';
      textWrap.style.overflow = 'hidden';
      const title = document.createElement('span');
      title.style.fontWeight = '600';
      title.style.fontSize = '0.9rem';
      title.style.whiteSpace = 'nowrap';
      title.style.overflow = 'hidden';
      title.style.textOverflow = 'ellipsis';
      title.textContent = file.name;
      const subtitle = document.createElement('span');
      subtitle.style.fontSize = '0.8rem';
      subtitle.style.color = 'var(--text-muted)';
      subtitle.textContent = `${ext.toUpperCase()} • ${formatBytes(file.size)}`;

      textWrap.appendChild(title);
      textWrap.appendChild(subtitle);
      leftCol.appendChild(iconWrap);
      leftCol.appendChild(textWrap);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'icon-btn';
      removeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
      removeBtn.style.color = '#ef4444';
      removeBtn.style.padding = '0.4rem';
      removeBtn.onclick = () => removeFile(index);

      item.appendChild(leftCol);
      item.appendChild(removeBtn);
    }
    fileListWrapper.appendChild(item);
  });
}

function removeFile(index: number) {
  selectedFiles.splice(index, 1);
  renderFilesPreview();
}

// -------------------------------------------------------------
// TRANSMISSOR (FOUNTAIN CODES)
// -------------------------------------------------------------

function setupTransmitterEvents() {
  fileDropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const files = (e.target as HTMLInputElement).files;
    if (files) handleFilesSelection(files);
  });

  toggleViewBtn.addEventListener('click', () => {
    previewViewMode = previewViewMode === 'list' ? 'grid' : 'list';
    if (previewViewMode === 'grid') {
      viewIconList.style.display = 'none';
      viewIconGrid.style.display = 'block';
    } else {
      viewIconList.style.display = 'block';
      viewIconGrid.style.display = 'none';
    }
    renderFilesPreview();
  });

  startTransferBtn.addEventListener('click', () => {
    if (selectedFiles.length > 0) rebuildTransmission();
  });

  addAnotherFileBtn.addEventListener('click', () => fileInput.click());

  txSpeedSlider.addEventListener('input', (e) => {
    txSpeedMs = parseInt((e.target as HTMLInputElement).value, 10);
    txSpeedLabel.textContent = `${txSpeedMs}ms`;
    if (txFountainLoopId && !isTxPaused) {
      stopFountainLoop();
      txFountainLoopId = window.setInterval(transmitNextFountainBlock, txSpeedMs);
    }
  });

  txToggleLoopBtn.addEventListener('click', () => {
    isTxPaused = !isTxPaused;
    if (isTxPaused) {
      stopFountainLoop();
      txToggleLoopBtn.textContent = 'Continuar Transmissão';
    } else {
      txFountainLoopId = window.setInterval(transmitNextFountainBlock, txSpeedMs);
      txToggleLoopBtn.textContent = 'Pausar Transmissão';
    }
  });

  txDrawerToggleBtn.addEventListener('click', () => {
    if (txDrawer.style.display === 'none') {
      txDrawer.style.display = 'flex';
      txDrawerIcon.innerHTML = '<polyline points="18 15 12 9 6 15"></polyline>'; // Seta pra cima
    } else {
      txDrawer.style.display = 'none';
      txDrawerIcon.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>'; // Seta pra baixo
    }
  });
}

async function rebuildTransmission() {
  if (selectedFiles.length === 0) return;

  // Usa apenas o primeiro arquivo na fila por enquanto
  const file = selectedFiles[0];
  const maxSafePayload = 1500; // Base64 chunk size
  
  txFountainEncoder = await initializeFountainEncoder(file, maxSafePayload);
  txFountainGenerator = txFountainEncoder.fountain();
  txBlocksSent = 0;
  isTxPaused = false;
  txSpeedMs = parseInt(txSpeedSlider.value, 10);
  txSpeedLabel.textContent = `${txSpeedMs}ms`;

  showTransmitterDisplayView(true);
}

function startOpticalTransmitter() {
  if (!txFountainGenerator) return;

  txFileInfo.textContent = `Enviando via Ciclo Contínuo: ${selectedFiles[0].name}`;
  txToggleLoopBtn.textContent = 'Pausar Transmissão';

  stopFountainLoop();
  txFountainLoopId = window.setInterval(transmitNextFountainBlock, txSpeedMs);
}

function stopFountainLoop() {
  if (txFountainLoopId) {
    clearInterval(txFountainLoopId);
    txFountainLoopId = null;
  }
}

async function transmitNextFountainBlock() {
  if (!txFountainGenerator || isTxPaused) return;

  const block = txFountainGenerator.next().value;
  if (!block) return; // Generator exhausted (unlikely for fountain)

  txBlocksSent++;
  txPageIndicator.textContent = `Ciclo de Transmissão (${txBlocksSent} blocos)`;

  const base64Str = encodeBlockToBase64(block);
  
  txQrContainer.innerHTML = '';
  const canvas = document.createElement('canvas');
  await renderQRCodeToCanvas(canvas, base64Str);
  canvas.style.maxWidth = '100%';
  canvas.style.maxHeight = '65vh';
  canvas.style.objectFit = 'contain';
  txQrContainer.appendChild(canvas);
}

// -------------------------------------------------------------
// RECEPTOR (FOUNTAIN CODES)
// -------------------------------------------------------------

function startOpticalReceiver() {
  if (!rxFountainDecoder) {
    rxFountainDecoder = initializeFountainDecoder();
  }
  rxScanner.onDataDecoded = handleDataDecoded;
  rxScanner.start(rxScannerVideo).catch(err => {
    console.error('Erro ao acessar a câmera principal (Receptor):', err);
    showAppDialog('Erro ao acessar a câmera. Conceda as permissões.', 'Permissão Negada');
  });
}

async function handleDataDecoded(results: any[]) {
  if (!results || results.length === 0 || !rxFountainDecoder) return;

  // Em modo Fountain puro, recebemos a string bruta diretamente do worker
  const base64Str = results[0]; 
  
  if (typeof base64Str !== 'string') return;

  const isNewBlock = feedDecoderWithBase64(rxFountainDecoder, base64Str);
  
  if (isNewBlock) {
    audio.playSuccessBeep();
    drawReceiverOverlayFeedbacks();
    
    const meta = rxFountainDecoder.meta; 
    const resolvidos = rxFountainDecoder.decodedCount;
    const blocosNecessarios = meta ? meta.k : '?';
    const blocosColetados = rxFountainDecoder.encodedBlocks.size;
    
    const pct = meta ? Math.round((resolvidos / meta.k) * 100) : 0;
    rxProgressFill.style.width = `${pct}%`;
    rxProgressText.textContent = `${pct}% reconstruído`;
    rxChunksText.textContent = `${blocosColetados} coletados / ~${blocosNecessarios} necessários`;

    const decodedBuffer = rxFountainDecoder.getDecoded();
    if (decodedBuffer) {
      rxScanner.stop();
      rxProgressFill.style.width = `100%`;
      rxProgressText.textContent = `100% reconstruído`;
      
      const fileData = extractFileFromDecoder(rxFountainDecoder);
      if (fileData) {
        rxFileInfo.textContent = fileData.file.name;
        downloadFileBtn.style.display = 'inline-flex';
        downloadFileBtn.onclick = () => {
          const url = URL.createObjectURL(fileData.file);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileData.file.name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        };
      }
    }
  }
}

function drawReceiverOverlayFeedbacks() {
  const ctx = rxScannerOverlay.getContext('2d');
  if (!ctx || !rxScannerVideo) return;
  const displayWidth = rxScannerVideo.clientWidth || 480;
  const displayHeight = rxScannerVideo.clientHeight || 640;
  if (rxScannerOverlay.width !== displayWidth || rxScannerOverlay.height !== displayHeight) {
    rxScannerOverlay.width = displayWidth;
    rxScannerOverlay.height = displayHeight;
  }
  ctx.clearRect(0, 0, rxScannerOverlay.width, rxScannerOverlay.height);
  ctx.fillStyle = 'rgba(16, 185, 129, 0.3)';
  ctx.fillRect(0, 0, displayWidth, displayHeight);
  setTimeout(() => {
    ctx.clearRect(0, 0, rxScannerOverlay.width, rxScannerOverlay.height);
  }, 100);
}

resetRxBtn.addEventListener('click', () => {
  rxFountainDecoder = null; // Reseta o decodificador
  rxProgressFill.style.width = '0%';
  rxProgressText.textContent = '0% recebido';
  rxChunksText.textContent = '0 blocos coletados';
  rxFileInfo.textContent = 'Aguardando Fonte de Dados...';
  downloadFileBtn.style.display = 'none';
  
  if (!rxScannerVideo.srcObject) {
    startOpticalReceiver();
  }
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

document.addEventListener('DOMContentLoaded', init);
