document.addEventListener('DOMContentLoaded', () => {

  // ─── Element References ───────────────────────────────────────────────────
  const btnProvision         = document.getElementById('btnProvision');
  const btnRefresh           = document.getElementById('btnRefresh');
  const btnDownloadFirmwareZip = document.getElementById('btnDownloadFirmwareZip');
  const btnReplaceHardware   = document.getElementById('btnReplaceHardware');
  const btnConfirmReplace    = document.getElementById('btnConfirmReplace');
  const btnCancelReplace     = document.getElementById('btnCancelReplace');
  const replacePanel         = document.getElementById('replacePanel');
  
  const btnDisconnectUsb     = document.getElementById('btnDisconnectUsb');
  const btnGlobalConnectUsb  = document.getElementById('btnGlobalConnectUsb');
  const btnAuthenticate      = document.getElementById('btnAuthenticate');
  const btnSendCredentials   = document.getElementById('btnSendCredentials');
  const btnCmdStatus         = document.getElementById('btnCmdStatus');
  const btnClearNvs          = document.getElementById('btnClearNvs');
  const btnFactoryReset      = document.getElementById('btnFactoryReset');
  const btnReauth            = document.getElementById('btnReauth');
  
  const btnSerialSend        = document.getElementById('btnSerialSend');
  const btnClearLog          = document.getElementById('btnClearLog');
  const keyInput             = document.getElementById('factoryKeyInput');
  const relayCountInput      = document.getElementById('relayCountInput');
  const resultSection        = document.getElementById('resultSection');
  const authPanel            = document.getElementById('authPanel');
  const globalUsbStatus      = document.getElementById('globalUsbStatus');
  const authStatusBadge      = document.getElementById('authStatusBadge');
  const detectedTokenEl      = document.getElementById('detectedToken');
  const serialLog            = document.getElementById('serialLog');
  const serialInput          = document.getElementById('serialInput');

  const factoryApiRoot = '/api/v1/factory';

  // ─── State ────────────────────────────────────────────────────────────────
  let currentDeviceData  = null;
  let serialPort         = null;
  let sessionToken       = '';     
  let sessionAuthed      = false;  

  // ─── Boot ─────────────────────────────────────────────────────────────────
  loadDevices();
  checkSerialSupport();

  // ─── Listeners ────────────────────────────────────────────────────────────
  btnProvision.onclick = provisionDevice;
  btnRefresh.onclick = loadDevices;
  btnDownloadFirmwareZip.onclick = downloadFirmwareZip;
  
  btnReplaceHardware.onclick = () => replacePanel.classList.remove('hidden');
  btnCancelReplace.onclick = () => replacePanel.classList.add('hidden');
  btnConfirmReplace.onclick = confirmHardwareReplacement;

  btnDisconnectUsb.onclick = disconnectSerial;
  btnGlobalConnectUsb.onclick = connectSerial;
  btnAuthenticate.onclick = doAuthenticate;
  
  btnSendCredentials.onclick = sendCredentialsToDevice;
  btnCmdStatus.onclick = () => sendCommand('CMD:STATUS');
  btnClearNvs.onclick = () => sendCommand('CMD:CLEAR_NVS');
  btnFactoryReset.onclick = () => sendCommand('CMD:FACTORY_RESET');
  btnReauth.onclick = requestReauth;

  btnSerialSend.onclick = sendManualInput;
  btnClearLog.onclick = () => serialLog.innerHTML = '';
  serialInput.onkeydown = e => { if (e.key === 'Enter') sendManualInput(); };

  // ─────────────────────────────────────────────────────────────────────────
  // API ACTIONS
  // ─────────────────────────────────────────────────────────────────────────

  async function loadDevices() {
    try {
      const res = await fetch(`${factoryApiRoot}/devices`, { 
        headers: { 'Authorization': `Bearer ${keyInput.value}` } 
      });
      if (!res.ok) throw new Error("Auth failed");
      const data = await res.json();
      const tbody = document.getElementById('deviceTableBody');
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
    } catch (err) { logSerial("API Error: " + err.message, "log-err"); }
  }

  async function provisionDevice() {
    try {
      const res = await fetch(`${factoryApiRoot}/device`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${keyInput.value}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ relay_count: Number(relayCountInput.value) })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      displayResult(data);
      loadDevices();
    } catch (err) { alert(err.message); }
  }

  window.deleteDevice = async (deviceId) => {
    if (!confirm(`Delete ${deviceId}? This is permanent.`)) return;
    try {
      await fetch(`${factoryApiRoot}/device/${deviceId}`, {
        method: 'DELETE', headers: { 'Authorization': `Bearer ${keyInput.value}` }
      });
      loadDevices();
    } catch (err) { alert(err.message); }
  };

  window.fetchDeviceDetails = async (deviceId) => {
    try {
      const res = await fetch(`${factoryApiRoot}/devices`, { headers: { 'Authorization': `Bearer ${keyInput.value}` } });
      const data = await res.json();
      const device = data.devices.find(d => d.device_id === deviceId);
      if (device) displayResult({ 
        qr_data: { device_id: device.device_id },
        firmware_config: { device_id: device.device_id }
      });
    } catch (err) {}
  };

  function displayResult(data) {
    currentDeviceData = data.firmware_config;
    document.getElementById('lblDeviceId').textContent = data.qr_data.device_id;
    resultSection.classList.remove('hidden');
  }

  async function confirmHardwareReplacement() {
    try {
      const res = await fetch(`${factoryApiRoot}/device/${currentDeviceData.device_id}/replace-hardware`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${keyInput.value}` }
      });
      const data = await res.json();
      alert("Hardware invalidated. New Master Key generated for this ID.");
      replacePanel.classList.add('hidden');
      loadDevices();
    } catch (err) { alert(err.message); }
  }

  function downloadFirmwareZip() {
    window.location.href = `${factoryApiRoot}/device/${currentDeviceData.device_id}/firmware-package?key=${keyInput.value}`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // USB SERIAL MONITOR
  // ─────────────────────────────────────────────────────────────────────────

  async function connectSerial() {
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      serialPort = port;
      globalUsbStatus.className = 'status-badge status-online';
      globalUsbStatus.textContent = 'USB CONNECTED';
      authPanel.classList.remove('hidden');
      logSerial("USB Connected at 115200 baud.", "log-info");
      startReadLoop(port);
    } catch (err) { logSerial("Connection failed: " + err.message, "log-err"); }
  }

  async function disconnectSerial() {
    if (serialPort) { await serialPort.close(); serialPort = null; }
    globalUsbStatus.className = 'status-badge status-offline';
    globalUsbStatus.textContent = 'USB DISCONNECTED';
    authPanel.classList.add('hidden');
  }

  async function startReadLoop(port) {
    const decoder = new TextDecoderStream();
    port.readable.pipeTo(decoder.writable);
    const reader = decoder.readable.getReader();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          const clean = line.trim();
          if (!clean) continue;
          if (clean.includes('Session token:')) onTokenDetected(clean.split(': ')[1]);
          if (clean === 'AUTH:OK') setAuthState(true);
          logSerial(`← ${clean}`, 'log-rx');
        }
      }
    } catch (err) { logSerial("Read error: " + err.message, "log-err"); }
  }

  async function sendCredentialsToDevice() {
    const ssid = prompt("WiFi SSID:");
    const pass = prompt("WiFi Password:");
    if (!ssid) return;

    try {
      const tRes = await fetch(`${factoryApiRoot}/device/${currentDeviceData.device_id}/provision-tokens`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${keyInput.value}` }
      });
      const tData = await tRes.json();
      const cmd = `CMD:PROVISION|${ssid}|${pass}|${tData.mqtt_user}|${tData.mqtt_pass}|${tData.session_token}|${tData.device_key}`;
      await writeSerial(cmd);
      logSerial("Provisioning packet sent via USB.", "log-ok");
    } catch (err) { alert(err.message); }
  }

  async function writeSerial(text) {
    if (!serialPort) return;
    const writer = serialPort.writable.getWriter();
    await writer.write(new TextEncoder().encode(text + '\n'));
    writer.releaseLock();
  }

  async function sendCommand(cmd) {
    logSerial(`→ ${cmd}`, 'log-tx');
    await writeSerial(cmd);
  }

  function onTokenDetected(token) {
    sessionToken = token;
    detectedTokenEl.textContent = token;
    btnAuthenticate.disabled = false;
  }

  async function doAuthenticate() {
    await writeSerial(`AUTH:${sessionToken}`);
  }

  async function requestReauth() {
    await writeSerial('CMD:REAUTH');
    setAuthState(false);
  }

  async function sendManualInput() {
    const text = serialInput.value.trim();
    if (!text) return;
    await writeSerial(text);
    serialInput.value = '';
    logSerial(`→ ${text}`, 'log-tx');
  }

  function setAuthState(authed) {
    sessionAuthed = authed;
    authStatusBadge.textContent = authed ? '✓ AUTHENTICATED' : 'NOT AUTHENTICATED';
    authStatusBadge.className = `status-badge ${authed ? 'status-online' : 'status-offline'}`;
  }

  function logSerial(msg, cls) {
    const div = document.createElement('div');
    div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    if (cls) div.className = cls;
    serialLog.appendChild(div);
    serialLog.scrollTop = serialLog.scrollHeight;
  }

  function checkSerialSupport() {
    if (!('serial' in navigator)) alert("Web Serial API not supported in this browser. Please use Chrome or Edge.");
  }
});
