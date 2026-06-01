const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const dgram = require('dgram');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const UDP_PORT = 5555;

// In-memory store for devices
// Pre-populated with default devices from firmware configuration for instant out-of-the-box operation
let devices = [
  {
    id: "ESP32-TEST-E0C656",
    ip: "192.168.1.100", // example fallback IP
    port: 5555,
    protocol: "UDP",
    token: "test_tok_5b08259c97eb798d9664",
    name: "Living Room (Secure UDP)",
    state: 0,
    online: false
  },
  {
    id: "ESP32-439D16",
    ip: "192.168.1.101", // example fallback IP
    port: 82,
    protocol: "WSS",
    token: "f9ab0ffa09911e5606c5fa5757b1367dd75ec88f",
    name: "Master Bedroom (Secure WSS)",
    state: 0,
    online: false
  }
];

// Active sessions for UDP devices
const udpSessions = {};

// Helper: Log message to the websocket client for the crypto console
function broadcastLog(type, message, details = null) {
  const logPayload = JSON.stringify({
    type: "log",
    logType: type, // "info", "tx", "rx", "error", "success", "crypto"
    timestamp: new Date().toLocaleTimeString(),
    message,
    details
  });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(logPayload);
    }
  });
}

// Helper: Broadcast device state updates
function broadcastDeviceUpdate(deviceId, online, state) {
  const updatePayload = JSON.stringify({
    type: "device_update",
    deviceId,
    online,
    state
  });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(updatePayload);
    }
  });
}

// ---------------------------------------------------------------------------
// REST Endpoints
// ---------------------------------------------------------------------------

// List devices
app.get('/api/devices', (req, res) => {
  res.json(devices);
});

// Add manual device
app.post('/api/devices', (req, res) => {
  const { id, ip, port, protocol, token, name } = req.body;
  if (!id || !ip || !port || !protocol || !token) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Remove existing if matching ID
  devices = devices.filter(d => d.id !== id);
  const newDevice = {
    id,
    ip,
    port: parseInt(port),
    protocol: protocol.toUpperCase(),
    token,
    name: name || id,
    state: 0,
    online: false
  };
  devices.push(newDevice);
  res.status(201).json(newDevice);
  broadcastLog("info", `Device added manually: ${id} (${ip}:${port})`);
});

// Delete device
app.delete('/api/devices/:id', (req, res) => {
  const { id } = req.params;
  devices = devices.filter(d => d.id !== id);
  if (udpSessions[id]) {
    delete udpSessions[id];
  }
  res.json({ status: "ok" });
  broadcastLog("info", `Device removed: ${id}`);
});

// Active discovery scan over UDP
app.post('/api/scan', (req, res) => {
  broadcastLog("info", "Starting network discovery scan over UDP broadcast...");
  
  const client = dgram.createSocket('udp4');
  client.bind(() => {
    client.setBroadcast(true);
  });

  const discovered = [];
  const broadcastAddr = '255.255.255.255';
  
  // Discover packet: [VERSION=0x00] [CONTROL_DISCOVER=0x00]
  const discoverPacket = Buffer.from([0x00, 0x00]);

  client.send(discoverPacket, 0, discoverPacket.length, UDP_PORT, broadcastAddr, (err) => {
    if (err) {
      broadcastLog("error", "Failed to send UDP discovery broadcast: " + err.message);
      client.close();
      return res.status(500).json({ error: "Discovery failed" });
    }
    broadcastLog("tx", "Sent UDP Discover Broadcast: 0x0000 to port 5555");
  });

  client.on('message', (msg, rinfo) => {
    // Response expected: [0x00] [CONTROL_DEVICE_INFO=0x03] [PORT (2 bytes, LE)] [DEVICE_ID_LEN (1 byte)] [DEVICE_ID (variable)]
    if (msg.length >= 5 && msg[0] === 0x00 && msg[1] === 0x03) {
      const port = msg.readUInt16LE(2);
      const devIdLen = msg[4];
      if (msg.length >= 5 + devIdLen) {
        const deviceId = msg.toString('utf8', 5, 5 + devIdLen);
        const hexDump = msg.toString('hex').toUpperCase();
        
        broadcastLog("rx", `Discovered device ${deviceId} at ${rinfo.address}:${port}`, {
          rawHex: hexDump,
          ip: rinfo.address,
          port
        });

        // Add to temporary discovered array
        if (!discovered.some(d => d.id === deviceId)) {
          discovered.push({
            id: deviceId,
            ip: rinfo.address,
            port,
            protocol: "UDP"
          });
        }
      }
    }
  });

  // Stop scanning after 3 seconds
  setTimeout(() => {
    client.close();
    broadcastLog("success", `Discovery scan completed. Discovered ${discovered.length} device(s).`);
    res.json(discovered);
  }, 3000);
});

// ---------------------------------------------------------------------------
// UDP Protocol Gateway Logic (AES-GCM & HKDF)
// ---------------------------------------------------------------------------

function performUdpHandshakeAndExecute(device, commandId, relayId) {
  const clientChallenge = crypto.randomBytes(8);
  const handshakePacket = Buffer.concat([Buffer.from([0x00, 0x01]), clientChallenge]);
  
  const client = dgram.createSocket('udp4');
  let handshakeTimeout = null;

  broadcastLog("info", `Initiating secure session handshake with ${device.id}...`);
  broadcastLog("tx", `Sending Handshake Request: [0x00 0x01 (8-byte challenge)]`, {
    rawHex: handshakePacket.toString('hex').toUpperCase(),
    challenge: clientChallenge.toString('hex').toUpperCase()
  });

  client.send(handshakePacket, 0, handshakePacket.length, device.port, device.ip, (err) => {
    if (err) {
      broadcastLog("error", `Failed to send handshake: ${err.message}`);
      client.close();
      return;
    }
  });

  handshakeTimeout = setTimeout(() => {
    broadcastLog("error", `Handshake timeout with device ${device.id}. Device might be offline.`);
    broadcastDeviceUpdate(device.id, false, device.state);
    client.close();
  }, 3000);

  client.on('message', (msg) => {
    clearTimeout(handshakeTimeout);

    // Response expected: [VERSION=0x00] [CONTROL_SESSION_REPLY=0x02] [SERVER_NONCE (16)] [SESSION_ID (4)]
    if (msg.length === 22 && msg[0] === 0x00 && msg[1] === 0x02) {
      const serverNonce = msg.subarray(2, 18);
      const sessionId = msg.readUInt32LE(18);

      broadcastLog("rx", `Received Handshake Response from ${device.id}`, {
        rawHex: msg.toString('hex').toUpperCase(),
        serverNonce: serverNonce.toString('hex').toUpperCase(),
        sessionId: `0x${sessionId.toString(16).toUpperCase()} (${sessionId})`
      });

      // HKDF Key Derivation
      // IKM = local_token + server_nonce + client_challenge
      const localTokenBuffer = Buffer.from(device.token, 'utf8');
      const ikm = Buffer.concat([localTokenBuffer, serverNonce, clientChallenge]);
      const salt = Buffer.alloc(32); // 32-bytes zero salt
      const info = Buffer.from("IoTYK-Session-Key", 'utf8');

      try {
        const sessionKey = crypto.hkdfSync('sha256', ikm, salt, info, 32);
        
        // Save session state
        udpSessions[device.id] = {
          sessionId,
          sessionKey,
          clientCounter: 0,
          expectedServerCounter: 1000000,
          lastActive: Date.now()
        };

        broadcastLog("crypto", `Session derived successfully!`, {
          ikm: ikm.toString('hex').toUpperCase(),
          info: info.toString(),
          derivedSessionKey: sessionKey.toString('hex').toUpperCase().replace(/./g, (c, i) => i < 8 ? c : '*')
        });

        // Now execute the planned command
        executeUdpSecureCommand(client, device, commandId, relayId);

      } catch (cryptoErr) {
        broadcastLog("error", `Cryptographic key derivation failed: ${cryptoErr.message}`);
        client.close();
      }
    } else {
      broadcastLog("error", `Malformed handshake response from ${device.id}`);
      client.close();
    }
  });
}

function executeUdpSecureCommand(socket, device, commandId, relayId) {
  const session = udpSessions[device.id];
  if (!session) {
    broadcastLog("error", "No active session for device, aborting command");
    socket.close();
    return;
  }

  const version = 0x01; // Secure packet
  const counter = session.clientCounter++;
  
  // Build IV: session_id (4 bytes) + counter (4 bytes) + direction client = 0xA1 (1 byte) + padding (3 bytes of 0x00)
  const iv = Buffer.alloc(12);
  iv.writeUInt32LE(session.sessionId, 0);
  iv.writeUInt32LE(counter, 4);
  iv[8] = 0xA1; // NONCE_DIR_CLIENT

  // Build AAD: VERSION (1 byte) + session_id (4 bytes) + counter (4 bytes)
  const aad = Buffer.alloc(9);
  aad[0] = version;
  aad.writeUInt32LE(session.sessionId, 1);
  aad.writeUInt32LE(counter, 5);

  const plaintext = Buffer.from([commandId, relayId]);

  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', session.sessionKey, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Assemble final packet
    const securePacket = Buffer.concat([
      Buffer.from([version]),
      aad.subarray(1, 5), // session_id
      aad.subarray(5, 9), // counter
      iv,
      ciphertext,
      tag
    ]);

    broadcastLog("tx", `Sending Secure AES-GCM Encrypted Command (${getOpcodeName(commandId)})`, {
      rawHex: securePacket.toString('hex').toUpperCase(),
      aad: aad.toString('hex').toUpperCase(),
      iv: iv.toString('hex').toUpperCase(),
      ciphertext: ciphertext.toString('hex').toUpperCase(),
      authTag: tag.toString('hex').toUpperCase()
    });

    socket.removeAllListeners('message'); // Clear handshake listener

    let cmdTimeout = setTimeout(() => {
      broadcastLog("error", `Command execution timeout from device ${device.id}`);
      socket.close();
    }, 2000);

    socket.on('message', (msg) => {
      clearTimeout(cmdTimeout);
      
      // Decrypt and process response
      try {
        if (msg.length < 21 + 16) {
          throw new Error("Encrypted response packet is too short");
        }
        
        const resVer = msg[0];
        const resSessionId = msg.readUInt32LE(1);
        const resCounter = msg.readUInt32LE(5);
        const resIv = msg.subarray(9, 21);
        const resTag = msg.subarray(msg.length - 16);
        const resCiphertext = msg.subarray(21, msg.length - 16);

        if (resVer !== 0x01) {
          throw new Error(`Unsupported secure packet version: ${resVer}`);
        }
        if (resSessionId !== session.sessionId) {
          throw new Error(`Session ID mismatch: ${resSessionId} vs expected ${session.sessionId}`);
        }

        // Validate IV nonce format (A2 direction from server)
        const expectedIv = Buffer.alloc(12);
        expectedIv.writeUInt32LE(session.sessionId, 0);
        expectedIv.writeUInt32LE(resCounter, 4);
        expectedIv[8] = 0xA2; // NONCE_DIR_SERVER

        if (!resIv.equals(expectedIv)) {
          throw new Error("Server counter IV nonce validation mismatch");
        }

        // AAD validation
        const resAad = Buffer.alloc(9);
        resAad[0] = resVer;
        resAad.writeUInt32LE(resSessionId, 1);
        resAad.writeUInt32LE(resCounter, 5);

        const decipher = crypto.createDecipheriv('aes-256-gcm', session.sessionKey, resIv);
        decipher.setAAD(resAad);
        decipher.setAuthTag(resTag);

        const resPlaintext = Buffer.concat([decipher.update(resCiphertext), decipher.final()]);
        
        // Response format: [OPCODE] [RELAY_ID] [STATE]
        const opResponse = resPlaintext[0];
        const relayIndex = resPlaintext[1];
        const relayState = resPlaintext[2];

        broadcastLog("rx", `Decrypted Secure Response from ${device.id}`, {
          rawHex: msg.toString('hex').toUpperCase(),
          plaintext: resPlaintext.toString('hex').toUpperCase(),
          aad: resAad.toString('hex').toUpperCase(),
          opcode: `${getOpcodeName(opResponse)} (0x${opResponse.toString(16)})`,
          relayId: relayIndex,
          relayState: relayState === 1 ? "ON" : "OFF"
        });

        // Update in-memory state
        device.state = relayState;
        device.online = true;
        broadcastDeviceUpdate(device.id, true, relayState);

        broadcastLog("success", `Secure Command ${getOpcodeName(commandId)} executed successfully! New State: ${relayState === 1 ? 'ON' : 'OFF'}`);

      } catch (decryptErr) {
        broadcastLog("error", `AEAD Response decryption/validation failed: ${decryptErr.message}`);
      } finally {
        socket.close();
      }
    });

    socket.send(securePacket, 0, securePacket.length, device.port, device.ip);

  } catch (err) {
    broadcastLog("error", `AES-GCM encryption process failed: ${err.message}`);
    socket.close();
  }
}

function getOpcodeName(opcode) {
  switch (opcode) {
    case 0x01: return "OPCODE_ON";
    case 0x02: return "OPCODE_OFF";
    case 0x03: return "OPCODE_TOGGLE";
    case 0x04: return "OPCODE_PING";
    case 0x05: return "OPCODE_ACK";
    case 0x06: return "OPCODE_STATE";
    default: return "UNKNOWN";
  }
}

// ---------------------------------------------------------------------------
// WSS TLS Proxy Controller (ESP32-439D16)
// ---------------------------------------------------------------------------

function executeWssSecureCommand(device, actionString) {
  const wssUrl = `wss://${device.ip}:${device.port}/`;
  broadcastLog("info", `Opening Secure WSS proxy link to ${wssUrl}...`);

  // Bypass TLS auth check because the board uses self-signed certificates
  const wsClient = new WebSocket(wssUrl, {
    rejectUnauthorized: false,
    handshakeTimeout: 5000
  });

  wsClient.on('open', () => {
    const commandPayload = {
      token: device.token,
      action: actionString
    };

    broadcastLog("tx", `Sending TLS-encrypted JSON command`, commandPayload);
    wsClient.send(JSON.stringify(commandPayload));
  });

  wsClient.on('message', (data) => {
    broadcastLog("rx", `Received WSS response frame`, data.toString());
    try {
      const response = JSON.parse(data.toString());
      if (response.status === "ok") {
        const finalState = actionString === "RELAY_ON" ? 1 : 0;
        
        device.state = finalState;
        device.online = true;
        broadcastDeviceUpdate(device.id, true, finalState);

        broadcastLog("success", `WSS Command ${actionString} executed successfully! State is now ${finalState === 1 ? 'ON' : 'OFF'}`);
      } else {
        broadcastLog("error", `WSS Command failed: ${response.error || 'Unknown error'}`);
      }
    } catch (e) {
      broadcastLog("error", `Failed to parse JSON response: ${e.message}`);
    } finally {
      wsClient.close();
    }
  });

  wsClient.on('error', (err) => {
    broadcastLog("error", `Secure WSS proxy connection error: ${err.message}. Ensure IP is correct.`);
    broadcastDeviceUpdate(device.id, false, device.state);
    wsClient.close();
  });
}

// ---------------------------------------------------------------------------
// Live WebSocket Manager (Browser UI connection)
// ---------------------------------------------------------------------------

wss.on('connection', (ws) => {
  console.log('Browser Client connected to companion bridge WS');

  // Push current device inventory instantly upon connection
  ws.send(JSON.stringify({
    type: "inventory",
    devices
  }));

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === "control") {
        const device = devices.find(d => d.id === data.deviceId);
        if (!device) {
          ws.send(JSON.stringify({ type: "error", message: "Device not found in inventory" }));
          return;
        }

        const action = data.action; // "ON", "OFF", "TOGGLE"
        broadcastLog("info", `Triggering relay control command [${action}] on ${device.name}`);

        if (device.protocol === "UDP") {
          let opcode = 0x03; // Default TOGGLE
          if (action === "ON") opcode = 0x01;
          if (action === "OFF") opcode = 0x02;

          // Check if session exists and is active (10 minutes TTL)
          const session = udpSessions[device.id];
          const hasActiveSession = session && (Date.now() - session.lastActive < 10 * 60 * 1000);

          if (hasActiveSession) {
            session.lastActive = Date.now();
            const client = dgram.createSocket('udp4');
            executeUdpSecureCommand(client, device, opcode, 0); // Relay ID 0
          } else {
            // Handshake first, then execute
            performUdpHandshakeAndExecute(device, opcode, 0);
          }

        } else if (device.protocol === "WSS") {
          // Translate action strings
          let wssAction = "RELAY_ON";
          if (action === "OFF") wssAction = "RELAY_OFF";
          if (action === "TOGGLE") {
            // WSS doesn't have native toggle action in the ws_handler.
            // We simulate it using current local state knowledge.
            wssAction = device.state === 1 ? "RELAY_OFF" : "RELAY_ON";
          }

          executeWssSecureCommand(device, wssAction);
        }
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    console.log('Browser Client disconnected');
  });
});

// Start Express + WS Server
server.listen(PORT, () => {
  console.log(`================================================================`);
  console.log(`🔒 IoTYK Local Control App Server initialized on port ${PORT}`);
  console.log(`🚀 Serve endpoint: http://localhost:${PORT}`);
  console.log(`================================================================`);
});
