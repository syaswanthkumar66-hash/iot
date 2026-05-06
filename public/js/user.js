document.addEventListener('DOMContentLoaded', () => {
  const authPanel = document.getElementById('authPanel');
  const userDash  = document.getElementById('userDash');
  const loginForm = document.getElementById('loginForm');
  const regForm   = document.getElementById('registerForm');
  
  const apiRoot = '/api/v1';
  let token = localStorage.getItem('iotyk_token');

  // --- Boot Check ---
  if (token) showDashboard();

  // --- Auth Switchers ---
  document.getElementById('btnShowRegister').onclick = () => {
    loginForm.classList.add('hidden');
    regForm.classList.remove('hidden');
    document.getElementById('authTitle').textContent = 'Join IoTYK';
  };
  document.getElementById('btnShowLogin').onclick = () => {
    regForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    document.getElementById('authTitle').textContent = 'Welcome Home';
  };

  // --- Registration ---
  document.getElementById('btnRegister').onclick = async () => {
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPass').value;
    const name = document.getElementById('regName').value;

    try {
      const res = await fetch(`${apiRoot}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      alert("Registration successful! Please login.");
      document.getElementById('btnShowLogin').onclick();
    } catch (err) { alert(err.message); }
  };

  // --- Login ---
  document.getElementById('btnLogin').onclick = async () => {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPass').value;

    try {
      const res = await fetch(`${apiRoot}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      token = data.token;
      localStorage.setItem('iotyk_token', token);
      showDashboard();
    } catch (err) { alert(err.message); }
  };

  // --- Device Pairing ---
  document.getElementById('btnPair').onclick = async () => {
    const deviceId = document.getElementById('pairDeviceId').value;
    const deviceKey = document.getElementById('pairDeviceKey').value;

    try {
      const res = await fetch(`${apiRoot}/user/devices/pair`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ deviceId, deviceKey })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      alert("Device Paired! Enjoy your smart home.");
      loadUserDevices();
    } catch (err) { alert(err.message); }
  };

  // --- Navigation & Loading ---
  function showDashboard() {
    authPanel.classList.add('hidden');
    userDash.classList.remove('hidden');
    loadUserDevices();
  }

  async function loadUserDevices() {
    try {
      const res = await fetch(`${apiRoot}/user/devices`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      
      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem('iotyk_token');
          location.reload();
          return;
        }
        throw new Error(data.error || 'Failed to load devices');
      }

      const list = document.getElementById('deviceList');
      list.innerHTML = '';

      if (!data.devices || data.devices.length === 0) {
        list.innerHTML = '<p class="hint">No devices yet. Pair one above!</p>';
        return;
      }

      data.devices.forEach(d => {
        const item = document.createElement('div');
        item.className = 'device-item';
        item.innerHTML = `
          <div>
            <div class="device-name">${d.name || d.device_id}</div>
            <div style="font-size:12px; color:var(--muted)">ID: ${d.device_id}</div>
          </div>
          <div style="display:flex; gap:10px; align-items:center;">
            <button onclick="openLocalControl('${d.device_id}')" class="btn btn-secondary" style="width:auto; margin:0; padding:5px 10px; font-size:11px;">LOCAL</button>
            <span class="status-badge ${d.is_online ? 'status-online' : 'status-offline'}">
              ${d.is_online ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
        `;
        list.appendChild(item);
      });
    } catch (err) { console.error(err); }
  }

  // --- LOCAL WSS CONTROL ---
  let localWs = null;
  let activeLocalToken = '';

  window.openLocalControl = (deviceId) => {
    // ZERO-CONFIG: We now use the device ID + .local instead of an IP prompt!
    const mdnsAddress = `${deviceId}.local`;
    
    activeLocalToken = localStorage.getItem(`token_${deviceId}`) || 'TEST_TOKEN_123';

    const modal = document.getElementById('localControlModal');
    const status = document.getElementById('wssStatus');
    document.getElementById('localDeviceTitle').textContent = `Local: ${deviceId}`;
    modal.classList.remove('hidden');
    status.textContent = `DISCOVERING ${mdnsAddress}...`;
    status.className = 'status-badge status-pending';

    if (localWs) localWs.close();
    
    // Connect to Port 82 via mDNS
    localWs = new WebSocket(`wss://${mdnsAddress}:82`);

    localWs.onopen = () => {
      status.textContent = 'SECURELY CONNECTED';
      status.className = 'status-badge status-online';
    };

    localWs.onclose = () => {
      status.textContent = 'DISCONNECTED';
      status.className = 'status-badge status-offline';
    };

    localWs.onerror = () => {
      alert("Connection failed. Ensure you are on the same WiFi and have accepted the SSL cert.");
    };
  };

  window.sendLocalCommand = (action) => {
    if (!localWs || localWs.readyState !== WebSocket.OPEN) return alert("Not connected");
    
    // SECRET HANDSHAKE: Send the token inside every JSON command
    const payload = JSON.stringify({
      token: activeLocalToken,
      action: action
    });

    localWs.send(payload);
    console.log("[Local WSS] Sent:", action);
  };

  document.getElementById('btnCloseLocal').onclick = () => {
    if (localWs) localWs.close();
    document.getElementById('localControlModal').classList.add('hidden');
  };

  document.getElementById('btnLogout').onclick = () => {
    localStorage.removeItem('iotyk_token');
    location.reload();
  };
});
