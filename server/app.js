const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const os = require('os');
const dgram = require('dgram');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Configuration
const PORT = process.env.PORT || 3000;
const DISCOVERY_PORT = process.env.DISCOVERY_PORT || 5353;
const DEVICE_TIMEOUT = 30000; // 30 seconds

// Data structures
const connectedDevices = new Map();
const webRTCPeers = new Map();
const discoveryClients = new Map();

// Create WebSocket Server
const wss = new WebSocket.Server({ server });

// Logger utility
const logger = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${new Date().toISOString()} - ${msg}`)
};

// ==================== Device Discovery ====================

class DeviceDiscovery {
  constructor(port) {
    this.port = port;
    this.socket = dgram.createSocket('udp4');
    this.serverAddress = this.getLocalIPAddress();
    this.serverHostname = os.hostname();
    this.deviceInfo = {
      id: this.generateDeviceId(),
      name: this.serverHostname,
      address: this.serverAddress,
      port: PORT,
      type: 'server',
      timestamp: Date.now(),
      capabilities: ['webrtc-signaling', 'device-discovery', 'streaming']
    };
  }

  getLocalIPAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        // Skip internal and non-IPv4 addresses
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return 'localhost';
  }

  generateDeviceId() {
    return `device-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  start() {
    this.socket.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        this.handleDiscoveryMessage(data, rinfo);
      } catch (err) {
        logger.error(`Failed to parse discovery message: ${err.message}`);
      }
    });

    this.socket.on('error', (err) => {
      logger.error(`Discovery socket error: ${err.message}`);
    });

    this.socket.bind(this.port, () => {
      this.socket.setBroadcast(true);
      logger.info(`Device discovery listening on port ${this.port}`);
      this.advertiseSelf();
    });

    // Periodically advertise server
    setInterval(() => this.advertiseSelf(), 10000);
  }

  advertiseSelf() {
    const message = Buffer.from(JSON.stringify({
      type: 'server-announce',
      device: this.deviceInfo
    }));

    const broadcastAddr = '255.255.255.255';
    this.socket.send(message, 0, message.length, this.port, broadcastAddr, (err) => {
      if (err && err.code !== 'ENOENT') {
        logger.error(`Failed to broadcast server info: ${err.message}`);
      }
    });
  }

  handleDiscoveryMessage(data, rinfo) {
    if (data.type === 'device-discovery') {
      logger.info(`Discovery request from ${rinfo.address}`);
      this.respondToDiscovery(rinfo);
    } else if (data.type === 'device-announce') {
      logger.debug(`Device announced: ${data.device.name}`);
      discoveryClients.set(data.device.id, {
        ...data.device,
        lastSeen: Date.now(),
        address: rinfo.address
      });
    }
  }

  respondToDiscovery(rinfo) {
    const response = Buffer.from(JSON.stringify({
      type: 'server-response',
      device: this.deviceInfo
    }));

    this.socket.send(response, 0, response.length, this.port, rinfo.address, (err) => {
      if (err) {
        logger.error(`Failed to send discovery response: ${err.message}`);
      }
    });
  }

  stop() {
    this.socket.close();
  }
}

// ==================== WebRTC Signaling ====================

class WebRTCSignaling {
  constructor() {
    this.peers = new Map();
    this.offerCache = new Map();
  }

  handleOffer(deviceId, offer, ws) {
    logger.info(`Received offer from ${deviceId}`);
    this.offerCache.set(deviceId, { offer, timestamp: Date.now() });

    // Broadcast offer to other connected peers
    this.broadcastMessage('offer-received', {
      from: deviceId,
      offer: offer
    }, ws);
  }

  handleAnswer(deviceId, answer, targetId, ws) {
    logger.info(`Received answer from ${deviceId} for ${targetId}`);
    const targetPeer = connectedDevices.get(targetId);

    if (targetPeer) {
      targetPeer.ws.send(JSON.stringify({
        type: 'answer',
        from: deviceId,
        answer: answer
      }));
    } else {
      logger.warn(`Target peer ${targetId} not found for answer from ${deviceId}`);
    }
  }

  handleICECandidate(deviceId, candidate, targetId) {
    logger.debug(`ICE candidate from ${deviceId} to ${targetId}`);
    const targetPeer = connectedDevices.get(targetId);

    if (targetPeer) {
      targetPeer.ws.send(JSON.stringify({
        type: 'ice-candidate',
        from: deviceId,
        candidate: candidate
      }));
    }
  }

  broadcastMessage(type, data, originWs = null) {
    const message = JSON.stringify({ type, ...data });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN && client !== originWs) {
        client.send(message);
      }
    });
  }

  cleanupPeer(deviceId) {
    this.peers.delete(deviceId);
    this.offerCache.delete(deviceId);
    logger.info(`Cleaned up peer: ${deviceId}`);
  }
}

// ==================== WebSocket Message Handlers ====================

function handleDeviceRegistration(ws, message) {
  const deviceId = message.deviceId || `device-${Date.now()}`;
  const deviceInfo = {
    id: deviceId,
    name: message.name || deviceId,
    type: message.deviceType || 'client',
    capabilities: message.capabilities || [],
    ws: ws,
    connectedAt: Date.now(),
    lastHeartbeat: Date.now()
  };

  connectedDevices.set(deviceId, deviceInfo);
  logger.info(`Device registered: ${deviceId} (${deviceInfo.name})`);

  ws.deviceId = deviceId;
  ws.send(JSON.stringify({
    type: 'registration-confirmed',
    deviceId: deviceId,
    timestamp: Date.now()
  }));

  // Broadcast device list to all connected peers
  broadcastDeviceList();
}

function handleWebRTCSignaling(ws, message) {
  const deviceId = ws.deviceId;

  if (!deviceId) {
    ws.send(JSON.stringify({ type: 'error', message: 'Device not registered' }));
    return;
  }

  switch (message.signalingType) {
    case 'offer':
      signaling.handleOffer(deviceId, message.payload, ws);
      break;

    case 'answer':
      signaling.handleAnswer(deviceId, message.payload, message.targetId, ws);
      break;

    case 'ice-candidate':
      signaling.handleICECandidate(deviceId, message.payload, message.targetId);
      break;

    default:
      logger.warn(`Unknown signaling type: ${message.signalingType}`);
  }
}

function handleHeartbeat(ws, message) {
  const deviceId = ws.deviceId;
  if (connectedDevices.has(deviceId)) {
    const device = connectedDevices.get(deviceId);
    device.lastHeartbeat = Date.now();
    ws.send(JSON.stringify({
      type: 'heartbeat-ack',
      timestamp: Date.now()
    }));
  }
}

function broadcastDeviceList() {
  const deviceList = Array.from(connectedDevices.values()).map(d => ({
    id: d.id,
    name: d.name,
    type: d.type,
    capabilities: d.capabilities,
    connectedAt: d.connectedAt
  }));

  const message = JSON.stringify({
    type: 'device-list',
    devices: deviceList,
    timestamp: Date.now()
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function cleanupDevice(ws) {
  if (ws.deviceId) {
    const deviceId = ws.deviceId;
    connectedDevices.delete(deviceId);
    signaling.cleanupPeer(deviceId);
    logger.info(`Device disconnected: ${deviceId}`);
    broadcastDeviceList();
  }
}

// ==================== WebSocket Server Setup ====================

const signaling = new WebRTCSignaling();

wss.on('connection', (ws) => {
  logger.info('New WebSocket connection established');

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'register':
          handleDeviceRegistration(ws, message);
          break;

        case 'webrtc-signaling':
          handleWebRTCSignaling(ws, message);
          break;

        case 'heartbeat':
          handleHeartbeat(ws, message);
          break;

        case 'get-device-list':
          broadcastDeviceList();
          break;

        default:
          logger.warn(`Unknown message type: ${message.type}`);
      }
    } catch (err) {
      logger.error(`WebSocket message parsing error: ${err.message}`);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    cleanupDevice(ws);
  });

  ws.on('error', (err) => {
    logger.error(`WebSocket error: ${err.message}`);
  });
});

// ==================== REST API Endpoints ====================

// Get all connected devices
app.get('/api/devices', (req, res) => {
  const devices = Array.from(connectedDevices.values()).map(d => ({
    id: d.id,
    name: d.name,
    type: d.type,
    capabilities: d.capabilities,
    connectedAt: d.connectedAt,
    lastHeartbeat: d.lastHeartbeat
  }));

  res.json({
    success: true,
    devices,
    count: devices.length,
    timestamp: Date.now()
  });
});

// Get specific device info
app.get('/api/devices/:deviceId', (req, res) => {
  const device = connectedDevices.get(req.params.deviceId);

  if (!device) {
    return res.status(404).json({
      success: false,
      error: 'Device not found'
    });
  }

  res.json({
    success: true,
    device: {
      id: device.id,
      name: device.name,
      type: device.type,
      capabilities: device.capabilities,
      connectedAt: device.connectedAt,
      lastHeartbeat: device.lastHeartbeat
    }
  });
});

// Get server status
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    status: 'operational',
    uptime: process.uptime(),
    timestamp: Date.now(),
    connectedDevices: connectedDevices.size,
    discoveryClients: discoveryClients.size
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now()
  });
});

// ==================== Cleanup Tasks ====================

// Remove stale devices (no heartbeat for DEVICE_TIMEOUT ms)
setInterval(() => {
  const now = Date.now();
  const staleDevices = [];

  connectedDevices.forEach((device, deviceId) => {
    if (now - device.lastHeartbeat > DEVICE_TIMEOUT) {
      staleDevices.push(deviceId);
    }
  });

  staleDevices.forEach((deviceId) => {
    const device = connectedDevices.get(deviceId);
    if (device && device.ws) {
      device.ws.close(1000, 'Device timeout');
    }
    connectedDevices.delete(deviceId);
    logger.warn(`Removed stale device: ${deviceId}`);
  });

  if (staleDevices.length > 0) {
    broadcastDeviceList();
  }
}, 10000);

// Clean stale discovery clients
setInterval(() => {
  const now = Date.now();
  const staleClients = [];

  discoveryClients.forEach((client, clientId) => {
    if (now - client.lastSeen > DEVICE_TIMEOUT) {
      staleClients.push(clientId);
    }
  });

  staleClients.forEach((clientId) => {
    discoveryClients.delete(clientId);
    logger.debug(`Removed stale discovery client: ${clientId}`);
  });
}, 30000);

// ==================== Server Initialization ====================

const deviceDiscovery = new DeviceDiscovery(DISCOVERY_PORT);

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`WebSocket server ready for connections`);
  deviceDiscovery.start();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  deviceDiscovery.stop();
  wss.clients.forEach((client) => {
    client.close();
  });
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  deviceDiscovery.stop();
  wss.clients.forEach((client) => {
    client.close();
  });
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

module.exports = { app, server, wss };
