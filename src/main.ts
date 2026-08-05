import { WebRTCManager } from './webrtc';
import { ScannerEngine } from './receiver/qrScanner';
import { renderQRCodeToCanvas } from './transmitter/qrGenerator';

// Estado global
let webrtcManager: WebRTCManager | null = null;
let scanner: ScannerEngine | null = null;
let selectedFile: File | null = null;
let currentRole: 'sender' | 'receiver' | null = null;
let downloadedFileUrl: string | null = null;

// Elementos DOM
const homeSection = document.getElementById('home-section') as HTMLElement;
const scannerSection = document.getElementById('scanner-section') as HTMLElement;
const qrDisplaySection = document.getElementById('qr-display-section') as HTMLElement;
const transferSection = document.getElementById('transfer-section') as HTMLElement;
const killSwitchBtn = document.getElementById('kill-switch-btn') as HTMLButtonElement;

// Inputs & Previews
const fileDropzone = document.getElementById('file-dropzone') as HTMLElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const filePreviewContainer = document.getElementById('file-preview-container') as HTMLElement;
const selectedFileName = document.getElementById('selected-file-name') as HTMLElement;
const removeFileBtn = document.getElementById('remove-file-btn') as HTMLButtonElement;
const startTransferBtn = document.getElementById('start-transfer-btn') as HTMLButtonElement;
const receiveModeBtn = document.getElementById('receive-mode-btn') as HTMLButtonElement;

// Scanner
const scannerVideo = document.getElementById('scanner-video') as HTMLVideoElement;
const scannerBackBtn = document.getElementById('scanner-back-btn') as HTMLButtonElement;
const scannerTitle = document.getElementById('scanner-title') as HTMLElement;
const scannerInstruction = document.getElementById('scanner-instruction') as HTMLElement;

// QR Display
const qrCanvas = document.getElementById('qr-canvas') as HTMLCanvasElement;
const qrBackBtn = document.getElementById('qr-back-btn') as HTMLButtonElement;
const qrDisplayTitle = document.getElementById('qr-display-title') as HTMLElement;
const qrInstruction = document.getElementById('qr-instruction') as HTMLElement;
const qrNextActionBtn = document.getElementById('qr-next-action-btn') as HTMLButtonElement;

// Transferência
const transferProgressFill = document.getElementById('transfer-progress-fill') as HTMLElement;
const transferProgressText = document.getElementById('transfer-progress-text') as HTMLElement;
const transferBytesText = document.getElementById('transfer-bytes-text') as HTMLElement;
const transferStatus = document.getElementById('transfer-status') as HTMLElement;
const transferDownloadBtn = document.getElementById('transfer-download-btn') as HTMLButtonElement;

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

function init() {
  appDialogOkBtn.onclick = () => appDialogModal.style.display = 'none';
  
  // File selection
  fileDropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const files = (e.target as HTMLInputElement).files;
    if (files && files.length > 0) {
      selectedFile = files[0];
      selectedFileName.textContent = selectedFile.name;
      fileDropzone.style.display = 'none';
      filePreviewContainer.style.display = 'block';
    }
  });

  removeFileBtn.addEventListener('click', () => {
    selectedFile = null;
    fileInput.value = '';
    fileDropzone.style.display = 'flex';
    filePreviewContainer.style.display = 'none';
  });

  // Start Sender Flow
  startTransferBtn.addEventListener('click', async () => {
    if (!selectedFile) return;
    currentRole = 'sender';
    killSwitchBtn.style.display = 'block';
    showView(qrDisplaySection);
    qrDisplayTitle.textContent = "Passo 1: Criando Oferta...";
    qrInstruction.textContent = "Aguarde a geração do QR Code...";
    qrNextActionBtn.style.display = 'none';

    webrtcManager = new WebRTCManager(getWebRTCEvents());
    try {
      const offerBase64 = await webrtcManager.createOffer();
      // Add prefix so receiver knows it's an offer
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
  });

  // Start Receiver Flow
  receiveModeBtn.addEventListener('click', () => {
    currentRole = 'receiver';
    killSwitchBtn.style.display = 'block';
    startScannerForOffer();
  });

  // Navigations back
  scannerBackBtn.addEventListener('click', cleanupAndGoHome);
  qrBackBtn.addEventListener('click', cleanupAndGoHome);
  killSwitchBtn.addEventListener('click', cleanupAndGoHome);
}

function startScannerForOffer() {
  showView(scannerSection);
  scannerTitle.textContent = "Escaneando Oferta";
  scannerInstruction.textContent = "Aponte a câmera para o QR Code de Oferta gerado pelo Transmissor.";
  
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

  webrtcManager = new WebRTCManager(getWebRTCEvents());
  try {
    const answerBase64 = await webrtcManager.acceptOfferAndCreateAnswer(offerStr);
    const payload = 'ANS:' + answerBase64;
    await renderQRCodeToCanvas(qrCanvas, payload);
    
    qrDisplayTitle.textContent = "Passo 2: Escaneie no Transmissor";
    qrInstruction.textContent = "No Transmissor, clique em Avançar e aponte a câmera para este QR Code.";
    // No next button for receiver, they just wait for data channel to open
  } catch (err) {
    showDialog("Falha ao aceitar oferta.", "Erro");
    cleanupAndGoHome();
  }
}

function startScannerForAnswer() {
  showView(scannerSection);
  scannerTitle.textContent = "Escaneando Resposta";
  scannerInstruction.textContent = "Aponte a câmera para o QR Code gerado pelo Receptor.";
  
  if (!scanner) scanner = new ScannerEngine();
  scanner.onDataDecoded = async (results) => {
    const data = results[0];
    if (data.startsWith('ANS:')) {
      scanner!.stop();
      audioBeep();
      try {
        await webrtcManager!.acceptAnswer(data.substring(4));
        // Waiting for data channel to open automatically
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
        if (currentRole) {
          showDialog("Conexão P2P foi interrompida.");
          cleanupAndGoHome();
        }
      }
    },
    onDataChannelOpen: () => {
      // Both sides switch to transfer view
      if (scanner) scanner.stop();
      showView(transferSection);
      
      if (currentRole === 'sender' && selectedFile) {
        transferStatus.textContent = "Enviando " + selectedFile.name;
        webrtcManager!.sendFile(selectedFile, updateProgress).catch(() => {
          showDialog("Erro durante o envio.");
          cleanupAndGoHome();
        });
      } else {
        transferStatus.textContent = "Aguardando início do recebimento...";
      }
    },
    onDataChannelClose: () => {
      if (currentRole === 'sender') {
        showDialog("Envio concluído e canal fechado.");
        cleanupAndGoHome();
      }
    },
    onFileProgress: (bytesReceived: number, totalBytes: number) => {
      if (currentRole === 'receiver') {
        updateProgress(bytesReceived, totalBytes);
      }
    },
    onFileComplete: (file: File) => {
      transferStatus.textContent = "Recepção Concluída!";
      transferProgressFill.style.width = '100%';
      transferProgressText.textContent = '100%';
      transferBytesText.textContent = `${formatBytes(file.size)} / ${formatBytes(file.size)}`;
      
      transferDownloadBtn.style.display = 'block';
      if (downloadedFileUrl) URL.revokeObjectURL(downloadedFileUrl);
      downloadedFileUrl = URL.createObjectURL(file);
      
      transferDownloadBtn.onclick = () => {
        const a = document.createElement('a');
        a.href = downloadedFileUrl!;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      };
    }
  };
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
  if (downloadedFileUrl) {
    URL.revokeObjectURL(downloadedFileUrl);
    downloadedFileUrl = null;
  }
  
  currentRole = null;
  killSwitchBtn.style.display = 'none';
  transferDownloadBtn.style.display = 'none';
  transferProgressFill.style.width = '0%';
  transferProgressText.textContent = '0%';
  transferBytesText.textContent = '0 / 0 MB';
  
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
