document.addEventListener('DOMContentLoaded', () => {
  const btnProvision = document.getElementById('btnProvision');
  const btnRefresh = document.getElementById('btnRefresh');
  const btnDetectLocal = document.getElementById('btnDetectLocal');
  const btnDownloadFirmwareZip = document.getElementById('btnDownloadFirmwareZip');
  const btnScanNewUsb = document.getElementById('btnScanNewUsb');
  const btnCompileAndFlash = document.getElementById('btnCompileAndFlash');
  const btnStartFlash = document.getElementById('btnStartFlash');
  const usbDetailBox = document.getElementById('usbDetailBox');
  const usbStatusText = document.getElementById('usbStatusText');
  const usbReadyBadge = document.getElementById('usbReadyBadge');
  const usbPulse = document.getElementById('usbPulse');
  const firmwareFileInput = document.getElementById('firmwareFileInput');
  const flashProgressContainer = document.getElementById('flashProgressContainer');
  const flashProgressBar = document.getElementById('flashProgressBar');
  const flashProgressText = document.getElementById('flashProgressText');
  const flashLog = document.getElementById('flashLog');
  const keyInput = document.getElementById('factoryKeyInput');
  const relayCountInput = document.getElementById('relayCountInput');
  const resultSection = document.getElementById('resultSection');
  const flashSection = document.getElementById('flashSection');
  const flashDeviceId = document.getElementById('flashDeviceId');
  const fwCaCertificateInput = document.getElementById('fwCaCertificate');
  let currentFlashDeviceId = null;
  let detectedPort = null;
  const factoryApiRoot = '/api/v1/factory';

  // Load initial devices
  loadDevices();

  btnProvision.addEventListener('click', provisionDevice);
  btnRefresh.addEventListener('click', loadDevices);
  btnDetectLocal.addEventListener('click', detectLocalDevices);
  btnDownloadFirmwareZip.addEventListener('click', downloadFirmwareZip);
  btnScanNewUsb.addEventListener('click', async () => {
    // 1. Immediate check for API support
    if (!navigator.serial) {
      alert('ERROR: Your browser is blocking USB access. \n\nReason: You must use HTTPS (https://...) and Google Chrome or Edge.');
      return;
    }

    try {
      // 2. Open the selection window without filters (matches Google test site)
      const port = await navigator.serial.requestPort({ filters: [] });

      if (port) {
        detectedPort = port;
        // Wait 100ms for browser to authorize then update UI
        setTimeout(() => checkEsp32Connection(false), 100);
      }
    } catch (err) {
      if (err.name === 'NotFoundError') {
        alert('No device was selected. Please click the button again and pick your COM port.');
      } else {
        console.error('USB Selection Failed:', err);
      }
    }
  });
  
  btnCompileAndFlash.addEventListener('click', compileAndFlash);
  btnStartFlash.addEventListener('click', () => flashEsp32Firmware());

  async function provisionDevice() {
    btnProvision.disabled = true;
    btnProvision.textContent = 'Generating...';
    resultSection.classList.add('hidden');

    try {
      const response = await fetch(`${factoryApiRoot}/device`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${keyInput.value}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          relay_count: Number(relayCountInput.value || 1)
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to provision');
      }

      const data = await response.json();
      displayResult(data);
      loadDevices(); // Refresh list
    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      btnProvision.disabled = false;
      btnProvision.textContent = 'Generate Device';
    }
  }

  function displayResult(data) {
    const { qr_data, firmware_config } = data;

    const qrContainer = document.getElementById('qrcode');
    qrContainer.innerHTML = ''; // Clear previous
    const qrPayload = JSON.stringify(qr_data);

    new QRCode(qrContainer, {
      text: qrPayload,
      width: 150,
      height: 150,
      colorDark : '#000000',
      colorLight : '#ffffff',
      correctLevel : QRCode.CorrectLevel.H
    });

    document.getElementById('lblDeviceId').textContent = qr_data.device_id;
    document.getElementById('lblDeviceKey').textContent = qr_data.device_key;

    document.getElementById('fwDeviceId').textContent = firmware_config.device_id;
    document.getElementById('fwRelayCount').textContent = firmware_config.relay_count;
    document.getElementById('fwRelayPins').textContent = (firmware_config.relay_pins || []).join(', ');
    document.getElementById('fwNamespace').textContent = firmware_config.namespace;
    document.getElementById('fwPermUser').textContent = firmware_config.permanent_mqtt.username;
    document.getElementById('fwPermPass').textContent = firmware_config.permanent_mqtt.password;
    flashDeviceId.textContent = firmware_config.device_id;
    currentFlashDeviceId = firmware_config.device_id;

    setEsp32Status('Not detected yet', false);
    flashProgressContainer.classList.add('hidden');
    flashProgressBar.style.width = '0%';
    flashProgressText.textContent = 'Select a compiled .bin file and connect ESP32 to flash.';
    fwCaCertificateInput.value = '';

    resultSection.classList.remove('hidden');
    flashSection.classList.remove('hidden');
  }

  async function downloadFirmwareZip() {
    if (!currentFlashDeviceId) return;

    btnDownloadFirmwareZip.disabled = true;
    btnDownloadFirmwareZip.textContent = 'Generating ZIP...';

    try {
      const response = await fetch(`${factoryApiRoot}/device/${encodeURIComponent(currentFlashDeviceId)}/generate-firmware`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${keyInput.value}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          emqx_ca_cert: fwCaCertificateInput.value.trim()
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to download firmware zip');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentFlashDeviceId}_firmware.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      btnDownloadFirmwareZip.disabled = false;
      btnDownloadFirmwareZip.textContent = 'Download Firmware Source (ZIP)';
    }
  }

  async function detectLocalDevices() {
    const rows = document.querySelectorAll('#deviceTableBody tr');
    if (rows.length === 0) return;

    btnDetectLocal.disabled = true;
    btnDetectLocal.textContent = 'Detecting...';

    const scanPromises = Array.from(rows).map(async (row) => {
      const deviceId = row.dataset.deviceId;
      const statusCell = row.querySelector('.status-cell');
      if (!deviceId || !statusCell) return;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        // Try to fetch info from the .local address
        const response = await fetch(`http://${deviceId}.local/info`, { 
          signal: controller.signal,
          mode: 'no-cors' 
        });
        
        statusCell.innerHTML = '<span class="status-badge status-online">Local</span>';
        clearTimeout(timeoutId);
      } catch (err) {
        // Keep original
      }
    });

    await Promise.all(scanPromises);
    btnDetectLocal.disabled = false;
    btnDetectLocal.textContent = 'Detect Online Devices';
  }

  async function checkEsp32Connection(forceRequest = false) {
    if (!('serial' in navigator)) {
      usbStatusText.textContent = 'Web Serial not supported in this browser.';
      usbDetailBox.classList.remove('hidden');
      return;
    }

    try {
      let port;
      if (forceRequest) {
        port = await navigator.serial.requestPort({ filters: [] });
      } else {
        const ports = await navigator.serial.getPorts();
        port = ports.length ? ports[0] : await navigator.serial.requestPort({ filters: [] });
      }

      if (!port.readable || !port.writable) {
        await port.open({ baudRate: 115200 });
      }
      
      detectedPort = port;
      const info = port.getInfo();
      const vid = info.usbVendorId ? `0x${info.usbVendorId.toString(16).toUpperCase()}` : 'Unknown';
      const pid = info.usbProductId ? `0x${info.usbProductId.toString(16).toUpperCase()}` : 'Unknown';
      
      usbStatusText.textContent = `Linked (VID:${vid} PID:${pid})`;
      usbStatusText.style.color = '#34D399';
      usbDetailBox.classList.remove('hidden');
      usbReadyBadge.classList.remove('hidden');
      usbPulse.classList.remove('hidden');
      
      // Enable Flash Button
      btnCompileAndFlash.disabled = false;
      btnCompileAndFlash.classList.remove('disabled');
      
      appendFlashLog(`\n[USB] Hardware Linked Successfully: VID ${vid}, PID ${pid}`);
    } catch (err) {
      console.error('USB Error:', err);
      if (err.name !== 'NotFoundError' && err.name !== 'AbortError') {
        usbStatusText.textContent = `Error: ${err.message}`;
        usbStatusText.style.color = '#F87171';
        usbDetailBox.classList.remove('hidden');
        usbReadyBadge.classList.add('hidden');
        usbPulse.classList.add('hidden');
      }
    }
  }

  function setEsp32Status(msg, isSuccess) {
    usbStatusText.textContent = msg;
    usbStatusText.style.color = isSuccess ? '#34D399' : '#F87171';
    usbDetailBox.classList.remove('hidden');
  }

  async function compileAndFlash() {
    if (!currentFlashDeviceId) {
      alert('Please select or generate a device first.');
      return;
    }

    if (!detectedPort) {
      const confirmed = confirm('ESP32 not detected. Connect and detect it now?');
      if (confirmed) await checkEsp32Connection();
      if (!detectedPort) return;
    }

    btnCompileAndFlash.disabled = true;
    btnCompileAndFlash.textContent = 'Compiling on Server... (1-2 mins)';
    flashProgressContainer.classList.remove('hidden');
    flashProgressText.textContent = 'Server is compiling your custom firmware. This takes about 60-90 seconds...';
    flashProgressBar.style.width = '10%';

    try {
      const response = await fetch(`${factoryApiRoot}/device/${encodeURIComponent(currentFlashDeviceId)}/compile`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${keyInput.value}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          emqx_ca_cert: fwCaCertificateInput.value.trim()
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Server-side compilation failed');
      }

      flashProgressBar.style.width = '30%';
      flashProgressText.textContent = 'Compilation successful! Downloading .bin...';
      const blob = await response.blob();
      const binData = new Uint8Array(await blob.arrayBuffer());

      flashProgressText.textContent = 'Starting flash process...';
      await flashEsp32Firmware(binData);

    } catch (error) {
      alert(`Auto-Compile Error: ${error.message}`);
      flashProgressText.textContent = `Error: ${error.message}`;
      flashProgressBar.style.width = '0%';
    } finally {
      btnCompileAndFlash.disabled = false;
      btnCompileAndFlash.textContent = 'Auto-Compile & Flash';
    }
  }

  async function flashEsp32Firmware(preloadedBin = null) {
    if (!('serial' in navigator)) {
      alert('Web Serial is not available in this browser.');
      return;
    }

    if (!window.ESPLoader || !window.Transport) {
      alert('ESP flashing library is not available.');
      return;
    }

    let firmwareData = preloadedBin;
    if (!firmwareData) {
      const firmwareFile = firmwareFileInput.files[0];
      if (!firmwareFile) {
        alert('Please select a compiled ESP32 firmware .bin file first.');
        return;
      }
      const fileBuffer = await firmwareFile.arrayBuffer();
      firmwareData = new Uint8Array(fileBuffer);
    }

    flashProgressContainer.classList.remove('hidden');
    flashProgressText.textContent = 'Preparing to flash...';
    flashLog.textContent = '';
    flashLog.classList.remove('hidden');
    setEsp32Status('Preparing flash operation...', false);

    let port = detectedPort;
    try {
      if (!port) {
        port = await navigator.serial.requestPort({ filters: [] });
      }
      if (!port.readable || !port.writable) {
        await port.open({ baudRate: 115200 });
      }

      const transport = new Transport(port, true);
      const terminal = {
        clean() {
          flashLog.textContent = '';
        },
        writeLine(data) {
          appendFlashLog(data);
        },
        write(data) {
          appendFlashLog(data);
        }
      };

      const esploader = new ESPLoader({
        transport,
        baudrate: 115200,
        terminal,
        debugLogging: false
      });

      appendFlashLog('Connecting to ESP32 bootloader...');
      flashProgressText.textContent = 'Connecting to ESP32 bootloader...';
      const chipName = await esploader.main();
      appendFlashLog(`Connected to ${chipName}`);
      setEsp32Status(`Connected to ${chipName}`, true);

      appendFlashLog('Starting flash sequence...');
      flashProgressText.textContent = 'Flashing firmware...';

      await esploader.writeFlash({
        fileArray: [{ data: firmwareData, address: 0x1000 }],
        flashMode: 'dio',
        flashFreq: '40m',
        flashSize: '4MB',
        eraseAll: false,
        compress: true,
        reportProgress: (fileIndex, written, total) => {
          const percent = total ? (written / total) * 100 : 0;
          flashProgressBar.style.width = `${percent.toFixed(1)}%`;
          flashProgressText.textContent = `Flashing firmware: ${percent.toFixed(1)}%`;
        }
      });

      appendFlashLog('Firmware flash complete. Resetting device...');
      flashProgressText.textContent = 'Firmware flash completed successfully.';
      flashProgressBar.style.width = '100%';
      await esploader.after('hard_reset');
      setEsp32Status('Firmware flashed successfully!', true);
    } catch (error) {
      console.error(error);
      const message = error?.message || String(error);
      flashProgressText.textContent = `Flash failed: ${message}`;
      flashProgressBar.style.width = '0%';
      appendFlashLog(`Error: ${message}`);
      setEsp32Status(`Flash failed: ${message}`, false);
    } finally {
      if (port) {
        try {
          await port.close();
        } catch (_err) {}
      }
      detectedPort = null;
    }
  }

  function appendFlashLog(message) {
    flashLog.textContent += `${message}\n`;
    flashLog.scrollTop = flashLog.scrollHeight;
  }

  async function loadDevices() {
    try {
      const response = await fetch(`${factoryApiRoot}/devices`, {
        headers: {
          'Authorization': `Bearer ${keyInput.value}`
        }
      });

      if (!response.ok) return;

      const data = await response.json();
      const tbody = document.getElementById('deviceTableBody');
      tbody.innerHTML = '';

      data.devices.forEach(device => {
        const tr = document.createElement('tr');
        const date = new Date(device.created_at).toLocaleString();
        const statusClass = device.is_online ? 'status-online' : 'status-offline';
        const statusText = device.is_online ? 'Online' : 'Offline';
        const owner = device.owner_email || '<span style="color:#8EA0B3">Unpaired</span>';

        tr.dataset.deviceId = device.device_id;
        tr.innerHTML = `
          <td><strong>${device.device_id}</strong></td>
          <td style="font-family:monospace; color:#8EA0B3">${device.namespace}</td>
          <td>${device.relay_count || 1}</td>
          <td>${date}</td>
          <td class="status-cell"><span class="status-badge ${statusClass}">${statusText}</span></td>
          <td>${owner}</td>
          <td></td>
        `;

        const actionCell = tr.querySelector('td:last-child');
        const flashButton = document.createElement('button');
        flashButton.className = 'btn secondary small';
        flashButton.textContent = 'Flash';
        flashButton.addEventListener('click', () => openFlashPanel(device));
        actionCell.appendChild(flashButton);

        const deleteButton = document.createElement('button');
        deleteButton.className = 'btn small';
        deleteButton.style.backgroundColor = 'transparent';
        deleteButton.style.color = '#F87171';
        deleteButton.style.border = '1px solid #F87171';
        deleteButton.style.marginLeft = '8px';
        deleteButton.textContent = 'Delete';
        deleteButton.addEventListener('click', () => deleteDevice(device.device_id));
        actionCell.appendChild(deleteButton);

        tbody.appendChild(tr);
      });

    } catch (error) {
      console.error('Failed to load devices:', error);
    }
  }

  function openFlashPanel(device) {
    currentFlashDeviceId = device.device_id;
    flashDeviceId.textContent = device.device_id;
    document.getElementById('lblDeviceId').textContent = device.device_id;
    document.getElementById('lblDeviceKey').textContent = 'Already provisioned';
    document.getElementById('fwDeviceId').textContent = device.device_id;
    document.getElementById('fwRelayCount').textContent = device.relay_count || 1;
    document.getElementById('fwRelayPins').textContent = 'Auto-generated';
    document.getElementById('fwNamespace').textContent = device.namespace;
    document.getElementById('fwPermUser').textContent = 'Hidden';
    document.getElementById('fwPermPass').textContent = 'Hidden';

    setEsp32Status('Not checked yet', false);
    fwCaCertificateInput.value = '';

    resultSection.classList.remove('hidden');
    flashSection.classList.remove('hidden');
  }

  async function deleteDevice(deviceId) {
    if (!confirm(`Are you sure you want to delete device ${deviceId}? This cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`${factoryApiRoot}/device/${encodeURIComponent(deviceId)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${keyInput.value}`
        }
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to delete device');
      }

      // Hide flash panel if we deleted the currently selected device
      if (currentFlashDeviceId === deviceId) {
        resultSection.classList.add('hidden');
        flashSection.classList.add('hidden');
      }

      loadDevices(); // Refresh list
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  }
});
