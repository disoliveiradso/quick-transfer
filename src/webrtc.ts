import LZString from 'lz-string';

export type WebRTCEvents = {
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
  onDataChannelOpen: () => void;
  onDataChannelClose: () => void;
  onFileProgress: (bytesReceived: number, totalBytes: number) => void;
  onFileComplete: (file: File) => void;
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
    this.destroy(); // Ensure any old connection is completely wiped
    this.pc = new RTCPeerConnection({
      iceServers: [], // Strict: No STUN/TURN -> mDNS only
      iceTransportPolicy: 'all'
    });

    this.pc.onconnectionstatechange = () => {
      if (this.pc) this.events.onConnectionStateChange(this.pc.connectionState);
    };

    this.pc.ondatachannel = (event) => {
      this.setupDataChannel(event.channel);
    };
  }

  private setupDataChannel(channel: RTCDataChannel) {
    this.dc = channel;
    this.dc.binaryType = 'arraybuffer';

    this.dc.onopen = () => {
      this.events.onDataChannelOpen();
    };

    this.dc.onclose = () => {
      this.events.onDataChannelClose();
    };

    this.dc.onmessage = (event) => {
      this.handleIncomingData(event.data);
    };
  }

  public async createOffer(): Promise<string> {
    this.initPC();
    
    // Create Data Channel before offer so it's included in SDP
    const channel = this.pc!.createDataChannel('fileTransfer', {
      ordered: true
    });
    this.setupDataChannel(channel);

    const offer = await this.pc!.createOffer();
    await this.pc!.setLocalDescription(offer);

    // Wait for ICE gathering to complete to ensure mDNS candidates are in the SDP
    await this.waitForIceGathering();

    const sdpObj = {
      type: this.pc!.localDescription!.type,
      sdp: this.pc!.localDescription!.sdp
    };

    return LZString.compressToBase64(JSON.stringify(sdpObj));
  }

  public async acceptOfferAndCreateAnswer(compressedOffer: string): Promise<string> {
    this.initPC();
    
    const decompressed = LZString.decompressFromBase64(compressedOffer);
    if (!decompressed) throw new Error('Failed to decompress offer');
    const offerSdp = JSON.parse(decompressed);

    await this.pc!.setRemoteDescription(offerSdp);
    
    const answer = await this.pc!.createAnswer();
    await this.pc!.setLocalDescription(answer);

    await this.waitForIceGathering();

    const sdpObj = {
      type: this.pc!.localDescription!.type,
      sdp: this.pc!.localDescription!.sdp
    };

    return LZString.compressToBase64(JSON.stringify(sdpObj));
  }

  public async acceptAnswer(compressedAnswer: string): Promise<void> {
    if (!this.pc) throw new Error('PeerConnection not initialized');

    const decompressed = LZString.decompressFromBase64(compressedAnswer);
    if (!decompressed) throw new Error('Failed to decompress answer');
    const answerSdp = JSON.parse(decompressed);

    await this.pc.setRemoteDescription(answerSdp);
  }

  private waitForIceGathering(): Promise<void> {
    return new Promise((resolve) => {
      if (this.pc!.iceGatheringState === 'complete') {
        resolve();
      } else {
        const checkState = () => {
          if (this.pc!.iceGatheringState === 'complete') {
            this.pc!.removeEventListener('icegatheringstatechange', checkState);
            resolve();
          }
        };
        this.pc!.addEventListener('icegatheringstatechange', checkState);
      }
    });
  }

  public async sendFile(file: File, onProgress: (sent: number, total: number) => void): Promise<void> {
    if (!this.dc || this.dc.readyState !== 'open') throw new Error('Data channel is not open');

    // Send metadata
    const meta = JSON.stringify({
      name: file.name,
      size: file.size,
      type: file.type
    });
    this.dc.send(meta);

    const chunkSize = 256 * 1024; // 256 KB chunks
    const totalBytes = file.size;
    let offset = 0;

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      const sendNextChunk = () => {
        if (!this.dc || this.dc.readyState !== 'open') {
          reject(new Error('Data channel closed during transfer'));
          return;
        }

        // Backpressure check
        if (this.dc.bufferedAmount > 16 * 1024 * 1024) { // 16MB threshold
          setTimeout(sendNextChunk, 50); // wait and try again
          return;
        }

        const slice = file.slice(offset, offset + chunkSize);
        reader.readAsArrayBuffer(slice);
      };

      reader.onload = () => {
        if (!this.dc) return;
        this.dc.send(reader.result as ArrayBuffer);
        offset += (reader.result as ArrayBuffer).byteLength;
        onProgress(offset, totalBytes);

        if (offset < totalBytes) {
          // Immediately try to send next chunk (backpressure logic inside sendNextChunk will throttle if needed)
          sendNextChunk();
        } else {
          resolve();
        }
      };

      reader.onerror = () => reject(reader.error);

      sendNextChunk();
    });
  }

  private handleIncomingData(data: string | ArrayBuffer) {
    if (typeof data === 'string') {
      // Metadata
      const meta = JSON.parse(data);
      this.receivingFileName = meta.name;
      this.expectedBytes = meta.size;
      this.receivingFileType = meta.type;
      this.receivedBytes = 0;
      this.receiveBuffer = [];
      this.events.onFileProgress(0, this.expectedBytes);
    } else {
      // Binary chunk
      const u8 = new Uint8Array(data);
      this.receiveBuffer.push(u8);
      this.receivedBytes += u8.byteLength;
      this.events.onFileProgress(this.receivedBytes, this.expectedBytes);

      if (this.receivedBytes >= this.expectedBytes) {
        // Reassemble and trigger completion
        const blob = new Blob(this.receiveBuffer as unknown as BlobPart[], { type: this.receivingFileType });
        const file = new File([blob], this.receivingFileName, { type: this.receivingFileType });
        this.events.onFileComplete(file);
        
        // Clear buffer
        this.receiveBuffer = [];
        this.receivedBytes = 0;
        this.expectedBytes = 0;
      }
    }
  }

  public destroy() {
    if (this.dc) {
      this.dc.close();
      this.dc = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.receiveBuffer = [];
    this.receivedBytes = 0;
    this.expectedBytes = 0;
  }
}
