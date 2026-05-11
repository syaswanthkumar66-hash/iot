// ─── Global State ───────────────────────────────────────────────────────────
let currentDeviceData = null;
let currentDeviceKey = '';
let serialPort = null;
let sessionToken = '';
let sessionAuthed = false;
const factoryApiRoot = '/api/v1/factory';

// ─── Global Functions (Accessed by HTML onclick) ───────────────────────────

window.deleteDevice = async (deviceId) => {
  const key = document.getElementById('factoryKeyInput')?.value;
  if (!confirm(`Delete ${deviceId}? This is permanent.`)) return;
  try {
    const res = await fetch(`${factoryApiRoot}/device/${deviceId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${key}` }
    });
    if (!res.ok) throw new Error("Delete failed");
    window.loadDevices(); // Refresh list
  } catch (err) { alert("Error deleting: " + err.message); }
};

window.fetchDeviceDetails = async (deviceId) => {
  const key = document.getElementById('factoryKeyInput')?.value;
  try {
    const res = await fetch(`${factoryApiRoot}/devices`, {
      headers: { 'Authorization': `Bearer ${key}` }
    });
    const data = await res.json();
    const device = data.devices.find(d => d.device_id === deviceId);
    if (device) {
      // Since devices list doesn't store unhashed password, we'll fetch them from config endpoint or build placeholder
      window.displayResult({
        qr_data: { device_id: device.device_id, device_key: 'Stored Securely' },
        firmware_config: {
          device_id: device.device_id,
          relay_count: device.relay_count,
          relay_pins: [26, 27, 14, 25, 33, 32, 23, 22].slice(0, device.relay_count),
          namespace: device.namespace,
          permanent_mqtt: {
            username: `perm_${device.namespace}`,
            password: '• • • • • • • •'
          }
        }
      });
    }
  } catch (err) { console.error("Error fetching details", err); }
};

window.loadDevices = async () => {
  const key = document.getElementById('factoryKeyInput')?.value;
  const tbody = document.getElementById('deviceTableBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${factoryApiRoot}/devices`, {
      headers: { 'Authorization': `Bearer ${key}` }
    });
    if (!res.ok) throw new Error("Auth failed");
    const data = await res.json();
    tbody.innerHTML = '';
    data.devices.forEach(device => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${device.device_id}</strong></td>
        <td>${device.relay_count}</td>
        <td><span class="status-badge ${device.is_online ? 'status-online' : 'status-offline'}">${device.is_online ? 'Online' : 'Offline'}</span></td>
        <td>${device.owner_email || 'Unpaired'}</td>
        <td>${device.flash_count}</td>
        <td>${device.hardware_replace_count}</td>
        <td style="font-size:11px">${device.last_flashed_at ? new Date(device.last_flashed_at).toLocaleString() : 'Never'}</td>
        <td class="table-actions">
          <button class="btn primary small" onclick="fetchDeviceDetails('${device.device_id}')">Select</button>
          <button class="btn danger small" onclick="deleteDevice('${device.device_id}')">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) { console.error("API Error:", err); }
};

window.displayResult = (data) => {
  currentDeviceData = data.firmware_config;
  currentDeviceKey = data.qr_data?.device_key || '';

  const lbl = document.getElementById('lblDeviceId');
  const sec = document.getElementById('resultSection');
  if (lbl) lbl.textContent = data.qr_data.device_id;
  if (sec) sec.classList.remove('hidden');

  // Populate new credentials UI
  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setTxt('lblDeviceIdText', data.qr_data?.device_id || '');
  setTxt('lblDeviceKey', data.qr_data?.device_key || 'Hidden (Only shown on creation)');
  
  if (data.firmware_config) {
    setTxt('fwDeviceId', data.firmware_config.device_id);
    setTxt('fwRelayCount', data.firmware_config.relay_count);
    setTxt('fwRelayPins', data.firmware_config.relay_pins?.join(', '));
    setTxt('fwNamespace', data.firmware_config.namespace);
    setTxt('fwPermUser', data.firmware_config.permanent_mqtt?.username || 'Hidden');
    setTxt('fwPermPass', data.firmware_config.permanent_mqtt?.password || 'Hidden');
  } else {
    ['fwDeviceId', 'fwRelayCount', 'fwRelayPins', 'fwNamespace', 'fwPermUser', 'fwPermPass'].forEach(id => setTxt(id, ''));
  }

  // Generate QR Code
  const qrContainer = document.getElementById('qrcode');
  if (qrContainer && typeof QRCode !== 'undefined' && data.qr_data?.device_key) {
    qrContainer.innerHTML = '';
    new QRCode(qrContainer, {
      text: JSON.stringify({
        i: data.qr_data.device_id,
        k: data.qr_data.device_key
      }),
      width: 128,
      height: 128
    });
  } else if (qrContainer) {
    qrContainer.innerHTML = '<div style="color:var(--muted); font-size:12px; text-align:center; padding-top:40px;">QR Hidden</div>';
  }

  // Manage UI button states on device select
  const btnAuth = document.getElementById('btnAuthenticate');
  if (btnAuth && serialPort) {
    btnAuth.disabled = !currentDeviceKey || currentDeviceKey === 'Stored Securely';
  }
};

// ─── DOM Initialization ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const btnProvision = document.getElementById('btnProvision');
  const btnRefresh = document.getElementById('btnRefresh');
  const btnDownloadFirmwareZip = document.getElementById('btnDownloadFirmwareZip');
  const btnDownloadSourceZip = document.getElementById('btnDownloadSourceZip');
  const btnReplaceHardware = document.getElementById('btnReplaceHardware');
  const btnConfirmReplace = document.getElementById('btnConfirmReplace');
  const btnCancelReplace = document.getElementById('btnCancelReplace');
  const btnGlobalConnectUsb = document.getElementById('btnGlobalConnectUsb');
  const btnDisconnectUsb = document.getElementById('btnDisconnectUsb');
  const btnAuthenticate = document.getElementById('btnAuthenticate');
  const btnPerformFactorySetup = document.getElementById('btnPerformFactorySetup');
  const btnSendCredentials = document.getElementById('btnSendCredentials');
  const btnSerialSend = document.getElementById('btnSerialSend');
  const serialInput = document.getElementById('serialInput');

  // Additional Serial Control Buttons
  const btnCmdStatus = document.getElementById('btnCmdStatus');
  const btnReauth = document.getElementById('btnReauth');
  const btnClearNvs = document.getElementById('btnClearNvs');
  const btnFactoryReset = document.getElementById('btnFactoryReset');
  const btnClearLog = document.getElementById('btnClearLog');

  // Wire up event listeners
  if (btnProvision) btnProvision.onclick = provisionDevice;
  if (btnRefresh) btnRefresh.onclick = window.loadDevices;
  if (btnDownloadFirmwareZip) btnDownloadFirmwareZip.onclick = downloadFirmwareZip;
  if (btnDownloadSourceZip) btnDownloadSourceZip.onclick = downloadSourceZip;
  if (btnReplaceHardware) btnReplaceHardware.onclick = () => document.getElementById('replacePanel')?.classList.remove('hidden');
  if (btnCancelReplace) btnCancelReplace.onclick = () => document.getElementById('replacePanel')?.classList.add('hidden');
  if (btnConfirmReplace) btnConfirmReplace.onclick = confirmHardwareReplacement;
  if (btnGlobalConnectUsb) btnGlobalConnectUsb.onclick = connectSerial;
  if (btnDisconnectUsb) btnDisconnectUsb.onclick = disconnectSerial;
  if (btnAuthenticate) btnAuthenticate.onclick = doAuthenticate;
  if (btnPerformFactorySetup) btnPerformFactorySetup.onclick = doPerformFactorySetup;
  if (btnSendCredentials) btnSendCredentials.onclick = sendCredentialsToDevice;
  if (btnSerialSend) btnSerialSend.onclick = sendManualInput;
  if (btnClearLog) btnClearLog.onclick = () => { const l = document.getElementById('serialLog'); if (l) l.innerHTML = ''; };
  
  if (btnCmdStatus) btnCmdStatus.onclick = () => writeSerial('STATUS');
  if (btnReauth) btnReauth.onclick = () => writeSerial('REAUTH');
  if (btnClearNvs) {
    btnClearNvs.onclick = () => {
      if (confirm("Clear device non-volatile memory? This reboots the ESP32.")) {
        writeSerial('CLEAR_NVS');
      }
    };
  }
  if (btnFactoryReset) {
    btnFactoryReset.onclick = () => {
      if (confirm("Restore ESP32 to original default state?")) {
        writeSerial('FACTORY_RESET');
      }
    };
  }

  window.loadDevices(); // Initial load

  // --- Functions ---

  async function provisionDevice() {
    const key = document.getElementById('factoryKeyInput')?.value;
    const relayCount = document.getElementById('relayCountInput')?.value;
    try {
      const res = await fetch(`${factoryApiRoot}/device`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ relay_count: Number(relayCount) })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.displayResult(data);
      window.loadDevices();
    } catch (err) { alert(err.message); }
  }

  async function confirmHardwareReplacement() {
    const key = document.getElementById('factoryKeyInput')?.value;
    try {
      const res = await fetch(`${factoryApiRoot}/device/${currentDeviceData.device_id}/replace-hardware`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${key}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      alert("Hardware invalidated. New Master Key generated. Save/flash credentials below.");
      document.getElementById('replacePanel')?.classList.add('hidden');
      window.displayResult(data);
      window.loadDevices();
    } catch (err) { alert(err.message); }
  }

  function downloadFirmwareZip() {
    const key = document.getElementById('factoryKeyInput')?.value;
    window.location.href = `${factoryApiRoot}/device/${currentDeviceData.device_id}/firmware-package?key=${encodeURIComponent(key)}`;
  }

  function downloadSourceZip() {
    const key = document.getElementById('factoryKeyInput')?.value;
    window.location.href = `${factoryApiRoot}/device/${currentDeviceData.device_id}/generate-firmware?key=${encodeURIComponent(key)}`;
  }

  async function connectSerial() {
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      serialPort = port;
      updateUsbStatus(true);
      startReadLoop(port);
      // Fetch initial status instantly upon connecting
      setTimeout(() => writeSerial('STATUS'), 1000);
    } catch (err) { alert("USB Error: " + err.message); }
  }

  async function disconnectSerial() {
    if (serialPort) { 
      await serialPort.close(); 
      serialPort = null; 
    }
    updateUsbStatus(false);
  }

  function updateUsbStatus(connected) {
    const badge = document.getElementById('globalUsbStatus');
    const panel = document.getElementById('authPanel');
    if (badge) {
      badge.textContent = connected ? 'USB CONNECTED' : 'USB DISCONNECTED';
      badge.className = `status-badge ${connected ? 'status-online' : 'status-offline'}`;
    }
    if (panel) panel.classList.toggle('hidden', !connected);
    if (!connected) {
      document.getElementById('diagnosticsPanel')?.classList.add('hidden');
    }
  }

  async function startReadLoop(port) {
    const decoder = new TextDecoderStream();
    port.readable.pipeTo(decoder.writable);
    const reader = decoder.readable.getReader();
    let lineBuffer = '';
    
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        
        logSerial(value, 'log-rx');
        
        lineBuffer += value;
        let lines = lineBuffer.split('\r\n');
        if (lines.length === 1) {
          lines = lineBuffer.split('\n');
        }
        lineBuffer = lines.pop(); // Hold incomplete trailing string
        
        for (let line of lines) {
          parseSerialLine(line.trim());
        }
      }
    } catch (err) { console.error("Web Serial read stream error:", err); }
  }

  function parseSerialLine(line) {
    if (!line) return;

    if (line.startsWith('WIFI_AP:')) {
      const ap = line.substring(8).trim();
      if (!window.scannedNetworks) window.scannedNetworks = [];
      if (!window.scannedNetworks.includes(ap)) {
        window.scannedNetworks.push(ap);
      }
      return;
    }

    if (line === 'SCAN_END') {
      window.isScanningWifi = false;
      if (window.onScanFinished) {
        window.onScanFinished(window.scannedNetworks || []);
      }
      return;
    }

    if (line.startsWith('CHALLENGE_NONCE:')) {
      const nonce = line.substring(16).trim();
      window.lastChallengeNonce = nonce;
      logSerial(`Challenge Nonce Received: ${nonce}`, 'log-rx');
      
      const badge = document.getElementById('authStatusBadge');
      if (badge) {
        badge.textContent = 'PENDING UNLOCK';
        badge.className = 'status-badge status-offline';
      }
      if (btnAuthenticate) btnAuthenticate.disabled = false;
      return;
    }

    if (line === 'AUTH_OK') {
      sessionAuthed = true;
      const el = document.getElementById('authStatusBadge');
      if (el) {
        el.textContent = 'AUTHENTICATED';
        el.className = 'status-badge status-online';
      }
      if (btnPerformFactorySetup) btnPerformFactorySetup.disabled = false;
      return;
    }
    
    if (line === 'AUTH_FAILED') {
      sessionAuthed = false;
      const el = document.getElementById('authStatusBadge');
      if (el) {
        el.textContent = 'AUTH FAILED';
        el.className = 'status-badge status-offline';
      }
      if (btnPerformFactorySetup) btnPerformFactorySetup.disabled = true;
      return;
    }

    if (line === 'REAUTH_OK' || line === 'SERIAL_UNAUTH') {
      sessionAuthed = false;
      const el = document.getElementById('authStatusBadge');
      if (el) {
        el.textContent = (line === 'SERIAL_UNAUTH') ? 'UNAUTHORIZED' : 'NOT AUTHENTICATED';
        el.className = 'status-badge status-offline';
      }
      if (btnPerformFactorySetup) btnPerformFactorySetup.disabled = true;
      return;
    }

    // Diagnostics telemetry parsing
    const setDiag = (id, val, statusClass) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = val;
        if (statusClass) {
          el.className = statusClass;
        }
      }
    };

    if (line.startsWith('Device ID:')) {
      const id = line.substring(10).trim();
      setDiag('diagDeviceId', id);
      document.getElementById('diagnosticsPanel')?.classList.remove('hidden');
      
      // If we selected a device matching this physical ID, unlock Authenticate button
      if (currentDeviceData && currentDeviceData.device_id === id) {
        if (btnAuthenticate) btnAuthenticate.disabled = false;
      }
    } else if (line.startsWith('Provisioned:')) {
      const prov = line.substring(12).trim();
      setDiag('diagWifiStatus', 'Provisioned: ' + prov);
    } else if (line.startsWith('WiFi Status:')) {
      const wifiStatus = line.substring(12).trim();
      const sClass = (wifiStatus === 'CONNECTED') ? 'status-online-text' : 'status-offline-text';
      setDiag('diagWifiStatus', wifiStatus);
    } else if (line.startsWith('SSID:')) {
      setDiag('diagWifiDetails', line.substring(5).trim() || 'Not Configured');
    } else if (line.startsWith('IP Address:')) {
      const ip = line.substring(11).trim();
      const cur = document.getElementById('diagWifiDetails')?.textContent || '';
      setDiag('diagWifiDetails', `${cur} (${ip})`);
    } else if (line.startsWith('RSSI:')) {
      setDiag('diagWifiRssi', line.substring(5).trim());
    } else if (line.startsWith('MQTT Status:')) {
      setDiag('diagMqttStatus', line.substring(12).trim());
    } else if (line.startsWith('MQTT Auth Method:')) {
      setDiag('diagMqttAuth', line.substring(17).trim());
    } else if (line.startsWith('Local Session Token:')) {
      const tok = line.substring(20).trim();
      sessionToken = tok;
      const detEl = document.getElementById('detectedToken');
      if (detEl) detEl.textContent = tok;
      
      // If no current device key is selected, fall back to what was auto-read from board!
      if (!currentDeviceKey) {
        currentDeviceKey = tok;
      }
      if (btnAuthenticate) btnAuthenticate.disabled = false;
    } else if (line.startsWith('Local WSS Status:')) {
      setDiag('diagWssStatus', line.substring(17).trim());
    } else if (line.startsWith('BLE Status:')) {
      setDiag('diagBleStatus', line.substring(11).trim());
    }
  }

  async function doAuthenticate() {
    if (!window.lastChallengeNonce) {
      return alert("No Challenge Nonce received from device yet. Please click status or tap the reset button on your device to trigger a challenge nonce.");
    }
    
    try {
      logSerial("Submitting challenge nonce to factory backend for signature...", 'log-system');
      const res = await fetch(`${factoryApiRoot}/sign-nonce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce: window.lastChallengeNonce })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Signing failed");

      logSerial(`Received cryptographic signature from backend: ${data.signature}`, 'log-system');
      writeSerial(`AUTH:${data.signature}`);
    } catch (err) {
      alert("Failed to compute signature on backend: " + err.message);
    }
  }

  async function doPerformFactorySetup() {
    if (!currentDeviceData) {
      return alert("Please select a device from the registry table first.");
    }
    
    // Validate we have permanent credentials loaded (usually on fresh provisioning)
    if (currentDeviceData.permanent_mqtt?.password === '• • • • • • • •' || !currentDeviceKey || currentDeviceKey === 'Stored Securely') {
      return alert("Factory Setup is only available immediately after generating a new device record, as the unhashed password and token are only displayed once for security. If this is an existing device, download the flash .zip file instead.");
    }

    const payload = {
      device_id: currentDeviceData.device_id,
      user: currentDeviceData.permanent_mqtt?.username,
      pass: currentDeviceData.permanent_mqtt?.password,
      token: currentDeviceKey,
      r_cnt: String(currentDeviceData.relay_count || 1)
    };

    await writeSerial(`PROV_PERM:${JSON.stringify(payload)}`);
    alert("Permanent setup details sent successfully over Serial! The device will store these parameters in NVS and reboot.");
  }

  async function sendCredentialsToDevice() {
    if (!currentDeviceData || !currentDeviceData.device_id) {
      return alert("Please select a device from the table first.");
    }
    if (!serialPort) {
      return alert("Please connect the device via USB Serial first.");
    }

    // Start WiFi Scanning
    window.scannedNetworks = [];
    window.isScanningWifi = true;
    logSerial("Initiating WiFi scan on physical ESP32 over serial...\n", "log-system");
    await writeSerial("SCAN");

    // Wait 3.5 seconds for the scan to gather SSIDs
    const scannedList = await new Promise((resolve) => {
      window.onScanFinished = (list) => resolve(list);
      setTimeout(() => {
        resolve(window.scannedNetworks || []);
        window.onScanFinished = null;
      }, 3500);
    });

    let selectedSSID = "";
    if (scannedList.length > 0) {
      const promptMsg = "Discovered surrounding WiFi networks:\n\n" + 
        scannedList.map((net, i) => `[${i + 1}]  📶 ${net}`).join("\n") + 
        "\n\nEnter the NUMBER of the network to select, or type your own SSID directly:";
      const userInput = prompt(promptMsg, "");
      if (userInput === null) return; // Cancelled
      const num = parseInt(userInput.trim());
      if (!isNaN(num) && num >= 1 && num <= scannedList.length) {
        selectedSSID = scannedList[num - 1];
      } else {
        selectedSSID = userInput.trim();
      }
    } else {
      selectedSSID = prompt("No nearby networks auto-detected. Enter local WiFi SSID manually:", "");
      if (selectedSSID === null) return; // Cancelled
    }

    if (!selectedSSID.trim()) return alert("SSID cannot be blank.");

    const wifiPASS = prompt(`Enter Password for WiFi network "${selectedSSID}":`, "");
    if (wifiPASS === null) return;

    const key = document.getElementById('factoryKeyInput')?.value;
    try {
      const res = await fetch(`${factoryApiRoot}/device/${currentDeviceData.device_id}/provision-tokens`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      sessionToken = data.session_token;
      
      const payload = {
        ssid: selectedSSID.trim(), 
        pass: wifiPASS,
        mqtt_u: data.mqtt_user,
        mqtt_p: data.mqtt_pass,
        l_tok: data.session_token
      };

      await writeSerial(`PROV:${JSON.stringify(payload)}`);
      if (btnAuthenticate) btnAuthenticate.disabled = false;
      alert(`SSID ("${selectedSSID}"), Password, and secure temporary tokens written to ESP32! The device will now reboot and connect.`);
    } catch (err) {
      alert("Error sending credentials: " + err.message);
    }
  }

  async function writeSerial(text) {
    if (!serialPort) return;
    try {
      const writer = serialPort.writable.getWriter();
      await writer.write(new TextEncoder().encode(text + '\n'));
      writer.releaseLock();
    } catch (err) {
      console.error("Web Serial write error:", err);
    }
  }

  function sendManualInput() {
    if (!serialInput) return;
    const value = serialInput.value;
    if (!value) return;
    writeSerial(value);
    logSerial(value + '\n', 'log-tx');
    serialInput.value = '';
  }

  function logSerial(msg, cls) {
    const log = document.getElementById('serialLog');
    if (!log) return;
    
    // Treat HTML line breaks properly
    const lines = msg.split('\n');
    lines.forEach(line => {
      if (!line.trim()) return;
      const div = document.createElement('div');
      div.className = cls;
      div.textContent = `[${new Date().toLocaleTimeString()}] ${line}`;
      log.appendChild(div);
    });
    
    log.scrollTop = log.scrollHeight;
  }
});
