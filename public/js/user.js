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
      const list = document.getElementById('deviceList');
      list.innerHTML = '';

      if (data.devices.length === 0) {
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
          <span class="status-badge ${d.is_online ? 'status-online' : 'status-offline'}">
            ${d.is_online ? 'ONLINE' : 'OFFLINE'}
          </span>
        `;
        list.appendChild(item);
      });
    } catch (err) { console.error(err); }
  }

  document.getElementById('btnLogout').onclick = () => {
    localStorage.removeItem('iotyk_token');
    location.reload();
  };
});
