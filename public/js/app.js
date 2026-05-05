// ─── Global State ───────────────────────────────────────────────────────────
let currentDeviceData = null;
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
      window.displayResult({
        qr_data: { device_id: device.device_id },
        firmware_config: { device_id: device.device_id }
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
  const lbl = document.getElementById('lblDeviceId');
  const sec = document.getElementById('resultSection');
  if (lbl) lbl.textContent = data.qr_data.device_id;
  if (sec) sec.classList.remove('hidden');
};

// ─── DOM Initialization ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const btnProvision = document.getElementById('btnProvision');
  const btnRefresh = document.getElementById('btnRefresh');
  const btnDownloadFirmwareZip = document.getElementById('btnDownloadFirmwareZip');
  const btnReplaceHardware = document.getElementById('btnReplaceHardware');
  const btnConfirmReplace = document.getElementById('btnConfirmReplace');
  const btnCancelReplace = document.getElementById('btnCancelReplace');
  const btnGlobalConnectUsb = document.getElementById('btnGlobalConnectUsb');
  const btnDisconnectUsb = document.getElementById('btnDisconnectUsb');
  const btnAuthenticate = document.getElementById('btnAuthenticate');
  const btnSendCredentials = document.getElementById('btnSendCredentials');
  const btnSerialSend = document.getElementById('btnSerialSend');
  const serialInput = document.getElementById('serialInput');

  // Wire up event listeners
  if (btnProvision) btnProvision.onclick = provisionDevice;
  if (btnRefresh) btnRefresh.onclick = window.loadDevices;
  if (btnDownloadFirmwareZip) btnDownloadFirmwareZip.onclick = downloadFirmwareZip;
  if (btnReplaceHardware) btnReplaceHardware.onclick = () => document.getElementById('replacePanel')?.classList.remove('hidden');
  if (btnCancelReplace) btnCancelReplace.onclick = () => document.getElementById('replacePanel')?.classList.add('hidden');
  if (btnConfirmReplace) btnConfirmReplace.onclick = confirmHardwareReplacement;
  if (btnGlobalConnectUsb) btnGlobalConnectUsb.onclick = connectSerial;
  if (btnDisconnectUsb) btnDisconnectUsb.onclick = disconnectSerial;
  if (btnAuthenticate) btnAuthenticate.onclick = doAuthenticate;
  if (btnSendCredentials) btnSendCredentials.onclick = sendCredentialsToDevice;
  if (btnSerialSend) btnSerialSend.onclick = sendManualInput;

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
      await fetch(`${factoryApiRoot}/device/${currentDeviceData.device_id}/replace-hardware`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${key}` }
      });
      alert("Hardware invalidated. New Master Key generated.");
      document.getElementById('replacePanel')?.classList.add('hidden');
      window.loadDevices();
    } catch (err) { alert(err.message); }
  }

  function downloadFirmwareZip() {
    const key = document.getElementById('factoryKeyInput')?.value;
    window.location.href = `${factoryApiRoot}/device/${currentDeviceData.device_id}/firmware-package?key=${key}`;
  }

  async function connectSerial() {
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      serialPort = port;
      updateUsbStatus(true);
      startReadLoop(port);
    } catch (err) { alert("USB Error: " + err.message); }
  }

  async function disconnectSerial() {
    if (serialPort) { await serialPort.close(); serialPort = null; }
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
  }

  async function startReadLoop(port) {
    const decoder = new TextDecoderStream();
    port.readable.pipeTo(decoder.writable);
    const reader = decoder.readable.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        logSerial(value, 'log-rx');
      }
    } catch (err) { console.error(err); }
  }

  async function doAuthenticate() {
    // Logic for AUTH command
    writeSerial(`AUTH:${sessionToken}`);
  }

  async function sendCredentialsToDevice() {
    // Provisioning logic
  }

  async function writeSerial(text) {
    if (!serialPort) return;
    const writer = serialPort.writable.getWriter();
    await writer.write(new TextEncoder().encode(text + '\n'));
    writer.releaseLock();
  }

  function sendManualInput() {
    const input = document.getElementById('serialInput');
    if (!input || !input.value) return;
    writeSerial(input.value);
    logSerial(input.value, 'log-tx');
    input.value = '';
  }

  function logSerial(msg, cls) {
    const log = document.getElementById('serialLog');
    if (!log) return;
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }
});
