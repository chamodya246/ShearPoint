/**
 * ShearPoint - WebRTC P2P File Transfer Application
 * app.js - Main application logic with WebRTC, file transfer, and device discovery
 */

class ShearPointApp {
  constructor() {
    this.peerConnections = new Map();
    this.datachannels = new Map();
    this.localStream = null;
    this.signalingServer = null;
    this.userId = this.generateUserId();
    this.devices = new Map();
    this.fileTransfers = new Map();
    this.config = {
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302'] },
        { urls: ['stun:stun1.l.google.com:19302'] },
        { urls: ['stun:stun2.l.google.com:19302'] }
      ]
    };
    
    this.initializeEventListeners();
    this.setupSignalingConnection();
  }

  /**
   * Generate a unique user ID
   */
  generateUserId() {
    return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Initialize UI event listeners
   */
  initializeEventListeners() {
    // File input handler
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
    }

    // Send file button
    const sendBtn = document.getElementById('sendFileBtn');
    if (sendBtn) {
      sendBtn.addEventListener('click', () => this.sendFile());
    }

    // Device list
    const deviceList = document.getElementById('deviceList');
    if (deviceList) {
      deviceList.addEventListener('click', (e) => this.handleDeviceClick(e));
    }

    // Drag and drop
    const dropZone = document.getElementById('dropZone');
    if (dropZone) {
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, this.preventDefaults, false);
      });
      dropZone.addEventListener('drop', (e) => this.handleDrop(e), false);
    }
  }

  /**
   * Setup WebSocket connection to signaling server
   */
  setupSignalingConnection() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const signalingUrl = `${protocol}//${window.location.host}/signal`;
    
    this.signalingServer = new WebSocket(signalingUrl);
    
    this.signalingServer.onopen = () => {
      console.log('Connected to signaling server');
      this.announcePresence();
      this.startDeviceDiscovery();
    };

    this.signalingServer.onmessage = (event) => {
      this.handleSignalingMessage(JSON.parse(event.data));
    };

    this.signalingServer.onerror = (error) => {
      console.error('Signaling connection error:', error);
      this.updateStatus('Connection error', 'error');
    };

    this.signalingServer.onclose = () => {
      console.log('Disconnected from signaling server');
      this.updateStatus('Disconnected', 'warning');
      // Attempt to reconnect after 3 seconds
      setTimeout(() => this.setupSignalingConnection(), 3000);
    };
  }

  /**
   * Announce presence to other peers
   */
  announcePresence() {
    this.sendSignalingMessage({
      type: 'announce',
      userId: this.userId,
      deviceName: this.getDeviceName(),
      timestamp: Date.now()
    });
  }

  /**
   * Get device name
   */
  getDeviceName() {
    return localStorage.getItem('deviceName') || `Device_${this.userId.slice(-4)}`;
  }

  /**
   * Start device discovery
   */
  startDeviceDiscovery() {
    // Send periodic discovery beacon
    setInterval(() => {
      if (this.signalingServer && this.signalingServer.readyState === WebSocket.OPEN) {
        this.sendSignalingMessage({
          type: 'discover',
          userId: this.userId,
          timestamp: Date.now()
        });
      }
    }, 5000);
  }

  /**
   * Handle signaling messages from server
   */
  handleSignalingMessage(message) {
    switch (message.type) {
      case 'peer-list':
        this.updatePeerList(message.peers);
        break;
      case 'offer':
        this.handleOffer(message);
        break;
      case 'answer':
        this.handleAnswer(message);
        break;
      case 'ice-candidate':
        this.handleIceCandidate(message);
        break;
      case 'peer-announced':
        this.addDevice(message);
        break;
      case 'peer-disconnected':
        this.removeDevice(message.userId);
        break;
      default:
        console.log('Unknown message type:', message.type);
    }
  }

  /**
   * Update peer list
   */
  updatePeerList(peers) {
    peers.forEach(peer => {
      if (peer.userId !== this.userId && !this.devices.has(peer.userId)) {
        this.addDevice(peer);
      }
    });
  }

  /**
   * Add device to discovered devices list
   */
  addDevice(deviceInfo) {
    const userId = deviceInfo.userId;
    
    if (userId === this.userId) return;
    
    this.devices.set(userId, {
      userId,
      deviceName: deviceInfo.deviceName || `Device_${userId.slice(-4)}`,
      timestamp: deviceInfo.timestamp || Date.now(),
      status: 'discovered'
    });
    
    this.renderDeviceList();
  }

  /**
   * Remove device from discovered devices list
   */
  removeDevice(userId) {
    this.devices.delete(userId);
    if (this.peerConnections.has(userId)) {
      this.closePeerConnection(userId);
    }
    this.renderDeviceList();
  }

  /**
   * Render device list in UI
   */
  renderDeviceList() {
    const deviceList = document.getElementById('deviceList');
    if (!deviceList) return;

    deviceList.innerHTML = '';
    
    this.devices.forEach((device, userId) => {
      const item = document.createElement('div');
      item.className = 'device-item';
      item.setAttribute('data-user-id', userId);
      
      const statusClass = this.peerConnections.has(userId) ? 'connected' : 'discovered';
      const statusText = this.peerConnections.has(userId) ? '● Connected' : '● Available';
      
      item.innerHTML = `
        <div class="device-info">
          <div class="device-name">${this.escapeHtml(device.deviceName)}</div>
          <div class="device-status ${statusClass}">${statusText}</div>
        </div>
        <button class="device-action" onclick="app.toggleConnection('${userId}')">
          ${this.peerConnections.has(userId) ? 'Disconnect' : 'Connect'}
        </button>
      `;
      
      deviceList.appendChild(item);
    });

    if (this.devices.size === 0) {
      deviceList.innerHTML = '<div class="no-devices">No devices discovered yet</div>';
    }
  }

  /**
   * Toggle connection with a peer
   */
  async toggleConnection(userId) {
    if (this.peerConnections.has(userId)) {
      this.closePeerConnection(userId);
    } else {
      await this.initiatePeerConnection(userId);
    }
  }

  /**
   * Handle device click
   */
  handleDeviceClick(event) {
    const deviceItem = event.target.closest('.device-item');
    if (deviceItem && !event.target.classList.contains('device-action')) {
      const userId = deviceItem.getAttribute('data-user-id');
      this.toggleConnection(userId);
    }
  }

  /**
   * Initiate peer connection
   */
  async initiatePeerConnection(userId) {
    try {
      if (this.peerConnections.has(userId)) {
        console.log('Connection already exists with', userId);
        return;
      }

      const peerConnection = new RTCPeerConnection({ iceServers: this.config.iceServers });
      this.peerConnections.set(userId, peerConnection);

      // Setup event handlers
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendSignalingMessage({
            type: 'ice-candidate',
            candidate: event.candidate,
            fromUserId: this.userId,
            toUserId: userId
          });
        }
      };

      peerConnection.onconnectionstatechange = () => {
        this.handleConnectionStateChange(userId, peerConnection);
      };

      peerConnection.ondatachannel = (event) => {
        this.setupDataChannel(userId, event.channel);
      };

      // Create data channels
      const fileDataChannel = peerConnection.createDataChannel('file-transfer', {
        ordered: true
      });
      this.setupDataChannel(userId, fileDataChannel);

      // Create offer
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      this.sendSignalingMessage({
        type: 'offer',
        offer: offer,
        fromUserId: this.userId,
        toUserId: userId
      });

      this.updateStatus(`Initiating connection with ${this.devices.get(userId)?.deviceName || userId}`, 'info');
    } catch (error) {
      console.error('Error initiating peer connection:', error);
      this.updateStatus('Connection error', 'error');
    }
  }

  /**
   * Handle offer from peer
   */
  async handleOffer(message) {
    const { fromUserId, offer } = message;

    try {
      if (!this.peerConnections.has(fromUserId)) {
        const peerConnection = new RTCPeerConnection({ iceServers: this.config.iceServers });
        this.peerConnections.set(fromUserId, peerConnection);

        peerConnection.onicecandidate = (event) => {
          if (event.candidate) {
            this.sendSignalingMessage({
              type: 'ice-candidate',
              candidate: event.candidate,
              fromUserId: this.userId,
              toUserId: fromUserId
            });
          }
        };

        peerConnection.onconnectionstatechange = () => {
          this.handleConnectionStateChange(fromUserId, peerConnection);
        };

        peerConnection.ondatachannel = (event) => {
          this.setupDataChannel(fromUserId, event.channel);
        };
      }

      const peerConnection = this.peerConnections.get(fromUserId);
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      this.sendSignalingMessage({
        type: 'answer',
        answer: answer,
        fromUserId: this.userId,
        toUserId: fromUserId
      });
    } catch (error) {
      console.error('Error handling offer:', error);
    }
  }

  /**
   * Handle answer from peer
   */
  async handleAnswer(message) {
    const { fromUserId, answer } = message;

    try {
      const peerConnection = this.peerConnections.get(fromUserId);
      if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      }
    } catch (error) {
      console.error('Error handling answer:', error);
    }
  }

  /**
   * Handle ICE candidate
   */
  async handleIceCandidate(message) {
    const { fromUserId, candidate } = message;

    try {
      const peerConnection = this.peerConnections.get(fromUserId);
      if (peerConnection && candidate) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (error) {
      console.error('Error handling ICE candidate:', error);
    }
  }

  /**
   * Handle connection state change
   */
  handleConnectionStateChange(userId, peerConnection) {
    const state = peerConnection.connectionState;
    const device = this.devices.get(userId);

    console.log(`Connection state with ${userId}: ${state}`);

    switch (state) {
      case 'connected':
        if (device) {
          this.updateStatus(`Connected to ${device.deviceName}`, 'success');
        }
        this.renderDeviceList();
        break;
      case 'disconnected':
      case 'closed':
      case 'failed':
        this.closePeerConnection(userId);
        break;
    }
  }

  /**
   * Setup data channel
   */
  setupDataChannel(userId, dataChannel) {
    dataChannel.onopen = () => {
      console.log(`Data channel opened with ${userId}`);
    };

    dataChannel.onmessage = (event) => {
      this.handleDataChannelMessage(userId, event.data);
    };

    dataChannel.onerror = (error) => {
      console.error(`Data channel error with ${userId}:`, error);
    };

    dataChannel.onclose = () => {
      console.log(`Data channel closed with ${userId}`);
    };

    this.datachannels.set(userId, dataChannel);
  }

  /**
   * Handle data channel message
   */
  handleDataChannelMessage(userId, data) {
    try {
      // Parse message based on type
      if (data instanceof ArrayBuffer) {
        // Binary file data
        this.handleFileChunk(userId, data);
      } else if (typeof data === 'string') {
        const message = JSON.parse(data);
        
        switch (message.type) {
          case 'file-start':
            this.handleFileStart(userId, message);
            break;
          case 'file-chunk':
            this.handleFileChunk(userId, message);
            break;
          case 'file-complete':
            this.handleFileComplete(userId, message);
            break;
          case 'file-error':
            this.handleFileError(userId, message);
            break;
        }
      }
    } catch (error) {
      console.error('Error handling data channel message:', error);
    }
  }

  /**
   * Handle file select
   */
  handleFileSelect(event) {
    const files = event.target.files;
    if (files.length > 0) {
      const file = files[0];
      this.displayFileInfo(file);
    }
  }

  /**
   * Handle drag and drop
   */
  handleDrop(event) {
    const files = event.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      this.displayFileInfo(file);
      // Update file input
      const fileInput = document.getElementById('fileInput');
      if (fileInput) {
        fileInput.files = files;
      }
    }
  }

  /**
   * Display file info
   */
  displayFileInfo(file) {
    const fileInfo = document.getElementById('fileInfo');
    if (fileInfo) {
      fileInfo.innerHTML = `
        <div class="file-info-content">
          <div class="file-name">${this.escapeHtml(file.name)}</div>
          <div class="file-size">${this.formatFileSize(file.size)}</div>
        </div>
      `;
    }
  }

  /**
   * Send file
   */
  async sendFile() {
    const fileInput = document.getElementById('fileInput');
    if (!fileInput || fileInput.files.length === 0) {
      this.updateStatus('Please select a file', 'warning');
      return;
    }

    const file = fileInput.files[0];
    const selectedDevice = this.getSelectedDevice();

    if (!selectedDevice) {
      this.updateStatus('Please select a device to send to', 'warning');
      return;
    }

    const dataChannel = this.datachannels.get(selectedDevice);
    if (!dataChannel || dataChannel.readyState !== 'open') {
      this.updateStatus('Connection not ready', 'error');
      return;
    }

    await this.transferFile(selectedDevice, file);
  }

  /**
   * Transfer file to peer
   */
  async transferFile(userId, file) {
    const transferId = `transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const chunkSize = 65536; // 64KB chunks
    let offset = 0;

    const fileTransfer = {
      id: transferId,
      fileName: file.name,
      fileSize: file.size,
      sent: 0,
      startTime: Date.now()
    };

    this.fileTransfers.set(transferId, fileTransfer);

    const dataChannel = this.datachannels.get(userId);

    try {
      // Send file start message
      dataChannel.send(JSON.stringify({
        type: 'file-start',
        transferId,
        fileName: file.name,
        fileSize: file.size,
        timestamp: Date.now()
      }));

      this.updateStatus(`Sending ${file.name} to ${this.devices.get(userId)?.deviceName}...`, 'info');

      // Send file in chunks
      while (offset < file.size) {
        const chunk = file.slice(offset, offset + chunkSize);
        const arrayBuffer = await chunk.arrayBuffer();
        
        dataChannel.send(arrayBuffer);

        offset += chunkSize;
        fileTransfer.sent = offset;

        // Update progress
        const progress = (offset / file.size) * 100;
        this.updateTransferProgress(transferId, progress);

        // Throttle to prevent overwhelming the connection
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Send completion message
      dataChannel.send(JSON.stringify({
        type: 'file-complete',
        transferId,
        timestamp: Date.now()
      }));

      const duration = (Date.now() - fileTransfer.startTime) / 1000;
      this.updateStatus(`File sent successfully in ${duration.toFixed(2)}s`, 'success');
      this.fileTransfers.delete(transferId);
      
      // Clear file input
      document.getElementById('fileInput').value = '';
      document.getElementById('fileInfo').innerHTML = '';

    } catch (error) {
      console.error('Error transferring file:', error);
      dataChannel.send(JSON.stringify({
        type: 'file-error',
        transferId,
        error: error.message
      }));
      this.updateStatus('File transfer failed', 'error');
    }
  }

  /**
   * Handle file start
   */
  handleFileStart(userId, message) {
    const { transferId, fileName, fileSize } = message;
    const device = this.devices.get(userId);
    
    const fileTransfer = {
      id: transferId,
      fileName,
      fileSize,
      received: 0,
      chunks: [],
      startTime: Date.now()
    };

    this.fileTransfers.set(transferId, fileTransfer);
    this.updateStatus(`Receiving ${fileName} from ${device?.deviceName}...`, 'info');
  }

  /**
   * Handle file chunk
   */
  handleFileChunk(userId, chunkData) {
    // Find the active transfer
    let transfer = null;
    let transferId = null;

    for (const [id, t] of this.fileTransfers) {
      if (t.chunks !== undefined) { // Receiving transfer
        transfer = t;
        transferId = id;
        break;
      }
    }

    if (!transfer) return;

    if (chunkData instanceof ArrayBuffer) {
      transfer.chunks.push(new Uint8Array(chunkData));
      transfer.received += chunkData.byteLength;
    } else if (typeof chunkData === 'object') {
      transfer.received += chunkData.size || 0;
    }

    const progress = (transfer.received / transfer.fileSize) * 100;
    this.updateTransferProgress(transferId, progress);
  }

  /**
   * Handle file complete
   */
  handleFileComplete(userId, message) {
    const { transferId } = message;
    const transfer = this.fileTransfers.get(transferId);

    if (!transfer) return;

    // Reconstruct file from chunks
    const blob = new Blob(transfer.chunks, { type: 'application/octet-stream' });
    
    // Download file
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = transfer.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const duration = (Date.now() - transfer.startTime) / 1000;
    this.updateStatus(`File received: ${transfer.fileName} (${duration.toFixed(2)}s)`, 'success');
    this.fileTransfers.delete(transferId);
  }

  /**
   * Handle file error
   */
  handleFileError(userId, message) {
    const { transferId, error } = message;
    this.updateStatus(`File transfer error: ${error}`, 'error');
    this.fileTransfers.delete(transferId);
  }

  /**
   * Update transfer progress
   */
  updateTransferProgress(transferId, progress) {
    const progressBar = document.getElementById(`progress_${transferId}`);
    if (progressBar) {
      progressBar.style.width = `${progress}%`;
    }

    // Also update in status
    const percent = progress.toFixed(0);
    console.log(`Transfer ${transferId}: ${percent}%`);
  }

  /**
   * Get selected device
   */
  getSelectedDevice() {
    const selected = document.querySelector('.device-item.selected');
    return selected ? selected.getAttribute('data-user-id') : null;
  }

  /**
   * Close peer connection
   */
  closePeerConnection(userId) {
    const peerConnection = this.peerConnections.get(userId);
    if (peerConnection) {
      peerConnection.close();
      this.peerConnections.delete(userId);
    }

    const dataChannel = this.datachannels.get(userId);
    if (dataChannel) {
      dataChannel.close();
      this.datachannels.delete(userId);
    }

    this.renderDeviceList();
  }

  /**
   * Send signaling message
   */
  sendSignalingMessage(message) {
    if (this.signalingServer && this.signalingServer.readyState === WebSocket.OPEN) {
      this.signalingServer.send(JSON.stringify(message));
    }
  }

  /**
   * Update status message
   */
  updateStatus(message, type = 'info') {
    const statusElement = document.getElementById('status');
    if (statusElement) {
      statusElement.textContent = message;
      statusElement.className = `status status-${type}`;
    }
    console.log(`[${type.toUpperCase()}] ${message}`);
  }

  /**
   * Prevent default drag and drop behavior
   */
  preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  /**
   * Format file size
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Escape HTML
   */
  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  /**
   * Cleanup
   */
  destroy() {
    // Close all peer connections
    this.peerConnections.forEach((pc, userId) => {
      this.closePeerConnection(userId);
    });

    // Close signaling connection
    if (this.signalingServer) {
      this.signalingServer.close();
    }
  }
}

// Initialize app when DOM is ready
let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new ShearPointApp();
  console.log('ShearPoint App initialized');
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (app) {
    app.destroy();
  }
});
