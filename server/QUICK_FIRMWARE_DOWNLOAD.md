# Quick ESP32 Firmware Download Guide (WSS Only)

**90-second setup for downloading and flashing ESP32 firmware with WebSocket Secure (WSS) encryption.**

---

## 🚀 Quick Start (1 minute)

### 1. Register Device
```bash
curl -X POST http://localhost:3000/api/factory/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "password123",
    "relay_count": 1
  }'
```

Save these from response:
- `device_id` (e.g., `ESP32-ABC123`)
- `firmware_download` URL

### 2. Download Firmware
```bash
curl -O http://localhost:3000/api/factory/generate-firmware/ESP32-ABC123
# Creates: ESP32-ABC123_firmware.zip
```

### 3. Extract & Flash
```bash
unzip ESP32-ABC123_firmware.zip
cd ESP32-ABC123_firmware
pio run -t upload -e esp32-wroom-32
```

### 4. Monitor Boot
```bash
pio device monitor
# Look for: "✅ WebSocket Secure (WSS) started on port 82"
```

---

## 📦 Inside the ZIP

```
ESP32-ABC123_firmware.zip
├── src/main.cpp                # Ready to compile
├── include/
│   ├── config.h               # Device config
│   ├── certificates.h         # Auto-generated WSS certs
│   ├── ble_provision.h        # BLE provisioning
│   ├── mqtt_manager.h         # MQTT connections
│   └── local_server_wss.h     # WSS server (NO HTTP)
├── platformio.ini             # PlatformIO config
└── library.json               # Dependencies
```

---

## 🔒 Security Features

✅ **WebSocket Secure (WSS)** - TLS encrypted on port 82
✅ **Self-signed certificates** - Auto-generated per device
✅ **Token authentication** - Local access token required
✅ **NO HTTP** - Removed for security

---

## 💬 Local Communication (After Flashing)

### JavaScript
```javascript
const ws = new WebSocket(`wss://ESP32-ABC123.local:82`);

ws.onopen = () => {
  ws.send(JSON.stringify({
    token: "your_token_here",
    cmd: { power: "on" }
  }));
};

ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

### Python
```python
import websocket, ssl, json

ws = websocket.WebSocketApp(
    "wss://ESP32-ABC123.local:82",
    sslopt={"cert_reqs": ssl.CERT_NONE}
)

ws.send(json.dumps({
    "token": "your_token_here",
    "cmd": {"relay": 1, "power": "on"}
}))

ws.run_forever()
```

---

## 📋 File Structure Summary

| File | Purpose |
|------|---------|
| `config.h` | Device IDs, MQTT broker, relay count |
| `certificates.h` | WSS certificates (hex arrays) |
| `ble_provision.h` | BLE WiFi provisioning |
| `mqtt_manager.h` | MQTT client setup |
| `local_server_wss.h` | WebSocket Secure server |
| `main.cpp` | Main sketch (integrates all) |

---

## 🛠️ Customization

### More Relays
```bash
curl -X POST http://localhost:3000/api/factory/register \
  -d '{...,"relay_count": 4}'  # 4 relays on pins 26-29
```

### Different MQTT Broker
Update `.env` on server:
```
EMQX_BROKER=your-broker.com
```

---

## ✅ Verification

After flashing, you should see:
```
✅ BLE Provisioning started
✅ Relay pins configured: 1 relays
✅ MQTT Permanent connected
✅ MQTT Temporary connected
✅ WebSocket Secure (WSS) started on port 82
   Access via: wss://ESP32-ABC123.local:82
```

---

## 🔑 Key Points

- **Port 82:** WebSocket Secure (WSS) only
- **Token:** Required for all commands
- **mDNS:** Access via `device_id.local`
- **Certificates:** Self-signed, unique per device
- **Relay control:** Via MQTT or WSS

---

**Total Setup Time:** ~90 seconds
**Firmware Size:** ~500KB
**Protocol:** WebSocket Secure (TLS encrypted)
**Last Updated:** 2024
