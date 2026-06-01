// --- State Management ---
let ws = null;
let devicesList = [];
let txCounter = 0;
let rxCounter = 0;
const activeSessionIds = new Set();

// --- DOM References ---
const elGatewayPulse = document.getElementById('gateway-pulse');
const elGatewayStatus = document.getElementById('gateway-status');
const elLiveClock = document.getElementById('live-clock');
const elDeviceGrid = document.getElementById('device-grid');
const elCryptoTerminal = document.getElementById('crypto-terminal');
const elBtnScan = document.getElementById('btn-scan');
const elDiscoveredList = document.getElementById('discovered-list');
const elDiscoveredCount = document.getElementById('discovered-count');
const elFormAddDevice = document.getElementById('form-add-device');
const elBtnClearConsole = document.getElementById('btn-clear-console');

const elStatSessions = document.getElementById('stat-sessions');
const elStatTx = document.getElementById('stat-tx');
const elStatRx = document.getElementById('stat-rx');

// --- Dynamic Setup depending on Environment ---
function setupFormMode() {
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!isLocal) {
    // In Cloud Vercel mode, local broadcast discovery scanning does not work, and manual parameters are not needed.
    // Make local parameters optional so that form submission works with just the Pairing Token
    const localInputs = ['input-id', 'input-ip', 'input-port', 'select-proto'];
    localInputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.required = false;
    });

    // Hide the local network discovery card and manual input fields for a cleaner layout
    const scanCard = document.querySelector('.scan-card');
    if (scanCard) scanCard.style.display = 'none';

    const formRows = document.querySelectorAll('#form-add-device .form-row');
    formRows.forEach(row => row.style.display = 'none');

    // Rename Security Token label to Pairing Token
    const tokenLabel = document.querySelector('label[for="input-token"]');
    if (tokenLabel) tokenLabel.textContent = "Pairing Token (QR Code Label)";

    const btnSubmit = elFormAddDevice.querySelector('button[type="submit"]');
    if (btnSubmit) btnSubmit.textContent = "CLAIM SECURE CONTROLLER";
  }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  initClock();
  setupFormMode();
  connectWebSocket();
  initFormListeners();
  initScanListener();
  
  elBtnClearConsole.addEventListener('click', () => {
    elCryptoTerminal.innerHTML = '<div class="terminal-line system">Terminal logs cleared. Sniffer ready...</div>';
  });
});

// --- UI Clock ---
function initClock() {
  setInterval(() => {
    const now = new Date();
    elLiveClock.textContent = now.toLocaleTimeString();
  }, 1000);
}

// --- WebSocket Gateway Connection ---
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  elGatewayStatus.textContent = "CONNECTING...";
  elGatewayPulse.className = "indicator-pulse";

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    elGatewayStatus.textContent = "GATEWAY ONLINE";
    elGatewayPulse.classList.add('online');
    appendTerminalLine('success', 'Successfully established WebSocket link to local Node.js proxy gateway.');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      if (data.type === "inventory") {
        devicesList = data.devices;
        renderDeviceGrid();
        updateSecurityCounters();
      } 
      else if (data.type === "device_update") {
        const device = devicesList.find(d => d.id === data.deviceId);
        if (device) {
          device.state = data.state;
          device.online = data.online;
          updateDeviceCardUI(device);
        }
      } 
      else if (data.type === "log") {
        appendTerminalLine(data.logType, data.message, data.details);
        
        // Dynamic counter updates
        if (data.logType === "tx") {
          txCounter++;
          elStatTx.textContent = txCounter;
        } else if (data.logType === "rx") {
          rxCounter++;
          elStatRx.textContent = rxCounter;
        } else if (data.logType === "crypto" && data.details && data.details.derivedSessionKey) {
          activeSessionIds.add(data.message); // just store session signature
          elStatSessions.textContent = activeSessionIds.size;
        }
        updateSecurityCounters();
      }
    } catch (err) {
      console.error('Failed to parse incoming WS message:', err);
    }
  };

  ws.onclose = () => {
    elGatewayStatus.textContent = "GATEWAY OFFLINE";
    elGatewayPulse.className = "indicator-pulse";
    appendTerminalLine('error', 'Gateway WS connection lost. Retrying link in 5 seconds...');
    setTimeout(connectWebSocket, 5000);
  };
}

// --- Update Security Stats Bar ---
function updateSecurityCounters() {
  elStatTx.textContent = txCounter;
  elStatRx.textContent = rxCounter;
  elStatSessions.textContent = activeSessionIds.size;
}

// --- Render Device Grid ---
function renderDeviceGrid() {
  if (devicesList.length === 0) {
    elDeviceGrid.innerHTML = `
      <div class="grid-empty-state">
        <div class="empty-icon">🔌</div>
        <p>No controllers registered. Use discovery scan or manually register a board to get started.</p>
      </div>`;
    return;
  }

  elDeviceGrid.innerHTML = '';
  devicesList.forEach(device => {
    const card = document.createElement('div');
    card.className = `glass-card device-card`;
    card.id = `device-card-${device.id}`;
    
    card.innerHTML = `
      <button class="btn-icon card-actions" onclick="deleteDevice('${device.id}')" title="Delete controller">
        <svg viewBox="0 0 24 24" class="icon-sm" style="color: var(--color-rose);"><path fill="currentColor" d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"/></svg>
      </button>
      
      <div class="card-top">
        <div class="device-meta">
          <span class="device-name">${device.name}</span>
          <span class="device-id">${device.id}</span>
        </div>
        <span class="proto-badge ${device.protocol.toLowerCase()}">${device.protocol} Secure</span>
      </div>

      <div class="card-middle">
        <div class="device-endpoint">
          <svg viewBox="0 0 24 24" class="icon-endpoint"><path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M12,6A6,6 0 0,0 6,12A6,6 0 0,0 12,18A6,6 0 0,0 18,12A6,6 0 0,0 12,6M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8Z"/></svg>
          <span>${device.ip}:${device.port}</span>
        </div>
      </div>

      <div class="card-bottom">
        <div class="relay-status">
          <span class="led ${device.online ? 'active' : ''}" id="led-${device.id}"></span>
          <span class="status-text" id="status-text-${device.id}">${device.online ? (device.state === 1 ? 'ACTIVE / ON' : 'ACTIVE / OFF') : 'UNVERIFIED'}</span>
        </div>
        
        <div class="switch-control">
          <label class="switch">
            <input type="checkbox" id="toggle-${device.id}" onchange="toggleRelay('${device.id}')" ${device.state === 1 ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
      </div>
    `;
    elDeviceGrid.appendChild(card);
    updateDeviceCardUI(device);
  });
}

// --- Toggle Relay Command Trigger ---
window.toggleRelay = function(deviceId) {
  const device = devicesList.find(d => d.id === deviceId);
  if (!device) return;

  const checkbox = document.getElementById(`toggle-${deviceId}`);
  const nextState = checkbox.checked ? "ON" : "OFF";
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "control",
      deviceId,
      action: nextState
    }));
  }
};

// --- Update Specific Card UI ---
function updateDeviceCardUI(device) {
  const elLed = document.getElementById(`led-${device.id}`);
  const elStatus = document.getElementById(`status-text-${device.id}`);
  const elToggle = document.getElementById(`toggle-${device.id}`);
  const elCard = document.getElementById(`device-card-${device.id}`);

  if (!elLed || !elStatus) return;

  if (device.online) {
    elLed.className = "led active";
    elStatus.textContent = device.state === 1 ? "ACTIVE / ON" : "ACTIVE / OFF";
    elStatus.style.color = "var(--color-emerald)";
    if (elToggle) {
      elToggle.checked = (device.state === 1);
      elToggle.disabled = false;
    }
    if (elCard) {
      elCard.style.boxShadow = device.state === 1 
        ? "0 8px 30px rgba(16, 185, 129, 0.15)" 
        : "0 12px 40px 0 rgba(2, 4, 12, 0.5)";
    }
  } else {
    elLed.className = "led offline";
    elStatus.textContent = "OFFLINE";
    elStatus.style.color = "var(--color-rose)";
    if (elToggle) elToggle.disabled = true;
    if (elCard) elCard.style.boxShadow = "0 8px 30px rgba(239, 68, 68, 0.1)";
  }
}

// --- Delete Device Handler ---
window.deleteDevice = function(deviceId) {
  fetch(`/api/devices/${deviceId}`, {
    method: 'DELETE'
  })
  .then(res => res.json())
  .then(data => {
    if (data.status === "ok") {
      devicesList = devicesList.filter(d => d.id !== deviceId);
      renderDeviceGrid();
    }
  });
};

// --- Discovery Network Scanning ---
function initScanListener() {
  elBtnScan.addEventListener('click', () => {
    const elText = elBtnScan.querySelector('.btn-text');
    const elSpinner = elBtnScan.querySelector('.spinner');
    
    elText.textContent = "SCANNING NETWORK...";
    elSpinner.classList.remove('hidden');
    elBtnScan.disabled = true;
    elDiscoveredList.innerHTML = '<div class="empty-state">Sending discover frames. Sniffing subnet responses...</div>';

    fetch('/api/scan', { method: 'POST' })
      .then(res => res.json())
      .then(discovered => {
        elText.textContent = "SCAN LOCAL SUBNET";
        elSpinner.classList.add('hidden');
        elBtnScan.disabled = false;
        
        elDiscoveredCount.textContent = discovered.length;
        
        if (discovered.length === 0) {
          elDiscoveredList.innerHTML = '<div class="empty-state">No controllers responded. Check subnet connections.</div>';
          return;
        }

        elDiscoveredList.innerHTML = '';
        discovered.forEach(dev => {
          const item = document.createElement('div');
          item.className = 'discovered-item';
          item.innerHTML = `
            <div class="disc-info">
              <span class="disc-name">${dev.id}</span>
              <span class="disc-ip">${dev.ip}:${dev.port} (${dev.protocol})</span>
            </div>
            <button class="btn-primary" style="width: auto; padding: 6px 12px; font-size: 11px;" onclick='addDiscoveredDevice(${JSON.stringify(dev)})'>ADD</button>
          `;
          elDiscoveredList.appendChild(item);
        });
      })
      .catch(err => {
        elText.textContent = "SCAN LOCAL SUBNET";
        elSpinner.classList.add('hidden');
        elBtnScan.disabled = false;
        elDiscoveredList.innerHTML = '<div class="empty-state" style="color: var(--color-rose);">Scan encountered network error.</div>';
      });
  });
}

// --- Pre-populate Form with Discovered Device details ---
window.addDiscoveredDevice = function(dev) {
  document.getElementById('input-name').value = `Room (${dev.id.substring(6)})`;
  document.getElementById('input-id').value = dev.id;
  document.getElementById('input-ip').value = dev.ip;
  document.getElementById('input-port').value = dev.port;
  document.getElementById('select-proto').value = dev.protocol;
  document.getElementById('input-token').value = dev.protocol === "UDP" 
    ? "test_tok_5b08259c97eb798d9664" // populate default UDP token
    : "f9ab0ffa09911e5606c5fa5757b1367dd75ec88f"; // populate default WSS token
    
  document.getElementById('input-name').focus();
  appendTerminalLine('info', `Imported discovered parameters for ${dev.id}. Complete manual token step.`);
};

// --- Form Manual Addition/Claim Submit ---
function initFormListeners() {
  elFormAddDevice.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const name = document.getElementById('input-name').value;
    const id = document.getElementById('input-id').value;
    const ip = document.getElementById('input-ip').value;
    const port = document.getElementById('input-port').value;
    const protocol = document.getElementById('select-proto').value;
    const token = document.getElementById('input-token').value;

    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    
    let payload;
    if (isLocal) {
      // Local bridge mode: send full manual registration fields
      payload = {
        id,
        ip,
        port: parseInt(port),
        protocol,
        token,
        name
      };
      appendTerminalLine('info', `Registering secure local controller node: ${name}...`);
    } else {
      // Cloud Vercel mode: send only Friendly Name and pairingToken (QR Token)
      payload = {
        customName: name,
        pairingToken: token
      };
      appendTerminalLine('info', `Attempting secure cloud claim using pairing token...`);
    }

    fetch('/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(res => {
      if (!res.ok) {
        return res.json().then(err => { throw new Error(err.error || 'Operation failed') });
      }
      return res.json();
    })
    .then(result => {
      // Resolve device object depending on API (Vercel returns { device }, local returns device directly)
      const newDevice = result.device || result;
      
      // Re-fetch or add manually to local array
      devicesList = devicesList.filter(d => d.id !== newDevice.id);
      devicesList.push(newDevice);
      renderDeviceGrid();
      
      // Reset form and UI mode validation
      elFormAddDevice.reset();
      setupFormMode();
      
      appendTerminalLine('success', `Successfully provisioned secure device node: ${newDevice.name}`);
    })
    .catch(err => {
      appendTerminalLine('error', `Hardware pairing/registration failed: ${err.message}`);
    });
  });
}

// --- Cryptographic Terminal Renderer ---
function appendTerminalLine(type, message, details = null) {
  const line = document.createElement('div');
  line.className = `terminal-line ${type}`;
  
  let content = `[${new Date().toLocaleTimeString()}] `;
  if (type === "tx") content += `⚡ [TX] `;
  else if (type === "rx") content += `📥 [RX] `;
  else if (type === "crypto") content += `🔑 [CRYPTO] `;
  else if (type === "error") content += `❌ [ERR] `;
  else if (type === "success") content += `✓ [OK] `;
  else content += `ℹ [INFO] `;

  content += message;
  line.textContent = content;

  if (details) {
    const detailsContainer = document.createElement('div');
    detailsContainer.className = 'console-details';
    
    Object.entries(details).forEach(([key, val]) => {
      const row = document.createElement('div');
      row.className = 'console-detail-row';
      row.innerHTML = `<span class="console-detail-label">${key}:</span> <span class="console-detail-value">${val}</span>`;
      detailsContainer.appendChild(row);
    });
    line.appendChild(detailsContainer);
  }

  elCryptoTerminal.appendChild(line);
  
  // Auto-scroll to bottom of console
  elCryptoTerminal.scrollTop = elCryptoTerminal.scrollHeight;
}

// --- AI Studio Prompt Compiler Logic ---
const elPromptModal = document.getElementById('prompt-modal');
const elBtnOpenPromptGen = document.getElementById('btn-open-prompt-gen');
const elBtnCloseModal = document.getElementById('btn-close-modal');
const elBtnCompilePrompt = document.getElementById('btn-compile-prompt');
const elBtnCopyPrompt = document.getElementById('btn-copy-prompt');
const elPromptTextarea = document.getElementById('prompt-textarea');

if (elBtnOpenPromptGen) {
  elBtnOpenPromptGen.addEventListener('click', () => {
    elPromptModal.classList.remove('hidden');
    // Pre-populate input values from first device if available
    if (devicesList.length > 0) {
      const dev = devicesList[0];
      document.getElementById('prompt-token').value = dev.token;
    }
  });

  elBtnCloseModal.addEventListener('click', () => {
    elPromptModal.classList.add('hidden');
  });

  // Close when clicking outside of modal content
  elPromptModal.addEventListener('click', (e) => {
    if (e.target === elPromptModal) {
      elPromptModal.classList.add('hidden');
    }
  });

  elBtnCompilePrompt.addEventListener('click', () => {
    const pkg = document.getElementById('prompt-pkg').value || 'com.iotyk.control';
    const relays = document.getElementById('prompt-relays').value;
    const proto = document.getElementById('prompt-proto').value;
    const token = document.getElementById('prompt-token').value || 'test_tok_5b08259c97eb798d9664';

    const promptText = `You are a senior Android software engineer and premium UI designer. Your task is to generate a complete, high-performance Android mobile application using Kotlin and Jetpack Compose that connects natively to IoTYK Secure UDP (port 5555) and Secure WSS (port 82) ESP32 devices.

The package name of the app must be: "${pkg}"
The target ESP32 hardware layout comprises:
- Protocol Features: ${proto}
- Relay Channels Count: ${relays}
- Default NVS Authentication Token: "${token}"

---

### DESIGN & AESTHETIC REQUIREMENTS

1. **Space Charcoal Palette**: Dark-mode primary background (#060813 to #0c0f24 gradient) with subtle colored glass panels (rgba(13, 17, 39, 0.45) equivalent in Jetpack Compose modifiers with blurred card overlays).
2. **Rich Typography**: Use elegant custom typography (Outfit and Inter style custom typography definitions).
3. **Pulsing Toggles & LED Glows**: Relay status lights must have neon glow shadows.
4. **Log Terminal & Packet Sniffer Console**: A bottom sheet or scrollable terminal panel formatted with a monospace font displaying incoming and outgoing packet byte logs in distinct neon colors (Cyan for TX, Purple for RX, Amber for Crypto Key exchanges).

---

### NATIVE TECHNICAL IMPLEMENTATIONS

#### 1. Cryptographic Client Engine (Pure Kotlin/Java)
- **HKDF-SHA256 Key Derivation**: Implemented cleanly using Mac.getInstance("HmacSHA256") to derive the 32-byte session key from IKM ("${token}" + serverNonce + clientChallenge), Salt (32-bytes zero), and Info ("IoTYK-Session-Key").
- **AES-GCM-256 Command Encryption**:
  - Uses Cipher.getInstance("AES/GCM/NoPadding") and GCMParameterSpec(128, iv).
  - Binds AAD ([VERSION = 0x01] + [session_id (4)] + [counter (4)]) via cipher.updateAAD(aad).
  - IV Nonce creation (session_id + counter + 0xA1 + padding).
  - Verifies and decrypts incoming responses using IV nonces with server direction 0xA2.

#### 2. Local UDP Broadcast Socket Engine (Kotlin Coroutines)
- Binds a non-blocking DatagramSocket using Dispatchers.IO.
- Broadcasts [0x00, 0x00] discover bytes to 255.255.255.255 on port 5555 to find controllers.
- Listens for replies: [0x00] [0x03 (INFO)] [port (2, LE)] [dev_id_len (1)] [device_id].
- Implements the complete two-way handshake state machine (sending client challenges, receiving server nonces/session IDs, and maintaining active secure sessions).

#### 3. WSS Tunnel Client (OkHttp WebSocket)
- Connects to WSS endpoint: wss://<esp32-ip>:82/.
- Configures OkHttpClient to bypass TLS self-signed certificate constraints by using a permissive TrustManager and HostnameVerifier.
- Sends secure command JSON frames ({"token": "${token}", "action": "RELAY_ON"}) and decodes responses.

---

### SYSTEM CODEBASE TO GENERATE

Please write the complete, compilable codebase including:
1. **build.gradle.kts**: Standard Compose dependencies, OkHttp, and serialization.
2. **IoTykCrypto.kt**: High-security Kotlin module performing the HKDF key derivation and AES-GCM encrypt/decrypt operations.
3. **UdpGateway.kt**: Managed coroutine flow broadcasting discover signals and handling the UDP session key state machine.
4. **WssGateway.kt**: Permissive WebSocket socket tunnel connecting to WSS controllers on port 82.
5. **MainActivity.kt / UI components**:
   - \`ControlCenterTheme\`: Custom Color/Type setups.
   - \`DashboardScreen\`: Responsive Compose structure.
   - \`DeviceCard\`: Glowing card item with smooth slide switches.
   - \`DiscoveryPanel\`: Pulse animation while scanning.
   - \`ConsoleTerminal\`: Monospace packet sniffer feed.

Do not use placeholders, shorthand omissions, or ellipses. All code must be complete, production-ready, and robust.`;

    elPromptTextarea.value = promptText;
    appendTerminalLine('success', 'Android Compose Prompt compiled successfully!');
  });

  elBtnCopyPrompt.addEventListener('click', () => {
    elPromptTextarea.select();
    document.execCommand('copy');
    
    const originalText = elBtnCopyPrompt.textContent;
    elBtnCopyPrompt.textContent = "COPIED! ✓";
    elBtnCopyPrompt.style.background = "var(--grad-emerald-teal)";
    
    setTimeout(() => {
      elBtnCopyPrompt.textContent = originalText;
      elBtnCopyPrompt.style.background = "var(--grad-magenta-purple)";
    }, 2000);
    
    appendTerminalLine('success', 'AI Studio system prompt copied to clipboard!');
  });
}
