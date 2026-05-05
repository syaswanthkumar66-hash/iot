document.addEventListener('DOMContentLoaded', () => {
  const authPanel = document.getElementById('authPanel');
  const userDash  = document.getElementById('userDash');
  const loginForm = document.getElementById('loginForm');
  const regForm   = document.getElementById('registerForm');
  const deviceList = document.getElementById('deviceList');
  
  const apiRoot = '/api/v1';
  const SERVICE_UUID        = "12345678-1234-1234-1234-123456789abc";
  const CHARACTERISTIC_UUID = "abcdefab-1234-1234-1234-abcdefabcdef";

  let token = localStorage.getItem('iotyk_token');
  let bleChar = null;
  let html5QrCode = null;

  if (token) showDashboard();

  // --- Auth & Navigation ---
  document.getElementById('btnShowRegister').onclick = () => {
    loginForm.classList.add('hidden'); regForm.classList.remove('hidden');
  };
  document.getElementById('btnShowLogin').onclick = () => {
    regForm.classList.add('hidden'); loginForm.classList.remove('hidden');
  };

  document.getElementById('btnLogin').onclick = async () => {
    const res = await fetch(`${apiRoot}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: loginEmail.value, password: loginPass.value })
    });
    const data = await res.json();
    if (res.ok) { token = data.token; localStorage.setItem('iotyk_token', token); showDashboard(); }
  };

  // ─── DUAL DISCOVERY (QR + BLE SIMULTANEOUS) ───────────────────────────────
  
  document.getElementById('btnStartSetup').onclick = async () => {
    const readerDiv = document.getElementById('qrReader');
    readerDiv.classList.remove('hidden');
    document.getElementById('btnStartSetup').textContent = '🔎 SCANNING...';

    // 1. Start QR Camera
    html5QrCode = new Html5Qrcode("qrReader");
    const qrPromise = html5QrCode.start(
      { facingMode: "environment" }, 
      { fps: 10, qrbox: 250 },
      (decodedText) => onDeviceIdentified(decodedText, 'QR')
    );

    // 2. Start BLE Scan
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }]
      });
      onDeviceIdentified(device.name, 'BLE', device);
    } catch (err) { console.log("BLE Scan cancelled or failed"); }
  };

  let discoveryFinished = false;
  async function onDeviceIdentified(data, source, bleDevice = null) {
    if (discoveryFinished) return;
    discoveryFinished = true;
    
    console.log(`[Discovery] Winner: ${source} Data: ${data}`);
    
    // Stop QR
    if (html5QrCode) await html5QrCode.stop().catch(() => {});
    document.getElementById('qrReader').classList.add('hidden');
    document.getElementById('manualPairing').classList.remove('hidden');
    
    // Handle QR Data (ID|KEY) vs BLE Data (ID)
    const parts = data.split('|');
    const deviceId = parts[0];
    const deviceKey = parts[1] || '';

    document.getElementById('pairDeviceId').value = deviceId;
    if (deviceKey) document.getElementById('pairDeviceKey').value = deviceKey;

    if (bleDevice) {
      const server = await bleDevice.gatt.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      bleChar = await service.getCharacteristic(CHARACTERISTIC_UUID);
    }
    
    alert(`Device Found via ${source}: ${deviceId}. Complete WiFi to finish.`);
  }

  // ─── DEVICE PAIRING ───────────────────────────────────────────────────────

  document.getElementById('btnPair').onclick = async () => {
    const deviceId = pairDeviceId.value;
    const deviceKey = pairDeviceKey.value;
    const ssid = prompt("WiFi SSID:");
    const pass = prompt("WiFi Password:");

    try {
      const tRes = await fetch(`${apiRoot}/factory/device/${deviceId}/provision-tokens`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${token}` }
      });
      const tData = await tRes.json();

      if (bleChar) {
        const packet = `${ssid}|${pass}|${tData.mqtt_user}|${tData.mqtt_pass}|${tData.session_token}|${deviceKey}`;
        await bleChar.writeValue(new TextEncoder().encode(packet));
      }

      await fetch(`${apiRoot}/user/devices/pair`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, deviceKey })
      });

      alert("Setup Complete!");
      location.reload();
    } catch (err) { alert(err.message); }
  };

  // ─── DASHBOARD & RELAY CONTROLS ──────────────────────────────────────────

  function showDashboard() {
    authPanel.classList.add('hidden');
    userDash.classList.remove('hidden');
    loadUserDevices();
  }

  async function loadUserDevices() {
    const res = await fetch(`${apiRoot}/user/devices`, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    deviceList.innerHTML = '';

    data.devices.forEach(d => {
      const card = document.createElement('div');
      card.className = 'card';
      card.style.padding = '20px';
      
      let togglesHtml = '';
      const relayCount = d.relay_count || 1;
      
      for (let i = 0; i < relayCount; i++) {
        togglesHtml += `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:15px; padding:10px; background:#00000020; border-radius:10px;">
            <span>Switch ${i+1}</span>
            <button onclick="toggleRelay('${d.device_id}', ${i}, true)" class="btn btn-primary" style="width:auto; padding:5px 15px; margin:0; font-size:12px;">ON</button>
            <button onclick="toggleRelay('${d.device_id}', ${i}, false)" class="btn btn-secondary" style="width:auto; padding:5px 15px; margin:0; font-size:12px;">OFF</button>
          </div>
        `;
      }

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div><strong>${d.name || d.device_id}</strong><br><small>${d.device_id}</small></div>
          <span class="status-badge ${d.is_online ? 'status-online' : 'status-offline'}">${d.is_online ? 'ONLINE' : 'OFFLINE'}</span>
        </div>
        ${togglesHtml}
        <button onclick="openLocalControl('${d.device_id}')" class="btn btn-secondary" style="margin-top:15px; font-size:11px;">Direct Local Link (mDNS)</button>
      `;
      deviceList.appendChild(card);
    });
  }

  window.toggleRelay = async (deviceId, index, state) => {
    try {
      const action = state ? 'RELAY_ON' : 'RELAY_OFF';
      // In production, this sends to /api/v1/mqtt/command which bridges to the ESP32
      const res = await fetch(`${apiRoot}/mqtt/command`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, action, relayIndex: index })
      });
      if (!res.ok) throw new Error("Failed to send command");
      console.log(`[Relay] Device ${deviceId} Relay ${index} -> ${state}`);
    } catch (err) { alert(err.message); }
  };

  // --- LOCAL mDNS (Same as before) ---
  window.openLocalControl = (deviceId) => {
    const mdnsAddress = `${deviceId}.local`;
    document.getElementById('localControlModal').classList.remove('hidden');
    // ... WSS Connection logic ...
  };
});
