export type WebRTCEvents = {
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
  onDataChannelOpen: () => void;
  onDataChannelClose: () => void;
  onFileProgress: (bytesReceived: number, totalBytes: number) => void;
  onFileComplete: (file: File) => void;
  onTextMessage: (text: string) => void;
  onRemoteDisconnect: () => void;
};

export class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private events: WebRTCEvents;

  // Receiving state
  private receiveBuffer: Uint8Array[] = [];
  private receivedBytes: number = 0;
  private expectedBytes: number = 0;
  private receivingFileName: string = '';
  private receivingFileType: string = '';

  constructor(events: WebRTCEvents) {
    this.events = events;
  }

  private initPC() {
    this.destroy(); // Garantir limpeza profunda de conexões anteriores
    this.pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
      ],
      iceCandidatePoolSize: 10
    });

    this.pc.onconnectionstatechange = () => {
      if (this.pc) {
        this.events.onConnectionStateChange(this.pc.connectionState);
      }
    };

    this.pc.ondatachannel = (event) => {
      this.setupDataChannel(event.channel);
    };
  }

  private setupDataChannel(channel: RTCDataChannel) {
    this.dc = channel;
    this.dc.binaryType = 'arraybuffer';
    this.dc.bufferedAmountLowThreshold = 256 * 1024; // 256 KB

    this.dc.onopen = () => {
      this.events.onDataChannelOpen();
    };

    this.dc.onclose = () => {
      this.events.onDataChannelClose();
    };

    this.dc.onerror = () => {
      this.events.onDataChannelClose();
    };

    this.dc.onmessage = (event) => {
      this.handleIncomingData(event.data);
    };
  }

  public async createOffer(): Promise<string> {
    this.initPC();
    
    const channel = this.pc!.createDataChannel('fileTransfer', {
      ordered: true
    });
    this.setupDataChannel(channel);

    const offer = await this.pc!.createOffer();
    await this.pc!.setLocalDescription(offer);

    await this.waitForIceGathering();

    return JSON.stringify(this.pc!.localDescription);
  }

  public async acceptOfferAndCreateAnswer(offerSdpStr: string): Promise<string> {
    this.initPC();
    
    const offerSdp = JSON.parse(offerSdpStr);
    await this.pc!.setRemoteDescription(offerSdp);
    
    const answer = await this.pc!.createAnswer();
    await this.pc!.setLocalDescription(answer);

    await this.waitForIceGathering();

    return JSON.stringify(this.pc!.localDescription);
  }

  public async acceptAnswer(answerSdpStr: string): Promise<void> {
    if (!this.pc) throw new Error('PeerConnection não inicializado');
    const answerSdp = JSON.parse(answerSdpStr);
    await this.pc.setRemoteDescription(answerSdp);
  }

  private waitForIceGathering(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.pc || this.pc.iceGatheringState === 'complete') {
        resolve();
      } else {
        const checkState = () => {
          if (this.pc && this.pc.iceGatheringState === 'complete') {
            this.pc.removeEventListener('icegatheringstatechange', checkState);
            resolve();
          }
        };
        this.pc.addEventListener('icegatheringstatechange', checkState);
        // Timeout de segurança para caso ICE gathering demore
        setTimeout(() => {
          if (this.pc) this.pc.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }, 3000);
      }
    });
  }

  public sendText(text: string) {
    if (!this.dc || this.dc.readyState !== 'open') throw new Error('Canal de dados não está aberto');
    const meta = JSON.stringify({
      isText: true,
      content: text
    });
    this.dc.send(meta);
  }

  public sendDisconnectSignal() {
    if (this.dc && this.dc.readyState === 'open') {
      try {
        this.dc.send(JSON.stringify({ isDisconnect: true }));
      } catch (e) {}
    }
  }

  /**
   * Envia arquivo em chunks de 64KB com controle estrito de buffer (evita travamento em 0%)
   */
  public async sendFile(file: File, onProgress: (sent: number, total: number) => void): Promise<void> {
    if (!this.dc || this.dc.readyState !== 'open') {
      throw new Error('Canal de dados não está aberto');
    }

    // Enviar metadados do arquivo
    const meta = JSON.stringify({
      name: file.name,
      size: file.size,
      type: file.type
    });
    this.dc.send(meta);

    const chunkSize = 64 * 1024; // 64 KB (padrão cruzado mais estável para WebRTC DataChannel)
    const totalBytes = file.size;
    let offset = 0;

    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      const sendNextChunk = () => {
        if (!this.dc || this.dc.readyState !== 'open') {
          reject(new Error('Canal de dados fechado durante a transferência'));
          return;
        }

        // Controle rigoroso de backpressure (limiar de 256KB em buffer)
        if (this.dc.bufferedAmount > 256 * 1024) {
          this.dc.onbufferedamountlow = () => {
            if (this.dc) this.dc.onbufferedamountlow = null;
            sendNextChunk();
          };
          return;
        }

        const slice = file.slice(offset, offset + chunkSize);
        reader.readAsArrayBuffer(slice);
      };

      reader.onload = () => {
        if (!this.dc || this.dc.readyState !== 'open') {
          reject(new Error('Canal de dados fechado durante a transferência'));
          return;
        }

        try {
          const buffer = reader.result as ArrayBuffer;
          this.dc.send(buffer);
          offset += buffer.byteLength;
          onProgress(offset, totalBytes);

          if (offset < totalBytes) {
            sendNextChunk();
          } else {
            resolve();
          }
        } catch (e) {
          reject(e);
        }
      };

      reader.onerror = () => reject(reader.error);

      sendNextChunk();
    });
  }

  private handleIncomingData(data: string | ArrayBuffer) {
    if (typeof data === 'string') {
      try {
        const meta = JSON.parse(data);
        if (meta.isDisconnect) {
          this.events.onRemoteDisconnect();
          return;
        }
        if (meta.isText) {
          this.events.onTextMessage(meta.content);
        } else {
          // Metadados de novo arquivo
          this.receivingFileName = meta.name;
          this.expectedBytes = meta.size;
          this.receivingFileType = meta.type;
          this.receivedBytes = 0;
          this.receiveBuffer = [];
          this.events.onFileProgress(0, this.expectedBytes);
        }
      } catch (e) {}
    } else {
      // Chunk binário
      const u8 = new Uint8Array(data);
      this.receiveBuffer.push(u8);
      this.receivedBytes += u8.byteLength;
      this.events.onFileProgress(this.receivedBytes, this.expectedBytes);

      if (this.receivedBytes >= this.expectedBytes) {
        // Remontar arquivo recebido
        const blob = new Blob(this.receiveBuffer as unknown as BlobPart[], { type: this.receivingFileType });
        const file = new File([blob], this.receivingFileName, { type: this.receivingFileType });
        this.events.onFileComplete(file);
        
        // Limpar memória do buffer recebido
        this.receiveBuffer = [];
        this.receivedBytes = 0;
        this.expectedBytes = 0;
      }
    }
  }

  /**
   * Limpeza profunda de memória RAM e desconexão de socket/data channel
   */
  public destroy() {
    if (this.dc) {
      try {
        this.dc.onopen = null;
        this.dc.onclose = null;
        this.dc.onerror = null;
        this.dc.onmessage = null;
        this.dc.close();
      } catch (e) {}
      this.dc = null;
    }
    if (this.pc) {
      try {
        this.pc.onconnectionstatechange = null;
        this.pc.ondatachannel = null;
        this.pc.close();
      } catch (e) {}
      this.pc = null;
    }
    this.receiveBuffer = [];
    this.receivedBytes = 0;
    this.expectedBytes = 0;
    this.receivingFileName = '';
    this.receivingFileType = '';
  }
}
