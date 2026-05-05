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
  const authStatusBadge      = document.getElementById('authStatusBadge');
  const detectedTokenEl      = document.getElementById('detectedToken');
  const serialLog            = document.getElementById('serialLog');
  const serialInput          = document.getElementById('serialInput');
  const chkAutoscroll        = document.getElementById('chkAutoscroll');

  const historyModal         = document.getElementById('historyModal');
  const btnCloseHistory      = document.getElementById('btnCloseHistory');
  const historyContent       = document.getElementById('historyContent');
  const historyModalTitle    = document.getElementById('historyModalTitle');

  const factoryApiRoot = '/api/v1/factory';

  // ─── State ────────────────────────────────────────────────────────────────
  let currentDeviceData  = null;
  let serialPort         = null;
  let readLoopActive     = false;
  let sessionToken       = '';     // auto-detected from ESP32 serial output
  let sessionAuthed      = false;  // true after AUTH:OK received

  // ─── Boot ─────────────────────────────────────────────────────────────────
  loadDevices();
  checkSerialSupport();

  // ─── Listeners ────────────────────────────────────────────────────────────
  btnProvision.addEventListener('click', provisionDevice);
  btnRefresh.addEventListener('click', loadDevices);
  btnDownloadFirmwareZip.addEventListener('click', downloadFirmwareZip);
  
  btnReplaceHardware.addEventListener('click', () => replacePanel.classList.remove('hidden'));
  btnCancelReplace.addEventListener('click', () => replacePanel.classList.add('hidden'));
  btnConfirmReplace.addEventListener('click', confirmHardwareReplacement);

  btnConnectUsb.addEventListener('click', connectSerial);
  btnDisconnectUsb.addEventListener('click', disconnectSerial);
  btnGlobalConnectUsb.addEventListener('click', connectSerial);
  btnAuthenticate.addEventListener('click', doAuthenticate);
  
  btnSendCredentials.addEventListener('click', sendCredentialsToDevice);
  btnCmdStatus.addEventListener('click', () => sendCommand('CMD:STATUS', '📋 Fetching status...'));
  btnStopDevice.addEventListener('click', () => sendCommand('CMD:STOP_ALL', '⛔ Stopping all connections...'));
  btnClearNvs.addEventListener('click', () => sendCommand('CMD:CLEAR_NVS', '🧹 Clearing NVS...'));
  btnFactoryReset.addEventListener('click', () => sendCommand('CMD:FACTORY_RESET', '🗑 Factory resetting...'));
  btnReauth.addEventListener('click', requestReauth);

  btnSerialSend.addEventListener('click', sendManualInput);
  btnClearLog.addEventListener('click', () => serialLog.innerHTML = '');
  serialInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendManualInput(); });

  btnCloseHistory.addEventListener('click', () => historyModal.classList.add('hidden'));

  // ─────────────────────────────────────────────────────────────────────────
  // SERIAL SUPPORT CHECK
  // ─────────────────────────────────────────────────────────────────────────

  function checkSerialSupport() {
    if (!('serial' in navigator)) {
      logSerial('⚠ Web Serial API not supported. Use Chrome or Edge over HTTPS.', 'log-err');
      [btnConnectUsb, btnGlobalConnectUsb].forEach(b => b.disabled = true);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PROVISIONING
  // ─────────────────────────────────────────────────────────────────────────

  async function provisionDevice() {
    btnProvision.disabled = true;
    btnProvision.textContent = 'Generating…';
    resultSection.classList.add('hidden');

    try {
      const res = await fetch(`${factoryApiRoot}/device`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${keyInput.value}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ relay_count: Number(relayCountInput.value || 1) })
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Provision failed'); }
      const data = await res.json();
      
      displayResult(data);
      loadDevices();
      
      document.getElementById('resultBannerTitle').textContent = 'Device Provisioned Successfully';
      document.getElementById('resultBannerSub').textContent = 'New identity created in database.';
      btnReplaceHardware.classList.add('hidden'); // New device doesn't need replace button immediately
      
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      btnProvision.disabled = false;
      btnProvision.textContent = '＋ Generate Device';
    }
  }

  function displayResult(data) {
    const { qr_data, firmware_config, hardware_status } = data;

    // QR
    const qrContainer = document.getElementById('qrcode');
    qrContainer.innerHTML = '';
    new QRCode(qrContainer, {
      text: JSON.stringify(qr_data), width: 140, height: 140,
      colorDark: '#000000', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });

    document.getElementById('lblDeviceId').textContent  = qr_data.device_id;
    document.getElementById('lblDeviceKey').textContent = qr_data.device_key;
    document.getElementById('fwDeviceId').textContent   = firmware_config.device_id;
    document.getElementById('fwRelayCount').textContent = firmware_config.relay_count;
    document.getElementById('fwRelayPins').textContent  = (firmware_config.relay_pins || []).join(', ');
    document.getElementById('fwNamespace').textContent  = firmware_config.namespace;
    document.getElementById('fwPermUser').textContent   = firmware_config.permanent_mqtt.username;
    document.getElementById('fwPermPass').textContent   = firmware_config.permanent_mqtt.password;

    // HW status row (if exists)
    const hwRow = document.getElementById('hwStatusRow');
    if (hardware_status) {
      hwRow.classList.remove('hidden');
      document.getElementById('hwFlashBadge').textContent = `Flashes: ${hardware_status.flash_count}`;
      document.getElementById('hwReplaceBadge').textContent = `Replacements: ${hardware_status.hardware_replace_count}`;
      document.getElementById('hwLastFlash').textContent = hardware_status.last_flashed_at 
        ? `Last: ${new Date(hardware_status.last_flashed_at).toLocaleString()}`
        : 'Never flashed';
    } else {
      hwRow.classList.add('hidden');
    }

    currentDeviceData = {
      device_id:   firmware_config.device_id,
      namespace:   firmware_config.namespace,
      mqtt_user:   firmware_config.permanent_mqtt.username,
      mqtt_pass:   firmware_config.permanent_mqtt.password,
      relay_count: firmware_config.relay_count,
      relay_pins:  firmware_config.relay_pins || [],
    };

    resultSection.classList.remove('hidden');
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    logSerial(`[INFO] Loaded device: ${firmware_config.device_id}`, 'log-info');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DOWNLOAD & REPLACE
  // ─────────────────────────────────────────────────────────────────────────

  async function downloadFirmwareZip() {
    if (!currentDeviceData) { alert('No device selected.'); return; }
    await triggerFirmwarePackageDownload(currentDeviceData.device_id);
  }

  async function triggerFirmwarePackageDownload(deviceId) {
    try {
      const res = await fetch(`${factoryApiRoot}/device/${encodeURIComponent(deviceId)}/firmware-package`,
        { headers: { 'Authorization': `Bearer ${keyInput.value}` } });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `Server error ${res.status}`); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href = url; a.download = `${deviceId}_flash_package.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      logSerial(`[INFO] Firmware ZIP downloaded for ${deviceId}`, 'log-info');
      
      // Refresh to update flash count
      setTimeout(loadDevices, 1000);
    } catch (err) {
      alert(`Download error: ${err.message}`);
    }
  }

  async function confirmHardwareReplacement() {
    if (!currentDeviceData) return;
    const deviceId = currentDeviceData.device_id;
    const notes = replaceNotes.value.trim();
    
    btnConfirmReplace.disabled = true;
    btnConfirmReplace.textContent = 'Processing...';

    try {
      const res = await fetch(`${factoryApiRoot}/device/${encodeURIComponent(deviceId)}/replace-hardware`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${keyInput.value}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes })
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Replace failed'); }
      const data = await res.json();
      
      alert(data.message);
      replacePanel.classList.add('hidden');
      replaceNotes.value = '';
      
      // Refresh view
      fetchDeviceDetails(deviceId, true);
      loadDevices();
      
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      btnConfirmReplace.disabled = false;
      btnConfirmReplace.textContent = 'Confirm Hardware Replacement';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // WEB SERIAL — CONNECT / DISCONNECT
  // ─────────────────────────────────────────────────────────────────────────

  async function connectSerial() {
    if (!('serial' in navigator)) { alert('Use Chrome/Edge over HTTPS.'); return; }
    try {
      const port  = await navigator.serial.requestPort();
      const baud  = parseInt(baudRateSelect?.value || '115200', 10);
      await port.open({ baudRate: baud });
      serialPort = port;
      setUsbConnected(true);
      logSerial(`[USB] Connected at ${baud} baud`, 'log-ok');
      startReadLoop(port);
    } catch (err) {
      if (err.name !== 'NotFoundError') logSerial(`[USB] Connect failed: ${err.message}`, 'log-err');
    }
  }

  async function disconnectSerial() {
    readLoopActive = false;
    try {
      if (serialPort) { await serialPort.close(); serialPort = null; }
    } catch (_) {}
    setUsbConnected(false);
    setAuthState(false);
    sessionToken = '';
    logSerial('[USB] Disconnected. Token session cleared.', 'log-info');
  }

  function setUsbConnected(connected) {
    const badge = connected ? 'status-online'  : 'status-offline';
    const text  = connected ? 'CONNECTED'      : 'DISCONNECTED';
    usbStatusBadge.className   = `status-badge ${badge}`;
    usbStatusBadge.textContent  = text;
    globalUsbStatus.className   = `status-badge ${badge}`;
    globalUsbStatus.textContent = `USB ${text}`;

    btnConnectUsb.classList.toggle('hidden', connected);
    btnDisconnectUsb.classList.toggle('hidden', !connected);
    authPanel?.classList.toggle('hidden', !connected);

    if (!connected) setCommandsEnabled(false);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AUTH STATE MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────

  function setAuthState(authed) {
    sessionAuthed = authed;
    authStatusBadge.textContent = authed ? '✓ AUTHENTICATED' : 'NOT AUTHENTICATED';
    authStatusBadge.className   = `status-badge ${authed ? 'status-authed' : 'status-offline'}`;
    if (detectedTokenEl) detectedTokenEl.className = `token-value ${authed ? 'authed' : 'detected'}`;
    authPanel?.classList.toggle('authed', authed);
    setCommandsEnabled(authed);
    if (authed) logSerial('[AUTH] ✓ Session authenticated. All commands unlocked.', 'log-ok');
  }

  function setCommandsEnabled(enabled) {
    [btnSendCredentials, btnCmdStatus, btnStopDevice, btnClearNvs, btnFactoryReset, btnReauth, btnSerialSend].forEach(b => {
      b.disabled = !enabled;
    });
  }

  function onTokenDetected(token) {
    sessionToken = token;
    sessionAuthed = false;
    if (detectedTokenEl) {
      detectedTokenEl.textContent = token;
      detectedTokenEl.className = 'token-value detected';
    }
    authStatusBadge.textContent = 'TOKEN DETECTED';
    authStatusBadge.className = 'status-badge status-pending';
    btnAuthenticate.disabled = false;
    logSerial(`[AUTH] ⚡ Session token detected: ${token}`, 'log-warn');
  }

  async function doAuthenticate() {
    if (!sessionToken) return;
    logSerial(`→ AUTH:${sessionToken}`, 'log-tx');
    await writeSerial(`AUTH:${sessionToken}`);
  }

  async function requestReauth() {
    logSerial('→ CMD:REAUTH', 'log-tx');
    await writeSerial('CMD:REAUTH');
    setAuthState(false);
    if (detectedTokenEl) {
      detectedTokenEl.textContent = 'Waiting for new token…';
      detectedTokenEl.className   = 'token-value';
    }
    btnAuthenticate.disabled = true;
    sessionToken = '';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SERIAL IO
  // ─────────────────────────────────────────────────────────────────────────

  async function startReadLoop(port) {
    readLoopActive = true;
    const decoder  = new TextDecoderStream();
    port.readable.pipeTo(decoder.writable).catch(() => { readLoopActive = false; });
    const reader   = decoder.readable.getReader();
    let buffer = '';

    while (readLoopActive) {
      try {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const raw of lines) {
          const line = raw.replace(/\r/g, '').trim();
          if (!line) continue;
          processIncomingLine(line);
        }
      } catch (err) {
        break;
      }
    }
    if (serialPort) { setUsbConnected(false); setAuthState(false); }
  }

  function processIncomingLine(line) {
    const tokenMatch = line.match(/\[AUTH\]\s+Session token:\s+([A-F0-9]{8,16})/i);
    if (tokenMatch) { onTokenDetected(tokenMatch[1].toUpperCase()); logSerial(`← ${line}`, 'log-rx'); return; }
    if (line === 'AUTH:OK') { setAuthState(true); logSerial(`← AUTH:OK`, 'log-ok'); return; }
    if (line === 'AUTH:FAIL') { logSerial('← AUTH:FAIL — Wrong token!', 'log-err'); return; }
    if (line === 'AUTH:REQUIRED') { logSerial('← AUTH:REQUIRED — Send AUTH:<token> first.', 'log-warn'); setAuthState(false); return; }
    logSerial(`← ${line}`, 'log-rx');
  }

  async function writeSerial(text) {
    if (!serialPort?.writable) return false;
    try {
      const encoder = new TextEncoder();
      const writer = serialPort.writable.getWriter();
      await writer.write(encoder.encode(text + '\n'));
      writer.releaseLock();
      return true;
    } catch (err) {
      logSerial(`[USB] Write error: ${err.message}`, 'log-err');
      return false;
    }
  }

  async function sendCommand(cmd, label = '') {
    if (!sessionAuthed) return;
    if (label) logSerial(`[INFO] ${label}`, 'log-info');
    logSerial(`→ ${cmd}`, 'log-tx');
    await writeSerial(cmd);
  }

  async function sendManualInput() {
    const text = serialInput.value.trim();
    if (!text) return;
    if (!text.startsWith('AUTH:') && !sessionAuthed) { logSerial('[AUTH] Locked. Send AUTH:<token> first.', 'log-err'); return; }
    logSerial(`→ ${text}`, 'log-tx');
    await writeSerial(text);
    serialInput.value = '';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CREDENTIAL SENDER
  // ─────────────────────────────────────────────────────────────────────────

  async function sendCredentialsToDevice() {
    if (!sessionAuthed) return;
    if (!currentDeviceData) return;

    if (currentDeviceData._fetchOnSend) {
      try {
        logSerial('[INFO] Fetching full credentials from server...', 'log-info');
        const res = await fetch(`${factoryApiRoot}/device/${encodeURIComponent(currentDeviceData.device_id)}/config.h`,
          { headers: { 'Authorization': `Bearer ${keyInput.value}` } });
        if (!res.ok) throw new Error('Fetch failed');
        const configText = await res.text();
        const extract = key => { const m = configText.match(new RegExp(`#define ${key} "([^"]+)"`)); return m ? m[1] : ''; };
        currentDeviceData.mqtt_user = extract('FACTORY_PERM_MQTT_USER');
        currentDeviceData.mqtt_pass = extract('FACTORY_PERM_MQTT_PASS');
        currentDeviceData.namespace = extract('FACTORY_DEVICE_NS');
        currentDeviceData._fetchOnSend = false;
        
        document.getElementById('fwNamespace').textContent = currentDeviceData.namespace;
        document.getElementById('fwPermUser').textContent  = currentDeviceData.mqtt_user;
        document.getElementById('fwPermPass').textContent  = '••••••••';
      } catch (err) {
        logSerial(`[ERROR] ${err.message}`, 'log-err');
        return;
      }
    }

    const localToken = Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(16).padStart(2, '0')).join('');
    const { device_id, namespace, mqtt_user, mqtt_pass } = currentDeviceData;
    const cmd = `CMD:PROVISION|${device_id}|${namespace}|${mqtt_user}|${mqtt_pass}|${localToken}`;

    logSerial('[INFO] Sending credentials to ESP32...', 'log-info');
    logSerial(`→ CMD:PROVISION|${device_id}|${namespace}|***|***|${localToken}`, 'log-tx');

    if (await writeSerial(cmd)) logSerial('[OK] Credentials sent! Device restarting.', 'log-ok');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DEVICE TABLE & MODAL
  // ─────────────────────────────────────────────────────────────────────────

  async function loadDevices() {
    try {
      const res = await fetch(`${factoryApiRoot}/devices`, { headers: { 'Authorization': `Bearer ${keyInput.value}` } });
      if (!res.ok) return;
      const data = await res.json();
      const tbody = document.getElementById('deviceTableBody');
      const count = document.getElementById('countConnected');
      tbody.innerHTML = '';
      if (count) count.textContent = data.devices.length;

      data.devices.forEach(device => {
        const tr = document.createElement('tr');
        const lastFlashed = device.last_flashed_at ? new Date(device.last_flashed_at).toLocaleString() : 'Never';
        const sc = device.is_online ? 'status-online' : 'status-offline';
        
        tr.innerHTML = `
          <td><strong>${device.device_id}</strong></td>
          <td>${device.relay_count || 1}</td>
          <td><span class="status-badge ${sc}">${device.is_online ? 'Online' : 'Offline'}</span></td>
          <td style="font-size:12px;color:var(--muted)">${device.owner_email || 'Unpaired'}</td>
          <td>${device.flash_count || 0}</td>
          <td>${device.hardware_replace_count || 0}</td>
          <td style="font-size:11px;color:var(--muted)">${lastFlashed}</td>
          <td class="table-actions"></td>
        `;

        const actionCell = tr.querySelector('.table-actions');
        
        const btnShow = document.createElement('button');
        btnShow.className = 'btn primary small'; btnShow.textContent = 'Configure';
        btnShow.onclick = () => fetchDeviceDetails(device.device_id);
        
        const btnHist = document.createElement('button');
        btnHist.className = 'btn secondary ultra-small'; btnHist.textContent = 'History';
        btnHist.onclick = () => showFlashHistory(device.device_id);

        const btnDel = document.createElement('button');
        btnDel.className = 'btn danger-outline ultra-small'; btnDel.textContent = '✕';
        btnDel.onclick = () => deleteDevice(device.device_id);

        actionCell.append(btnShow, btnHist, btnDel);
        tbody.appendChild(tr);
      });
    } catch (err) {}
  }

  async function fetchDeviceDetails(deviceId, isReplace = false) {
    try {
      const res = await fetch(`${factoryApiRoot}/devices`, { headers: { 'Authorization': `Bearer ${keyInput.value}` } });
      const data = await res.json();
      const device = data.devices.find(d => d.device_id === deviceId);
      if (!device) return;

      displayResult({
        qr_data: { device_id: device.device_id, device_key: 'Stored' },
        firmware_config: { 
          device_id: device.device_id, relay_count: device.relay_count, 
          namespace: device.namespace, permanent_mqtt: { username: `perm_${device.namespace}`, password: '••••••••' }
        },
        hardware_status: {
          flash_count: device.flash_count,
          hardware_replace_count: device.hardware_replace_count,
          last_flashed_at: device.last_flashed_at
        }
      });
      
      currentDeviceData._fetchOnSend = true;
      document.getElementById('resultBannerTitle').textContent = isReplace ? 'Hardware Replaced' : 'Device Configuration';
      document.getElementById('resultBannerSub').textContent = `Loaded from database record.`;
      btnReplaceHardware.classList.remove('hidden');
      
    } catch (err) {}
  }

  async function showFlashHistory(deviceId) {
    historyModalTitle.textContent = `Flash History: ${deviceId}`;
    historyContent.innerHTML = 'Loading...';
    historyModal.classList.remove('hidden');
    try {
      const res = await fetch(`${factoryApiRoot}/device/${encodeURIComponent(deviceId)}/flash-history`, { headers: { 'Authorization': `Bearer ${keyInput.value}` } });
      const data = await res.json();
      historyContent.innerHTML = '';
      if (data.history.length === 0) { historyContent.innerHTML = '<p class="hint">No history found.</p>'; return; }
      
      data.history.forEach(ev => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `
          <div style="display:flex;justify-content:space-between">
            <strong style="color:var(--accent)">${ev.event_type.replace('_', ' ').toUpperCase()}</strong>
            <span style="font-size:11px;color:var(--muted)">${new Date(ev.created_at).toLocaleString()}</span>
          </div>
          <div style="font-size:12px;margin-top:4px">${ev.notes || ''}</div>
        `;
        historyContent.appendChild(div);
      });
    } catch (err) { historyContent.innerHTML = 'Error loading history.'; }
  }

  async function deleteDevice(deviceId) {
    if (!confirm(`Delete ${deviceId}?`)) return;
    await fetch(`${factoryApiRoot}/device/${encodeURIComponent(deviceId)}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${keyInput.value}` } });
    loadDevices();
    if (currentDeviceData?.device_id === deviceId) resultSection.classList.add('hidden');
  }

  function logSerial(message, cls = '') {
    const line = document.createElement('div');
    const ts   = new Date().toLocaleTimeString('en', { hour12: false });
    line.textContent = `[${ts}] ${message}`;
    if (cls) line.classList.add(cls);
    serialLog.appendChild(line);
    if (chkAutoscroll?.checked) serialLog.scrollTop = serialLog.scrollHeight;
  }
});
