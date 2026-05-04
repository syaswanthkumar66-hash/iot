document.addEventListener('DOMContentLoaded', () => {

  // ─── Element References ──────────────────────────────────────────────────
  const btnProvision          = document.getElementById('btnProvision');
  const btnRefresh            = document.getElementById('btnRefresh');
  const btnDownloadFirmwareZip= document.getElementById('btnDownloadFirmwareZip');
  const btnScanNewUsb         = document.getElementById('btnScanNewUsb');
  const btnCompileAndFlash    = document.getElementById('btnCompileAndFlash');
  const btnStartFlash         = document.getElementById('btnStartFlash');
  const btnGlobalConnectUsb   = document.getElementById('btnGlobalConnectUsb');
  const globalUsbStatus       = document.getElementById('globalUsbStatus');
  const usbDeviceList         = document.getElementById('usbDeviceList');
  const usbDetailBox          = document.getElementById('usbDetailBox');
  const usbStatusText         = document.getElementById('usbStatusText');
  const usbReadyBadge         = document.getElementById('usbReadyBadge');
  const usbPulse              = document.getElementById('usbPulse');
  const baudRateSelect        = document.getElementById('baudRate');
  const firmwareFileInput     = document.getElementById('firmwareFileInput');
  const flashProgressContainer= document.getElementById('flashProgressContainer');
  const flashProgressBar      = document.getElementById('flashProgressBar');
  const flashProgressText     = document.getElementById('flashProgressText');
  const flashLog              = document.getElementById('flashLog');
  const keyInput              = document.getElementById('factoryKeyInput');
  const relayCountInput       = document.getElementById('relayCountInput');
  const resultSection         = document.getElementById('resultSection');
  const flashSection          = document.getElementById('flashSection');
  const flashDeviceId         = document.getElementById('flashDeviceId');
  const fwCaCertificateInput  = document.getElementById('fwCaCertificate');

  let currentFlashDeviceId = null;
  let detectedPort         = null;
  const factoryApiRoot     = '/api/v1/factory';

  // ─── Startup ─────────────────────────────────────────────────────────────
  loadDevices();

  // ─── Button Listeners ────────────────────────────────────────────────────
  btnProvision.addEventListener('click', provisionDevice);
  btnRefresh.addEventListener('click', loadDevices);
  btnDownloadFirmwareZip.addEventListener('click', downloadFirmwareZip);
  btnCompileAndFlash.addEventListener('click', compileAndFlash);
  btnStartFlash.addEventListener('click', () => flashEsp32Firmware());
  btnGlobalConnectUsb.addEventListener('click', handleUsbConnect);
  btnScanNewUsb.addEventListener('click', handleUsbConnect);

  // ─── Web Serial: Check browser support ───────────────────────────────────
  if (!('serial' in navigator)) {
    globalUsbStatus.textContent = 'NOT SUPPORTED';
    globalUsbStatus.className   = 'status-badge status-offline';
    btnGlobalConnectUsb.disabled = true;
    btnGlobalConnectUsb.title    = 'Use Chrome or Edge over HTTPS';
    btnScanNewUsb.disabled       = true;
    console.warn('Web Serial API not supported. Use Chrome/Edge over HTTPS.');
  } else {
    // Auto-link previously authorised ports on page load (no prompt needed)
    autoLinkDevices();

    // React to plug / unplug events
    navigator.serial.addEventListener('connect', (e) => {
      console.log('[USB] Device plugged in:', e.target);
      autoLinkDevices();
    });

    navigator.serial.addEventListener('disconnect', (e) => {
      console.log('[USB] Device unplugged:', e.target);
      if (detectedPort === e.target) {
        detectedPort = null;
      }
      autoLinkDevices(); // refresh list — may now be empty
    });
  }

  // ─── autoLinkDevices ─────────────────────────────────────────────────────
  // Reads already-authorised ports (no browser prompt). Updates the global
  // status badge and the USB device list panel.
  async function autoLinkDevices() {
    if (!('serial' in navigator)) return;
    try {
      const ports = await navigator.serial.getPorts();
      renderUsbDeviceList(ports);

      if (ports.length > 0) {
        // Use the first port as the active one for flashing
        detectedPort = ports[0];
        await updateUsbStatusUI(detectedPort, true);
      } else {
        detectedPort = null;
        setGlobalUsbDisconnected();
      }
    } catch (err) {
      console.error('[USB] Auto-link failed:', err);
    }
  }

  // ─── Render the list of known USB devices in the sidebar card ────────────
  function renderUsbDeviceList(ports) {
    if (!usbDeviceList) return;
    if (ports.length === 0) {
      usbDeviceList.innerHTML = '<em>No authorised devices</em>';
      return;
    }
    usbDeviceList.innerHTML = ports.map((p, i) => {
      const info = p.getInfo();
      const vid  = info.usbVendorId  ? `VID:0x${info.usbVendorId.toString(16).toUpperCase()}`  : 'VID:—';
      const pid  = info.usbProductId ? `PID:0x${info.usbProductId.toString(16).toUpperCase()}` : 'PID:—';
      const active = (detectedPort === p) ? ' ✔ active' : '';
      return `<div style="padding:2px 0">📟 Port ${i + 1}: ${vid} ${pid}${active}</div>`;
    }).join('');
  }

  // ─── handleUsbConnect (called on button click — user gesture required) ───
  async function handleUsbConnect() {
    if (!('serial' in navigator)) {
      alert('Web Serial is not supported.\nUse Google Chrome or Edge and open the page over HTTPS.');
      return;
    }

    try {
      // requestPort() MUST be called inside a click handler
      const port = await navigator.serial.requestPort();
      detectedPort = port;

      const baudRate = parseInt(baudRateSelect?.value || '115200', 10);

      // Open the port only if it is not already open
      if (!port.readable) {
        await port.open({ baudRate });
      }

      await updateUsbStatusUI(port, true);
      // Refresh the device list to include the newly authorised port
      autoLinkDevices();

    } catch (err) {
      // NotFoundError = user clicked Cancel — not an error we care about
      if (err.name !== 'NotFoundError') {
        console.error('[USB] Connect error:', err);
        alert(`USB connection failed: ${err.message}`);
      }
    }
  }

  // ─── updateUsbStatusUI ───────────────────────────────────────────────────
  async function updateUsbStatusUI(port, connected) {
    if (!connected || !port) {
      setGlobalUsbDisconnected();
      return;
    }

    const info = port.getInfo();
    const vid  = info.usbVendorId  ? `0x${info.usbVendorId.toString(16).toUpperCase()}`  : 'Unknown';
    const pid  = info.usbProductId ? `0x${info.usbProductId.toString(16).toUpperCase()}` : 'Unknown';
    const label = `VID:${vid}  PID:${pid}`;

    // Global header badge
    globalUsbStatus.textContent = 'CONNECTED';
    globalUsbStatus.className   = 'status-badge status-online';
    btnGlobalConnectUsb.textContent = 'Change USB';

    // Inline USB detail box (inside result section)
    if (usbStatusText) {
      usbStatusText.textContent  = `Linked (${label})`;
      usbStatusText.style.color  = '#34D399';
    }
    if (usbDetailBox)  usbDetailBox.classList.remove('hidden');
    if (usbReadyBadge) usbReadyBadge.classList.remove('hidden');
    if (usbPulse)      usbPulse.classList.remove('hidden');

    // Enable flash button
    btnCompileAndFlash.disabled = false;
    btnCompileAndFlash.classList.remove('disabled');

    appendFlashLog(`[USB] Linked — ${label}`);
  }

  function setGlobalUsbDisconnected() {
    globalUsbStatus.textContent = 'DISCONNECTED';
    globalUsbStatus.className   = 'status-badge status-offline';
    btnGlobalConnectUsb.textContent = 'Connect USB';

    if (usbDetailBox)  usbDetailBox.classList.add('hidden');
    if (usbReadyBadge) usbReadyBadge.classList.add('hidden');
    if (usbPulse)      usbPulse.classList.add('hidden');

    btnCompileAndFlash.disabled = true;
    btnCompileAndFlash.classList.add('disabled');

    if (usbDeviceList) usbDeviceList.innerHTML = '<em>No authorised devices</em>';
  }

  // ─── Provision Device ────────────────────────────────────────────────────
  async function provisionDevice() {
    btnProvision.disabled    = true;
    btnProvision.textContent = 'Generating...';
    resultSection.classList.add('hidden');

    try {
      const response = await fetch(`${factoryApiRoot}/device`, {
        method : 'POST',
        headers: {
          'Authorization' : `Bearer ${keyInput.value}`,
          'Content-Type'  : 'application/json'
        },
        body: JSON.stringify({ relay_count: Number(relayCountInput.value || 1) })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to provision');
      }

      const data = await response.json();
      displayResult(data);
      loadDevices();
    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      btnProvision.disabled    = false;
      btnProvision.textContent = 'Generate Device';
    }
  }

  // ─── Display Result ──────────────────────────────────────────────────────
  function displayResult(data) {
    const { qr_data, firmware_config } = data;

    const qrContainer = document.getElementById('qrcode');
    qrContainer.innerHTML = '';
    new QRCode(qrContainer, {
      text        : JSON.stringify(qr_data),
      width       : 150,
      height      : 150,
      colorDark   : '#000000',
      colorLight  : '#ffffff',
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

    flashDeviceId.textContent = firmware_config.device_id;
    currentFlashDeviceId      = firmware_config.device_id;

    setEsp32Status('Not detected yet', false);
    flashProgressContainer.classList.add('hidden');
    flashProgressBar.style.width = '0%';
    flashProgressText.textContent = 'Connect ESP32 and click Auto-Compile & Flash.';
    if (fwCaCertificateInput) fwCaCertificateInput.value = '';

    resultSection.classList.remove('hidden');
    if (flashSection) flashSection.classList.remove('hidden');
  }

  // ─── Download Firmware ZIP ───────────────────────────────────────────────
  async function downloadFirmwareZip() {
    if (!currentFlashDeviceId) {
      alert('No device selected. Provision or select a device first.');
      return;
    }

    btnDownloadFirmwareZip.disabled    = true;
    btnDownloadFirmwareZip.textContent = 'Generating ZIP...';

    try {
      const response = await fetch(
        `${factoryApiRoot}/device/${encodeURIComponent(currentFlashDeviceId)}/generate-firmware`,
        {
          method : 'POST',
          headers: {
            'Authorization': `Bearer ${keyInput.value}`,
            'Content-Type' : 'application/json'
          },
          body: JSON.stringify({ emqx_ca_cert: fwCaCertificateInput?.value.trim() || '' })
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to generate firmware ZIP');
      }

      const blob = await response.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${currentFlashDeviceId}_firmware.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      btnDownloadFirmwareZip.disabled    = false;
      btnDownloadFirmwareZip.textContent = 'Download Firmware Source (ZIP)';
    }
  }

  // ─── setEsp32Status (inline box helper) ─────────────────────────────────
  function setEsp32Status(msg, isSuccess) {
    if (!usbStatusText) return;
    usbStatusText.textContent = msg;
    usbStatusText.style.color = isSuccess ? '#34D399' : '#F87171';
    if (usbDetailBox) usbDetailBox.classList.remove('hidden');
  }

  // ─── Compile & Flash ─────────────────────────────────────────────────────
  async function compileAndFlash() {
    if (!currentFlashDeviceId) {
      alert('Please select or generate a device first.');
      return;
    }

    if (!detectedPort) {
      alert('No ESP32 connected. Click "Select ESP32 COM Port" first.');
      return;
    }

    btnCompileAndFlash.disabled    = true;
    btnCompileAndFlash.textContent = 'Compiling on Server… (1-2 mins)';
    flashProgressContainer.classList.remove('hidden');
    flashProgressText.textContent = 'Server is compiling your custom firmware…';
    flashProgressBar.style.width  = '10%';

    try {
      const response = await fetch(
        `${factoryApiRoot}/device/${encodeURIComponent(currentFlashDeviceId)}/compile`,
        {
          method : 'POST',
          headers: {
            'Authorization': `Bearer ${keyInput.value}`,
            'Content-Type' : 'application/json'
          },
          body: JSON.stringify({ emqx_ca_cert: fwCaCertificateInput?.value.trim() || '' })
        }
      );

      if (!response.ok) {
        const err = await response.json();
        const detail = err.details ? `\n\nDetails:\n${err.details}` : '';
        throw new Error((err.error || 'Server-side compilation failed') + detail);
      }

      flashProgressBar.style.width  = '30%';
      flashProgressText.textContent = 'Compilation successful! Downloading .bin…';

      const blob    = await response.blob();
      const binData = new Uint8Array(await blob.arrayBuffer());

      flashProgressText.textContent = 'Starting flash process…';
      await flashEsp32Firmware(binData);

    } catch (error) {
      alert(`Compile error: ${error.message}`);
      flashProgressText.textContent = `Error: ${error.message}`;
      flashProgressBar.style.width  = '0%';
    } finally {
      btnCompileAndFlash.disabled    = false;
      btnCompileAndFlash.textContent = 'Auto-Compile & Flash';
    }
  }

  // ─── Flash ESP32 Firmware ────────────────────────────────────────────────
  async function flashEsp32Firmware(preloadedBin = null) {
    if (!('serial' in navigator)) {
      alert('Web Serial is not available. Use Chrome or Edge over HTTPS.');
      return;
    }

    if (!window.ESPLoader || !window.Transport) {
      alert('ESP flashing library failed to load. Check your internet connection and reload.');
      return;
    }

    let firmwareData = preloadedBin;
    if (!firmwareData) {
      const file = firmwareFileInput.files[0];
      if (!file) { alert('Select a .bin firmware file first.'); return; }
      firmwareData = new Uint8Array(await file.arrayBuffer());
    }

    flashProgressContainer.classList.remove('hidden');
    flashProgressText.textContent = 'Preparing to flash…';
    flashLog.textContent = '';
    flashLog.classList.remove('hidden');
    setEsp32Status('Preparing flash operation…', false);

    let port = detectedPort;
    const baudRate = parseInt(baudRateSelect?.value || '115200', 10);

    try {
      if (!port) {
        port = await navigator.serial.requestPort();
      }
      if (!port.readable) {
        await port.open({ baudRate });
      }

      const transport = new Transport(port, true);
      const terminal = {
        clean()          { flashLog.textContent = ''; },
        writeLine(data)  { appendFlashLog(data); },
        write(data)      { appendFlashLog(data); }
      };

      const esploader = new ESPLoader({ transport, baudrate: 115200, terminal, debugLogging: false });

      appendFlashLog('Connecting to ESP32 bootloader…');
      flashProgressText.textContent = 'Connecting to ESP32 bootloader…';

      const chipName = await esploader.main();
      appendFlashLog(`Connected to: ${chipName}`);
      if (usbStatusText) usbStatusText.textContent = `${chipName} — Ready`;
      if (usbReadyBadge) usbReadyBadge.classList.remove('hidden');

      appendFlashLog('Flashing firmware…');
      flashProgressText.textContent = 'Flashing firmware…';

      await esploader.writeFlash({
        fileArray    : [{ data: firmwareData, address: 0x1000 }],
        flashMode    : 'dio',
        flashFreq    : '40m',
        flashSize    : '4MB',
        eraseAll     : false,
        compress     : true,
        reportProgress: (fileIndex, written, total) => {
          const pct = total ? (written / total) * 100 : 0;
          flashProgressBar.style.width  = `${pct.toFixed(1)}%`;
          flashProgressText.textContent = `Flashing: ${pct.toFixed(1)}%`;
        }
      });

      appendFlashLog('\n[SUCCESS] Firmware flash complete!');
      flashProgressText.textContent = 'Flash completed successfully ✓';
      flashProgressBar.style.width  = '100%';

      await esploader.after('hard_reset');

    } catch (error) {
      const message = error?.message || String(error);
      flashProgressText.textContent = `Flash failed: ${message}`;
      flashProgressBar.style.width  = '0%';
      appendFlashLog(`\n[ERROR] ${message}`);
      console.error('[Flash]', error);
    } finally {
      if (port) {
        try {
          await port.setSignals({ dataTerminalReady: false, requestToSend: false });
          await port.close();
        } catch (_) {}
      }
      // Refresh the authorised port list after flash
      setTimeout(autoLinkDevices, 500);
    }
  }

  function appendFlashLog(message) {
    if (!flashLog) return;
    flashLog.textContent += `${message}\n`;
    flashLog.scrollTop = flashLog.scrollHeight;
  }

  // ─── Load Devices List ───────────────────────────────────────────────────
  async function loadDevices() {
    try {
      const response = await fetch(`${factoryApiRoot}/devices`, {
        headers: { 'Authorization': `Bearer ${keyInput.value}` }
      });

      if (response.status === 401) {
        console.warn('Factory API: Unauthorized — check your API key.');
        return;
      }
      if (!response.ok) return;

      const data  = await response.json();
      const tbody = document.getElementById('deviceTableBody');
      const count = document.getElementById('countConnected');
      tbody.innerHTML = '';
      if (count) count.textContent = data.devices.length;

      data.devices.forEach(device => {
        const tr          = document.createElement('tr');
        const date        = new Date(device.created_at).toLocaleString();
        const statusClass = device.is_online ? 'status-online' : 'status-offline';
        const statusText  = device.is_online ? 'Online'        : 'Offline';
        const owner       = device.owner_email || '<span style="color:#8EA0B3">Unpaired</span>';

        tr.dataset.deviceId = device.device_id;
        tr.innerHTML = `
          <td><strong>${device.device_id}</strong></td>
          <td style="font-family:monospace;color:#8EA0B3">${device.namespace}</td>
          <td>${device.relay_count || 1}</td>
          <td>${date}</td>
          <td class="status-cell"><span class="status-badge ${statusClass}">${statusText}</span></td>
          <td>${owner}</td>
          <td></td>
        `;

        const actionCell = tr.querySelector('td:last-child');

        const flashBtn = document.createElement('button');
        flashBtn.className   = 'btn secondary small';
        flashBtn.textContent = 'Flash';
        flashBtn.addEventListener('click', () => openFlashPanel(device));
        actionCell.appendChild(flashBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'btn small';
        Object.assign(delBtn.style, { backgroundColor:'transparent', color:'#F87171', border:'1px solid #F87171', marginLeft:'8px' });
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', () => deleteDevice(device.device_id));
        actionCell.appendChild(delBtn);

        tbody.appendChild(tr);
      });

    } catch (error) {
      console.error('Failed to load devices:', error);
    }
  }

  // ─── Open Flash Panel (from device list row) ─────────────────────────────
  function openFlashPanel(device) {
    currentFlashDeviceId = device.device_id;
    flashDeviceId.textContent = device.device_id;

    document.getElementById('lblDeviceId').textContent  = device.device_id;
    document.getElementById('lblDeviceKey').textContent = 'Already provisioned';
    document.getElementById('fwDeviceId').textContent   = device.device_id;
    document.getElementById('fwRelayCount').textContent = device.relay_count || 1;
    document.getElementById('fwRelayPins').textContent  = 'Auto-generated';
    document.getElementById('fwNamespace').textContent  = device.namespace;
    document.getElementById('fwPermUser').textContent   = 'Hidden';
    document.getElementById('fwPermPass').textContent   = 'Hidden';

    setEsp32Status('Not checked yet', false);
    if (fwCaCertificateInput) fwCaCertificateInput.value = '';

    resultSection.classList.remove('hidden');
    if (flashSection) flashSection.classList.remove('hidden');

    resultSection.scrollIntoView({ behavior: 'smooth' });
  }

  // ─── Delete Device ────────────────────────────────────────────────────────
  async function deleteDevice(deviceId) {
    if (!confirm(`Delete device ${deviceId}? This cannot be undone.`)) return;

    try {
      const response = await fetch(
        `${factoryApiRoot}/device/${encodeURIComponent(deviceId)}`,
        { method: 'DELETE', headers: { 'Authorization': `Bearer ${keyInput.value}` } }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to delete device');
      }

      if (currentFlashDeviceId === deviceId) {
        resultSection.classList.add('hidden');
        if (flashSection) flashSection.classList.add('hidden');
      }

      loadDevices();
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  }

});
