document.addEventListener('DOMContentLoaded', () => {

  // ─── Element References ───────────────────────────────────────────────────
  const btnProvision         = document.getElementById('btnProvision');
  const btnRefresh           = document.getElementById('btnRefresh');
  const btnDownloadFirmwareZip = document.getElementById('btnDownloadFirmwareZip');
  const btnReplaceHardware   = document.getElementById('btnReplaceHardware');
  const btnConfirmReplace    = document.getElementById('btnConfirmReplace');
  const btnCancelReplace     = document.getElementById('btnCancelReplace');
  const replacePanel         = document.getElementById('replacePanel');
  const replaceNotes         = document.getElementById('replaceNotes');
  
  const btnConnectUsb        = document.getElementById('btnConnectUsb');
  const btnDisconnectUsb     = document.getElementById('btnDisconnectUsb');
  const btnGlobalConnectUsb  = document.getElementById('btnGlobalConnectUsb');
  const btnAuthenticate      = document.getElementById('btnAuthenticate');
  const btnSendCredentials   = document.getElementById('btnSendCredentials');
  const btnCmdStatus         = document.getElementById('btnCmdStatus');
  const btnStopDevice        = document.getElementById('btnStopDevice');
  const btnClearNvs          = document.getElementById('btnClearNvs');
  const btnFactoryReset      = document.getElementById('btnFactoryReset');
  const btnReauth            = document.getElementById('btnReauth');
  
  const btnSerialSend        = document.getElementById('btnSerialSend');
  const btnClearLog          = document.getElementById('btnClearLog');
  const keyInput             = document.getElementById('factoryKeyInput');
  const relayCountInput      = document.getElementById('relayCountInput');
  const baudRateSelect       = document.getElementById('baudRate');
  const resultSection        = document.getElementById('resultSection');
  const authPanel            = document.getElementById('authPanel');
  const usbStatusBadge       = document.getElementById('usbStatusBadge');
  const globalUsbStatus      = document.getElementById('globalUsbStatus');
  const globalBleStatus      = document.getElementById('globalBleStatus');
  const authStatusBadge      = document.getElementById('authStatusBadge');
  const detectedTokenEl      = document.getElementById('detectedToken');
  const serialLog            = document.getElementById('serialLog');
  const serialInput          = document.getElementById('serialInput');
  const chkAutoscroll        = document.getElementById('chkAutoscroll');

  const factoryApiRoot = '/api/v1/factory';
  const SERVICE_UUID        = "12345678-1234-1234-1234-123456789abc";
  const CHARACTERISTIC_UUID = "abcdefab-1234-1234-1234-abcdefabcdef";

  // ─── State ────────────────────────────────────────────────────────────────
  let currentDeviceData  = null;
  let serialPort         = null;
  let bleDevice          = null;
  let bleChar            = null;
  let readLoopActive     = false;
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

  btnConnectUsb.onclick = connectSerial;
  btnDisconnectUsb.onclick = disconnectSerial;
  btnGlobalConnectUsb.onclick = connectSerial;
  btnAuthenticate.onclick = doAuthenticate;
  
  btnSendCredentials.onclick = sendCredentialsToDevice;
  btnCmdStatus.onclick = () => sendCommand('CMD:STATUS', '📋 Fetching status...');
  btnStopDevice.onclick = () => sendCommand('CMD:STOP_ALL', '⛔ Stopping all connections...');
  btnClearNvs.onclick = () => sendCommand('CMD:CLEAR_NVS', '🧹 Clearing NVS...');
  btnFactoryReset.onclick = () => sendCommand('CMD:FACTORY_RESET', '🗑 Factory resetting...');
  btnReauth.onclick = requestReauth;

  btnSerialSend.onclick = sendManualInput;
  btnClearLog.onclick = () => serialLog.innerHTML = '';
  serialInput.onkeydown = e => { if (e.key === 'Enter') sendManualInput(); };

  // --- BLE AUTO-DISCOVERY ---
  const btnScanBle = document.createElement('button');
  btnScanBle.className = 'btn secondary small';
  btnScanBle.textContent = '📡 Scan BLE';
  btnScanBle.onclick = scanBLE;
  document.querySelector('.usb-btn-group').appendChild(btnScanBle);

  async function scanBLE() {
    try {
      logSerial('[BLE] Scanning for IoTYK devices...', 'log-info');
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
        optionalServices: [SERVICE_UUID]
      });

      logSerial(`[BLE] Found: ${device.name}. Connecting...`, 'log-ok');
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      bleChar = await service.getCharacteristic(CHARACTERISTIC_UUID);
      bleDevice = device;

      device.addEventListener('gattserverdisconnected', onBleDisconnected);
      
      globalBleStatus.className = 'status-badge status-online';
      globalBleStatus.textContent = 'BLE CONNECTED';
      authPanel?.classList.remove('hidden'); 
      setAuthState(true); 
      
      logSerial(`[BLE] Secure link established with ${device.name}`, 'log-ok');
    } catch (err) {
      logSerial(`[BLE] Scan failed: ${err.message}`, 'log-err');
    }
  }

  function onBleDisconnected() {
    globalBleStatus.className = 'status-badge status-offline';
    globalBleStatus.textContent = 'BLE DISCONNECTED';
    bleDevice = null;
    bleChar = null;
    logSerial('[BLE] Device disconnected.', 'log-warn');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PROVISIONING & DATA
  // ─────────────────────────────────────────────────────────────────────────

  async function loadDevices() {
    try {
      const res = await fetch(`${factoryApiRoot}/devices`, { headers: { 'Authorization': `Bearer ${keyInput.value}` } });
      if (!res.ok) return;
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
            <button class="btn primary small" onclick="fetchDeviceDetails('${device.device_id}')">Configure</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {}
  }

  window.fetchDeviceDetails = async (deviceId) => {
    try {
      const res = await fetch(`${factoryApiRoot}/devices`, { headers: { 'Authorization': `Bearer ${keyInput.value}` } });
      const data = await res.json();
      const device = data.devices.find(d => d.device_id === deviceId);
      if (device) displayResult({ 
        qr_data: { device_id: device.device_id, device_key: 'Stored' },
        firmware_config: { device_id: device.device_id, relay_count: device.relay_count, namespace: device.namespace, permanent_mqtt: { username: '...', password: '...' } }
      });
    } catch (err) {}
  };

  async function provisionDevice() {
    const res = await fetch(`${factoryApiRoot}/device`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${keyInput.value}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ relay_count: Number(relayCountInput.value) })
    });
    const data = await res.json();
    displayResult(data);
    loadDevices();
  }

  function displayResult(data) {
    const { qr_data, firmware_config } = data;
    currentDeviceData = firmware_config;
    document.getElementById('lblDeviceId').textContent = qr_data.device_id;
    resultSection.classList.remove('hidden');
  }

  async function sendCredentialsToDevice() {
    const ssid = prompt("WiFi SSID:");
    const pass = prompt("WiFi Password:");
    if (!ssid) return;

    const res = await fetch(`${factoryApiRoot}/device/${currentDeviceData.device_id}/provision-tokens`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${keyInput.value}` }
    });
    const tokens = await res.json();
    const packet = `PROVISION:${ssid}|${pass}|${tokens.mqtt_user}|${tokens.mqtt_pass}|${tokens.session_token}|${tokens.device_key}`;

    if (bleChar) {
      logSerial('[BLE] Writing secure packet...', 'log-info');
      await bleChar.writeValue(new TextEncoder().encode(packet));
      logSerial('[BLE] Provisioned!', 'log-ok');
    } else {
      await writeSerial(packet);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SERIAL & HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  async function connectSerial() {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    serialPort = port;
    globalUsbStatus.className = 'status-badge status-online';
    globalUsbStatus.textContent = 'USB CONNECTED';
    authPanel.classList.remove('hidden');
    startReadLoop(port);
  }

  async function disconnectSerial() {
    if (serialPort) { await serialPort.close(); serialPort = null; }
    globalUsbStatus.className = 'status-badge status-offline';
    globalUsbStatus.textContent = 'USB DISCONNECTED';
  }

  async function writeSerial(text) {
    if (!serialPort) return;
    const writer = serialPort.writable.getWriter();
    await writer.write(new TextEncoder().encode(text + '\n'));
    writer.releaseLock();
  }

  async function sendCommand(cmd, label) {
    logSerial(`→ ${cmd}`, 'log-tx');
    if (bleChar) await bleChar.writeValue(new TextEncoder().encode(cmd));
    else await writeSerial(cmd);
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
    if (!('serial' in navigator)) alert("Serial not supported");
  }
});
