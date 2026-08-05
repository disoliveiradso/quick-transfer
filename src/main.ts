import { WebRTCManager } from './webrtc';
import { ScannerEngine } from './receiver/qrScanner';
import { renderQRCodeToCanvas } from './transmitter/qrGenerator';

// Estado global
let webrtcManager: WebRTCManager | null = null;
let scanner: ScannerEngine | null = null;
let selectedFiles: File[] = [];
let currentFileIndex = 0;
let isTextTransfer = false;
let currentRole: 'sender' | 'receiver' | null = null;
let downloadedFileUrls: string[] = [];
let isConnectionEstablished = false;

// Elementos DOM
const homeSection = document.getElementById('home-section') as HTMLElement;
const scannerSection = document.getElementById('scanner-section') as HTMLElement;
const qrDisplaySection = document.getElementById('qr-display-section') as HTMLElement;
const transferSection = document.getElementById('transfer-section') as HTMLElement;

// Inputs & Previews
const fileDropzoneCard = document.getElementById('file-dropzone-card') as HTMLElement;
const fileDropzone = document.getElementById('file-dropzone') as HTMLElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const filePreviewContainer = document.getElementById('file-preview-container') as HTMLElement;
const fileListDisplay = document.getElementById('file-list-display') as HTMLElement;
const toggleViewBtn = document.getElementById('toggle-view-btn') as HTMLButtonElement;
const addMoreFilesBtn = document.getElementById('add-more-files-btn') as HTMLButtonElement;
const startTransferBtn = document.getElementById('start-transfer-btn') as HTMLButtonElement;
const receiveModeBtn = document.getElementById('receive-mode-btn') as HTMLButtonElement;

// Text Input
const textInput = document.getElementById('text-input') as HTMLTextAreaElement;
const sendTextBtn = document.getElementById('send-text-btn') as HTMLButtonElement;

// Scanner
const scannerVideo = document.getElementById('scanner-video') as HTMLVideoElement;
const scannerBackBtn = document.getElementById('scanner-back-btn') as HTMLButtonElement;
const scannerBackText = document.getElementById('scanner-back-text') as HTMLElement;
const scannerCancelBtn = document.getElementById('scanner-cancel-btn') as HTMLButtonElement;
const scannerTitle = document.getElementById('scanner-title') as HTMLElement;
const scannerInstruction = document.getElementById('scanner-instruction') as HTMLElement;

// QR Display
const qrCanvas = document.getElementById('qr-canvas') as HTMLCanvasElement;
const qrBackBtn = document.getElementById('qr-back-btn') as HTMLButtonElement;
const qrBackText = document.getElementById('qr-back-text') as HTMLElement;
const qrCancelBtn = document.getElementById('qr-cancel-btn') as HTMLButtonElement;
const qrDisplayTitle = document.getElementById('qr-display-title') as HTMLElement;
const qrInstruction = document.getElementById('qr-instruction') as HTMLElement;
const qrNextActionBtn = document.getElementById('qr-next-action-btn') as HTMLButtonElement;

// Transferência
const transferHeading = document.getElementById('transfer-heading') as HTMLElement;
const transferProgressWrapper = document.getElementById('transfer-progress-wrapper') as HTMLElement;
const transferProgressFill = document.getElementById('transfer-progress-fill') as HTMLElement;
const transferProgressText = document.getElementById('transfer-progress-text') as HTMLElement;
const transferBytesText = document.getElementById('transfer-bytes-text') as HTMLElement;
const transferStatus = document.getElementById('transfer-status') as HTMLElement;

const receivedTextContainer = document.getElementById('received-text-container') as HTMLElement;
const receivedTextContent = document.getElementById('received-text-content') as HTMLElement;
const copyTextBtn = document.getElementById('copy-text-btn') as HTMLButtonElement;
const downloadButtonsContainer = document.getElementById('download-buttons-container') as HTMLElement;

const sendMoreContainer = document.getElementById('send-more-container') as HTMLElement;
const sendMoreFileInput = document.getElementById('send-more-file-input') as HTMLInputElement;
const sendMoreFilesBtn = document.getElementById('send-more-files-btn') as HTMLButtonElement;
const disconnectBtn = document.getElementById('disconnect-btn') as HTMLButtonElement;

// Dialog
const appDialogModal = document.getElementById('app-dialog-modal') as HTMLElement;
const appDialogTitle = document.getElementById('app-dialog-title') as HTMLElement;
const appDialogMessage = document.getElementById('app-dialog-message') as HTMLElement;
const appDialogOkBtn = document.getElementById('app-dialog-ok-btn') as HTMLButtonElement;

function showDialog(message: string, title: string = 'Aviso') {
  appDialogTitle.textContent = title;
  appDialogMessage.textContent = message;
  appDialogModal.style.display = 'flex';
}

// Helpers Visuais
function getFileIcon(type: string): string {
  if (type.startsWith('image/')) return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
  if (type.startsWith('video/')) return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>';
  if (type.startsWith('audio/')) return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  if (type.includes('pdf')) return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';
  return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';
}

function updateFileListUI() {
  fileListDisplay.innerHTML = '';
  if (selectedFiles.length === 0) {
    fileDropzoneCard.style.display = 'block';
    filePreviewContainer.style.display = 'none';
    return;
  }
  
  fileDropzoneCard.style.display = 'none';
  filePreviewContainer.style.display = 'block';

  selectedFiles.forEach((f, idx) => {
    const item = document.createElement('div');
    item.className = 'file-list-item';
    
    if (fileListDisplay.classList.contains('file-grid-view')) {
      item.innerHTML = `
        <div style="color: var(--accent-primary); margin-bottom: 0.5rem;">${getFileIcon(f.type)}</div>
        <div class="truncate-text" style="font-size: 0.75rem; font-weight: 600; width: 100%; text-align: center;">${f.name}</div>
        <button class="remove-btn icon-btn" data-idx="${idx}" style="position: absolute; top: 4px; right: 4px; background: rgba(0,0,0,0.5); border-radius: 50%; color: #ef4444; padding: 4px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      `;
    } else {
      item.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.75rem; flex: 1; min-width: 0;">
          <div style="color: var(--accent-primary); flex-shrink: 0;">${getFileIcon(f.type)}</div>
          <div style="flex: 1; min-width: 0;">
            <div class="truncate-text" style="font-size: 0.9rem; font-weight: 600;">${f.name}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">${formatBytes(f.size)}</div>
          </div>
        </div>
        <button class="remove-btn icon-btn" data-idx="${idx}" style="color: #ef4444; padding: 0.4rem; flex-shrink: 0;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      `;
    }
    fileListDisplay.appendChild(item);
  });

  document.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt((e.currentTarget as HTMLElement).getAttribute('data-idx') || '0');
      selectedFiles.splice(idx, 1);
      updateFileListUI();
    });
  });
}

function init() {
  appDialogOkBtn.onclick = () => appDialogModal.style.display = 'none';
  
  // File selection
  fileDropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const files = (e.target as HTMLInputElement).files;
    if (files) {
      for (let i = 0; i < files.length; i++) {
        selectedFiles.push(files[i]);
      }
      textInput.value = '';
      sendTextBtn.style.display = 'none';
      updateFileListUI();
    }
    fileInput.value = '';
  });

  addMoreFilesBtn.addEventListener('click', () => fileInput.click());

  toggleViewBtn.addEventListener('click', () => {
    if (fileListDisplay.classList.contains('file-list-view')) {
      fileListDisplay.classList.replace('file-list-view', 'file-grid-view');
      toggleViewBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>';
    } else {
      fileListDisplay.classList.replace('file-grid-view', 'file-list-view');
      toggleViewBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>';
    }
    updateFileListUI();
  });

  // Text input detection
  textInput.addEventListener('input', () => {
    if (textInput.value.trim().length > 0) {
      sendTextBtn.style.display = 'block';
    } else {
      sendTextBtn.style.display = 'none';
    }
  });

  copyTextBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(receivedTextContent.textContent || '');
    copyTextBtn.textContent = "Copiado!";
    setTimeout(() => copyTextBtn.textContent = "Copiar Texto", 2000);
  });

  // Start Sender Flow (File)
  startTransferBtn.addEventListener('click', () => {
    if (selectedFiles.length === 0) return;
    isTextTransfer = false;
    startSenderFlow();
  });

  // Start Sender Flow (Text)
  sendTextBtn.addEventListener('click', () => {
    if (textInput.value.trim().length === 0) return;
    isTextTransfer = true;
    startSenderFlow();
  });

  // Start Receiver Flow
  receiveModeBtn.addEventListener('click', () => {
    currentRole = 'receiver';
    startScannerForOffer();
  });

  // Action to send more files over active WebRTC channel
  sendMoreFilesBtn.addEventListener('click', () => {
    sendMoreFileInput.click();
  });

  sendMoreFileInput.addEventListener('change', (e) => {
    const files = (e.target as HTMLInputElement).files;
    if (files && files.length > 0) {
      selectedFiles = Array.from(files);
      currentFileIndex = 0;
      isTextTransfer = false;
      sendMoreContainer.style.display = 'none';
      transferProgressWrapper.style.display = 'block';
      sendNextFile();
    }
    sendMoreFileInput.value = '';
  });

  disconnectBtn.addEventListener('click', cleanupAndGoHome);
  scannerCancelBtn.addEventListener('click', cleanupAndGoHome);
  qrCancelBtn.addEventListener('click', cleanupAndGoHome);
}

async function startSenderFlow() {
  currentRole = 'sender';
  showView(qrDisplaySection);
  qrDisplayTitle.textContent = "Passo 1: Criando Oferta...";
  qrInstruction.textContent = "Aguarde a geração do QR Code...";
  qrNextActionBtn.style.display = 'none';

  // Configura botões de navegação no Passo 1 (Remetente)
  qrBackText.textContent = "Cancelar";
  qrCancelBtn.style.display = 'none';
  qrBackBtn.onclick = cleanupAndGoHome;

  webrtcManager = new WebRTCManager(getWebRTCEvents());
  try {
    const offerBase64 = await webrtcManager.createOffer();
    const payload = 'OFR:' + offerBase64;
    await renderQRCodeToCanvas(qrCanvas, payload);
    qrDisplayTitle.textContent = "Passo 1: Escaneie no Receptor";
    qrInstruction.textContent = "Use o botão 'Receber' no outro dispositivo e aponte a câmera para este QR Code.";
    qrNextActionBtn.textContent = "Avançar (Já escaneei)";
    qrNextActionBtn.style.display = 'block';
    
    qrNextActionBtn.onclick = () => {
      startScannerForAnswer();
    };
  } catch (err) {
    showDialog("Erro ao criar oferta P2P.", "Erro");
    cleanupAndGoHome();
  }
}

function startScannerForOffer() {
  showView(scannerSection);
  scannerTitle.textContent = "Escaneando Oferta";
  scannerInstruction.textContent = "Aponte a câmera para o QR Code de Oferta gerado pelo Transmissor.";
  
  // Configura botões de navegação no Passo 1 (Receptor)
  scannerBackText.textContent = "Cancelar";
  scannerCancelBtn.style.display = 'none';
  scannerBackBtn.onclick = cleanupAndGoHome;

  if (!scanner) scanner = new ScannerEngine();
  scanner.onDataDecoded = async (results) => {
    const data = results[0];
    if (data.startsWith('OFR:')) {
      scanner!.stop();
      audioBeep();
      await handleOfferScanned(data.substring(4));
    }
  };
  scanner.start(scannerVideo).catch(() => showDialog("Erro na câmera"));
}

async function handleOfferScanned(offerStr: string) {
  showView(qrDisplaySection);
  qrDisplayTitle.textContent = "Passo 2: Criando Resposta...";
  qrInstruction.textContent = "Aguarde a geração do QR Code de resposta...";
  qrNextActionBtn.style.display = 'none';

  // Configura botões no Passo 2 (Receptor - tem Voltar e Cancelar)
  qrBackText.textContent = "Voltar";
  qrCancelBtn.style.display = 'inline-flex';
  qrBackBtn.onclick = () => {
    startScannerForOffer();
  };

  webrtcManager = new WebRTCManager(getWebRTCEvents());
  try {
    const answerBase64 = await webrtcManager.acceptOfferAndCreateAnswer(offerStr);
    const payload = 'ANS:' + answerBase64;
    await renderQRCodeToCanvas(qrCanvas, payload);
    
    qrDisplayTitle.textContent = "Passo 2: Escaneie no Transmissor";
    qrInstruction.textContent = "No Transmissor, clique em Avançar e aponte a câmera para este QR Code.";
  } catch (err) {
    showDialog("Falha ao aceitar oferta.", "Erro");
    cleanupAndGoHome();
  }
}

function startScannerForAnswer() {
  showView(scannerSection);
  scannerTitle.textContent = "Escaneando Resposta";
  scannerInstruction.textContent = "Aponte a câmera para o QR Code gerado pelo Receptor.";
  
  // Configura botões no Passo 2 (Remetente - tem Voltar e Cancelar)
  scannerBackText.textContent = "Voltar";
  scannerCancelBtn.style.display = 'inline-flex';
  scannerBackBtn.onclick = () => {
    if (scanner) scanner.stop();
    showView(qrDisplaySection);
  };

  if (!scanner) scanner = new ScannerEngine();
  scanner.onDataDecoded = async (results) => {
    const data = results[0];
    if (data.startsWith('ANS:')) {
      scanner!.stop();
      audioBeep();
      try {
        await webrtcManager!.acceptAnswer(data.substring(4));
        scannerInstruction.textContent = "Conectando P2P...";
      } catch (e) {
        showDialog("Falha ao processar resposta", "Erro");
        cleanupAndGoHome();
      }
    }
  };
  scanner.start(scannerVideo).catch(() => showDialog("Erro na câmera"));
}

function getWebRTCEvents() {
  return {
    onConnectionStateChange: (state: RTCPeerConnectionState) => {
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        if (isConnectionEstablished) {
          isConnectionEstablished = false;
          showDialog("Conexão P2P foi interrompida.");
          cleanupAndGoHome();
        }
      }
    },
    onDataChannelOpen: () => {
      isConnectionEstablished = true;
      if (scanner) scanner.stop();
      showView(transferSection);
      
      transferProgressWrapper.style.display = 'none';
      receivedTextContainer.style.display = 'none';
      sendMoreContainer.style.display = 'none';
      downloadButtonsContainer.innerHTML = '';
      
      if (currentRole === 'sender') {
        if (isTextTransfer) {
          transferHeading.textContent = "Texto Enviado!";
          transferStatus.textContent = "O texto foi transmitido com sucesso.";
          webrtcManager!.sendText(textInput.value);
          sendMoreContainer.style.display = 'flex';
        } else {
          transferHeading.textContent = "Conexão Estabelecida";
          transferProgressWrapper.style.display = 'block';
          currentFileIndex = 0;
          sendNextFile();
        }
      } else {
        transferHeading.textContent = "Conexão Estabelecida";
        transferStatus.textContent = "Aguardando transmissão...";
      }
    },
    onDataChannelClose: () => {
      if (currentRole === 'sender') {
        // Silent close
      }
    },
    onFileProgress: (bytesReceived: number, totalBytes: number) => {
      if (currentRole === 'receiver') {
        transferProgressWrapper.style.display = 'block';
        transferHeading.textContent = "Recebendo Arquivo...";
        updateProgress(bytesReceived, totalBytes);
      }
    },
    onFileComplete: (file: File) => {
      transferHeading.textContent = "Arquivo Recebido!";
      transferStatus.textContent = `O arquivo "${file.name}" foi recebido com sucesso.`;
      transferProgressFill.style.width = '100%';
      transferProgressText.textContent = '100%';
      transferBytesText.textContent = `${formatBytes(file.size)} / ${formatBytes(file.size)}`;
      
      const fileUrl = URL.createObjectURL(file);
      downloadedFileUrls.push(fileUrl);
      
      const btn = document.createElement('button');
      btn.className = 'btn full-width-btn';
      btn.style.background = 'var(--accent-primary)';
      btn.textContent = `Salvar ${file.name}`;
      btn.onclick = () => {
        const a = document.createElement('a');
        a.href = fileUrl;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      };
      
      downloadButtonsContainer.appendChild(btn);
    },
    onTextMessage: (text: string) => {
      transferHeading.textContent = "Mensagem Recebida!";
      transferStatus.textContent = "O Transmissor enviou um texto.";
      receivedTextContainer.style.display = 'block';
      receivedTextContent.textContent = text;
    }
  };
}

async function sendNextFile() {
  if (!webrtcManager || currentRole !== 'sender' || isTextTransfer) return;
  
  if (currentFileIndex >= selectedFiles.length) {
    transferHeading.textContent = "Arquivo(s) Enviado(s)!";
    transferStatus.textContent = "Todos os arquivos foram transmitidos com sucesso.";
    sendMoreContainer.style.display = 'flex';
    return;
  }
  
  const file = selectedFiles[currentFileIndex];
  transferHeading.textContent = "Enviando Arquivo...";
  transferStatus.textContent = `Enviando ${currentFileIndex + 1} de ${selectedFiles.length}: ${file.name}`;
  
  try {
    await webrtcManager.sendFile(file, updateProgress);
    currentFileIndex++;
    sendNextFile(); // Start next file
  } catch (err) {
    showDialog("Erro ao enviar o arquivo: " + file.name);
    cleanupAndGoHome();
  }
}

function updateProgress(bytes: number, total: number) {
  const pct = total > 0 ? Math.round((bytes / total) * 100) : 0;
  transferProgressFill.style.width = `${pct}%`;
  transferProgressText.textContent = `${pct}%`;
  transferBytesText.textContent = `${formatBytes(bytes)} / ${formatBytes(total)}`;
}

function showView(section: HTMLElement) {
  homeSection.classList.remove('active');
  scannerSection.classList.remove('active');
  qrDisplaySection.classList.remove('active');
  transferSection.classList.remove('active');
  section.classList.add('active');
}

function cleanupAndGoHome() {
  if (scanner) {
    scanner.stop();
  }
  if (webrtcManager) {
    webrtcManager.destroy();
    webrtcManager = null;
  }
  downloadedFileUrls.forEach(url => URL.revokeObjectURL(url));
  downloadedFileUrls = [];
  
  currentRole = null;
  isTextTransfer = false;
  isConnectionEstablished = false;
  downloadButtonsContainer.innerHTML = '';
  transferProgressFill.style.width = '0%';
  transferProgressText.textContent = '0%';
  transferBytesText.textContent = '0 / 0 MB';
  receivedTextContainer.style.display = 'none';
  sendMoreContainer.style.display = 'none';
  
  selectedFiles = [];
  textInput.value = '';
  sendTextBtn.style.display = 'none';
  fileInput.value = '';
  updateFileListUI();
  
  showView(homeSection);
}

function audioBeep() {
  try {
    const actx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = actx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, actx.currentTime);
    osc.connect(actx.destination);
    osc.start();
    osc.stop(actx.currentTime + 0.1);
  } catch (e) {}
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

document.addEventListener('DOMContentLoaded', init);
