const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 3000;

// CORS Configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static file serving
app.use(express.static(path.join(__dirname, 'public')));
app.use('/static', express.static(path.join(__dirname, 'static')));

// ==================== Device Discovery ====================
// Store connected peers/devices
const connectedPeers = new Map();
const deviceInfo = new Map();

/**
 * Get local network IP address
 */
function getLocalIPAddress() {
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

/**
 * Generate unique device ID
 */
function generateDeviceId() {
  return `device-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ==================== WebSocket Signaling ====================
wss.on('connection', (ws) => {
  const peerId = generateDeviceId();
  console.log(`[${new Date().toISOString()}] New WebSocket connection: ${peerId}`);

  // Store peer connection
  connectedPeers.set(peerId, {
    ws,
    connectedAt: new Date(),
    peerId,
    device: null
  });

  // Send welcome message with peer ID
  ws.send(JSON.stringify({
    type: 'welcome',
    peerId,
    serverTime: new Date().toISOString(),
    serverAddress: getLocalIPAddress(),
    port: PORT
  }));

  // Handle incoming messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleSignalingMessage(peerId, data);
    } catch (error) {
      console.error('[Signaling Error]', error.message);
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
    }
  });

  // Handle peer disconnect
  ws.on('close', () => {
    console.log(`[${new Date().toISOString()}] Peer disconnected: ${peerId}`);
    connectedPeers.delete(peerId);
    deviceInfo.delete(peerId);
    broadcastPeerUpdate();
  });

  // Handle WebSocket errors
  ws.on('error', (error) => {
    console.error(`[WebSocket Error] ${peerId}:`, error.message);
  });

  // Send initial peer list
  broadcastPeerUpdate();
});

/**
 * Handle signaling messages (offer, answer, ICE candidates)
 */
function handleSignalingMessage(peerId, data) {
  const { type, targetPeerId, payload } = data;
  
  console.log(`[Signaling] ${peerId} -> ${targetPeerId}: ${type}`);

  switch (type) {
    case 'register-device':
      handleDeviceRegistration(peerId, payload);
      break;

    case 'discovery-request':
      handleDiscoveryRequest(peerId);
      break;

    case 'offer':
    case 'answer':
    case 'ice-candidate':
      forwardSignalingMessage(peerId, targetPeerId, data);
      break;

    case 'peer-list-request':
      sendPeerList(peerId);
      break;

    default:
      console.warn(`[Warning] Unknown signaling type: ${type}`);
  }
}

/**
 * Register device with metadata
 */
function handleDeviceRegistration(peerId, deviceData) {
  const device = {
    id: peerId,
    name: deviceData?.name || `Device-${peerId.substring(0, 8)}`,
    type: deviceData?.type || 'unknown',
    capabilities: deviceData?.capabilities || [],
    registeredAt: new Date().toISOString()
  };

  deviceInfo.set(peerId, device);
  
  const peer = connectedPeers.get(peerId);
  if (peer) {
    peer.device = device;
  }

  console.log(`[Device Registered]`, device);
  broadcastPeerUpdate();

  // Send confirmation
  const peerConn = connectedPeers.get(peerId);
  if (peerConn?.ws.readyState === WebSocket.OPEN) {
    peerConn.ws.send(JSON.stringify({
      type: 'device-registered',
      device
    }));
  }
}

/**
 * Handle device discovery request
 */
function handleDiscoveryRequest(peerId) {
  const discoveredDevices = Array.from(deviceInfo.values()).filter(
    device => device.id !== peerId
  );

  const peerConn = connectedPeers.get(peerId);
  if (peerConn?.ws.readyState === WebSocket.OPEN) {
    peerConn.ws.send(JSON.stringify({
      type: 'discovery-response',
      devices: discoveredDevices,
      discoveredAt: new Date().toISOString()
    }));
  }
}

/**
 * Forward signaling message to target peer
 */
function forwardSignalingMessage(fromPeerId, targetPeerId, data) {
  const targetPeer = connectedPeers.get(targetPeerId);

  if (!targetPeer || targetPeer.ws.readyState !== WebSocket.OPEN) {
    const sourcePeer = connectedPeers.get(fromPeerId);
    if (sourcePeer?.ws.readyState === WebSocket.OPEN) {
      sourcePeer.ws.send(JSON.stringify({
        type: 'error',
        error: `Target peer '${targetPeerId}' is not available`
      }));
    }
    return;
  }

  // Forward message to target
  targetPeer.ws.send(JSON.stringify({
    ...data,
    fromPeerId,
    forwardedAt: new Date().toISOString()
  }));
}

/**
 * Send complete peer list to a peer
 */
function sendPeerList(peerId) {
  const peerConn = connectedPeers.get(peerId);
  if (!peerConn || peerConn.ws.readyState !== WebSocket.OPEN) {
    return;
  }

  const peers = Array.from(connectedPeers.values())
    .filter(p => p.peerId !== peerId)
    .map(p => ({
      peerId: p.peerId,
      device: p.device,
      connectedAt: p.connectedAt
    }));

  peerConn.ws.send(JSON.stringify({
    type: 'peer-list',
    peers,
    totalPeers: peers.length,
    timestamp: new Date().toISOString()
  }));
}

/**
 * Broadcast peer update to all connected peers
 */
function broadcastPeerUpdate() {
  const activeDevices = Array.from(deviceInfo.values());
  const message = JSON.stringify({
    type: 'peer-update',
    devices: activeDevices,
    totalConnected: connectedPeers.size,
    timestamp: new Date().toISOString()
  });

  connectedPeers.forEach((peer) => {
    if (peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(message);
    }
  });
}

// ==================== HTTP Routes ====================

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    port: PORT
  });
});

/**
 * Server info endpoint
 */
app.get('/api/info', (req, res) => {
  res.json({
    server: 'ShearPoint WebRTC Signaling Server',
    version: '1.0.0',
    port: PORT,
    address: getLocalIPAddress(),
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    capabilities: {
      webrtc: true,
      websocket: true,
      peerDiscovery: true,
      deviceManagement: true
    }
  });
});

/**
 * Get all connected peers and devices
 */
app.get('/api/peers', (req, res) => {
  const peers = Array.from(connectedPeers.values()).map(p => ({
    peerId: p.peerId,
    device: p.device,
    connectedAt: p.connectedAt,
    online: p.ws.readyState === WebSocket.OPEN
  }));

  res.json({
    totalConnected: connectedPeers.size,
    registeredDevices: deviceInfo.size,
    peers,
    timestamp: new Date().toISOString()
  });
});

/**
 * Get specific peer information
 */
app.get('/api/peers/:peerId', (req, res) => {
  const { peerId } = req.params;
  const peer = connectedPeers.get(peerId);

  if (!peer) {
    return res.status(404).json({
      error: 'Peer not found',
      peerId
    });
  }

  res.json({
    peerId: peer.peerId,
    device: peer.device,
    connectedAt: peer.connectedAt,
    online: peer.ws.readyState === WebSocket.OPEN,
    timestamp: new Date().toISOString()
  });
});

/**
 * Get registered devices
 */
app.get('/api/devices', (req, res) => {
  const devices = Array.from(deviceInfo.values());
  res.json({
    totalRegistered: devices.length,
    devices,
    timestamp: new Date().toISOString()
  });
});

/**
 * Register a device via HTTP
 */
app.post('/api/devices', (req, res) => {
  const { name, type, capabilities } = req.body;

  if (!name || !type) {
    return res.status(400).json({
      error: 'Device name and type are required'
    });
  }

  const deviceId = generateDeviceId();
  const device = {
    id: deviceId,
    name,
    type,
    capabilities: capabilities || [],
    registeredAt: new Date().toISOString()
  };

  deviceInfo.set(deviceId, device);
  broadcastPeerUpdate();

  res.status(201).json({
    message: 'Device registered',
    device,
    timestamp: new Date().toISOString()
  });
});

/**
 * Delete a device
 */
app.delete('/api/devices/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  
  if (!deviceInfo.has(deviceId)) {
    return res.status(404).json({
      error: 'Device not found',
      deviceId
    });
  }

  deviceInfo.delete(deviceId);
  const peer = connectedPeers.get(deviceId);
  if (peer?.ws.readyState === WebSocket.OPEN) {
    peer.ws.close();
  }

  broadcastPeerUpdate();

  res.json({
    message: 'Device deleted',
    deviceId,
    timestamp: new Date().toISOString()
  });
});

/**
 * Get server statistics
 */
app.get('/api/stats', (req, res) => {
  const memoryUsage = process.memoryUsage();
  
  res.json({
    server: {
      uptime: process.uptime(),
      memory: {
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB',
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB',
        rss: Math.round(memoryUsage.rss / 1024 / 1024) + ' MB'
      },
      cpu: os.cpus().length + ' cores'
    },
    connections: {
      totalPeers: connectedPeers.size,
      registeredDevices: deviceInfo.size,
      websocketConnections: Array.from(connectedPeers.values()).filter(
        p => p.ws.readyState === WebSocket.OPEN
      ).length
    },
    timestamp: new Date().toISOString()
  });
});

/**
 * Root endpoint
 */
app.get('/', (req, res) => {
  res.json({
    message: 'ShearPoint WebRTC Signaling Server',
    port: PORT,
    documentation: {
      websocket: `ws://${getLocalIPAddress()}:${PORT}`,
      health: 'GET /health',
      info: 'GET /api/info',
      peers: 'GET /api/peers',
      devices: 'GET /api/devices',
      stats: 'GET /api/stats'
    }
  });
});

/**
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.path,
    method: req.method
  });
});

/**
 * Error handler
 */
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// ==================== Server Startup ====================
server.listen(PORT, () => {
  const localIP = getLocalIPAddress();
  console.log('\n' + '='.repeat(60));
  console.log('🚀 ShearPoint WebRTC Signaling Server Started');
  console.log('='.repeat(60));
  console.log(`📡 HTTP Server: http://localhost:${PORT}`);
  console.log(`📡 HTTP Server (Network): http://${localIP}:${PORT}`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
  console.log(`🔌 WebSocket (Network): ws://${localIP}:${PORT}`);
  console.log('='.repeat(60));
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📅 Started at: ${new Date().toISOString()}`);
  console.log('='.repeat(60) + '\n');
});

// ==================== Graceful Shutdown ====================
process.on('SIGINT', () => {
  console.log('\n[Shutdown] Received SIGINT signal');
  console.log('[Shutdown] Closing WebSocket connections...');
  
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.close();
    }
  });

  server.close(() => {
    console.log('[Shutdown] Server closed gracefully');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('[Shutdown] Forced exit after timeout');
    process.exit(1);
  }, 10000);
});

module.exports = { app, server, wss };
