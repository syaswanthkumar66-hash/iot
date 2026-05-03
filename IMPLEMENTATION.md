# IoTYK Server - Complete Implementation

Complete Node.js server implementation for IoTYK ESP32 device management, featuring MQTT device communication, user authentication, relay control, and credential rotation.

## 📋 Project Structure

```
server/
├── index.js              # Express app initialization
├── db.js                 # SQLite database setup
├── auth.js               # Authentication utilities
├── mqtt.js               # MQTT broker connection
├── package.json          # Dependencies
├── .env.example          # Environment template
├── routes/
│   ├── factory.js        # Device registration & config.h generation
│   ├── auth.js           # User login & token
│   ├── devices.js        # Device CRUD operations
│   └── commands.js       # Relay command routes
└── cron/
    └── rotate.js         # Credential rotation job
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd server
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required variables:
- `JWT_SECRET` — Random string for JWT signing (32+ chars recommended)
- `EMQX_BROKER` — Your EMQX broker hostname
- `EMQX_PORT` — MQTT port (typically 8883 for TLS)
- `EMQX_API_USER` — EMQX admin username
- `EMQX_API_PASS` — EMQX admin password
- `DB_PATH` — SQLite database file path

### 3. Start Server

**Development (with auto-reload):**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

Server runs on port 3000 by default (configurable via `PORT` env var).

## 📡 API Endpoints

### Health Check
```
GET /health
```
Response:
```json
{ "status": "ok", "timestamp": "2026-05-01T..." }
```

---

### Factory Registration
**POST /api/factory/register**

Register new device and generate `config.h` for ESP32 firmware.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "securepassword",
  "relay_count": 1
}
```

**Response:**
```json
{
  "device_id": "ESP32-ABC123",
  "namespace": "ns_19e0fc21e130476e",
  "config_h": "...",
  "local_token": "...",
  "mqtt": {
    "temp_user": "tmp_xyz...",
    "temp_pass": "..."
  },
  "user": {
    "id": "user_1234567890",
    "email": "user@example.com"
  }
}
```

---

### User Authentication

#### Login
**POST /api/auth/login**

Authenticate user and get JWT token.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_1234567890",
    "email": "user@example.com"
  }
}
```

#### Get Profile
**GET /api/auth/me**

Get authenticated user profile and device list.

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
```

**Response:**
```json
{
  "id": "user_1234567890",
  "email": "user@example.com",
  "devices": ["ESP32-ABC123", "ESP32-DEF456"]
}
```

---

### Device Management

#### List Devices
**GET /api/devices**

Get all devices for authenticated user.

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
```

**Response:**
```json
[
  {
    "id": "ESP32-ABC123",
    "namespace": "ns_19e0fc21e130476e",
    "online": true,
    "last_seen": 1725340800000,
    "relay_states": ["on", "off"],
    "rssi": -65,
    "fw": "1.1.0"
  }
]
```

#### Get Device Details
**GET /api/devices/:id**

Get single device full details.

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
```

**Response:**
```json
{
  "id": "ESP32-ABC123",
  "namespace": "ns_19e0fc21e130476e",
  "online": true,
  "last_seen": 1725340800000,
  "relay_states": ["on", "off"],
  "rssi": -65,
  "firmware_version": "1.1.0",
  "created_at": 1725340800000
}
```

#### Get Local Token
**GET /api/devices/:id/token**

Get local HTTP/WS authentication token for same-LAN communication.

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
```

**Response:**
```json
{
  "local_token": "a1b2c3d4e5f6..."
}
```

#### Rotate Credentials
**POST /api/devices/:id/rotate**

Manually rotate temporary MQTT credentials. (Automatic daily rotation also runs via cron.)

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
```

**Response:**
```json
{
  "temp_user": "tmp_newhash",
  "temp_pass": "newsecurepass"
}
```

#### Delete Device
**DELETE /api/devices/:id**

Soft delete device (marks offline).

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
```

**Response:**
```json
{ "message": "Device deleted" }
```

---

### Relay Commands

#### Send Command
**POST /api/devices/:id/cmd**

Send relay command to device via MQTT.

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

**Request (examples):**

All relays on:
```json
{ "power": "on" }
```

Single relay:
```json
{ "relay": 1, "power": "on" }
```

Multiple relays:
```json
{ "relays": [{ "id": 1, "power": "on" }, { "id": 2, "power": "off" }] }
```

Update WiFi:
```json
{ "wifi": { "ssid": "MyNetwork", "password": "wifipass" } }
```

**Response:**
```json
{
  "sent": true,
  "command": { "power": "on" }
}
```

#### Get Command History
**GET /api/devices/:id/commands**

Get last 50 command logs for device.

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
```

**Response:**
```json
[
  {
    "id": 42,
    "device_id": "ESP32-ABC123",
    "source": "mqtt",
    "command": { "power": "on" },
    "sent_at": 1725340800000,
    "acked": false
  }
]
```

---

## 🔄 Workflows

### 1. Device Registration (Factory Setup)

```
1. Admin POST /api/factory/register
   → Creates user + device
   → Generates unique device_id, namespace, MQTT credentials
   → Returns config.h content

2. Admin flashes config.h to ESP32

3. Device boots with factory credentials
```

### 2. User Login

```
1. User POST /api/auth/login
   → Verify email/password
   → Issue JWT token (7-day expiry)

2. User stores token in mobile app
```

### 3. BLE Provisioning (Mobile → ESP32)

```
1. Mobile GET /api/devices/:id/token
   → Get local_token for later HTTP/WS auth

2. Mobile app connects to ESP32 via BLE

3. Mobile writes to BLE_WIFI_CHAR_UUID (base64 encoded):
   → SSID,PASSWORD

4. Mobile writes to BLE_TOKEN_CHAR_UUID (base64 JSON):
   → { "token": "<local_token>", "mqtt": { "u": "<temp_user>", "p": "<temp_pass>" } }

5. ESP32 connects to WiFi → MQTT broker

6. ESP32 publishes device/<ns>/status
   → Server marks device online
```

### 4. Remote Control (User → Server → Device)

```
1. User POST /api/devices/:id/cmd with relay command
   → Server publishes to device/<ns>/cmd

2. ESP32 receives command → changes relay state

3. ESP32 publishes device/<ns>/state
   → Server updates relay_states in DB

4. User sees updated state on next GET /api/devices
```

### 5. Local Control (Same LAN, No Internet)

```
1. Mobile GET /api/devices/:id/token
   → Get local_token

2. Mobile sends HTTP/WS to <device_id>.local
   → Authorization: Bearer <local_token>
   → Command executes locally without server
```

### 6. Credential Rotation

**Automatic (every 24 hours):**
```
1. Cron job runs (configurable schedule)
2. For each online device:
   - Generate new temp_user + temp_pass
   - Update DB
   - Publish to device/<ns>/sys/rotate
3. ESP32 receives rotation → reconnects temp MQTT with new creds
```

**Manual:**
```
POST /api/devices/:id/rotate
→ Triggers same process immediately
```

---

## 🗄️ Database Schema

### users
```sql
id          TEXT PRIMARY KEY        -- user_<timestamp>
email       TEXT UNIQUE NOT NULL
password_hash TEXT NOT NULL
created_at  INTEGER NOT NULL        -- Unix ms
```

### devices
```sql
id                  TEXT PRIMARY KEY    -- ESP32-XXXXXX
user_id             TEXT NOT NULL       -- FK → users
namespace           TEXT UNIQUE         -- ns_<hex>
perm_mqtt_user      TEXT NOT NULL
perm_mqtt_pass      TEXT NOT NULL
temp_mqtt_user      TEXT NOT NULL
temp_mqtt_pass      TEXT NOT NULL
local_token         TEXT NOT NULL
firmware_version    TEXT
online              BOOLEAN DEFAULT 0
last_seen           INTEGER
relay_states        TEXT                -- JSON array
rssi                INTEGER
created_at          INTEGER NOT NULL
```

### commands_log
```sql
id        INTEGER PRIMARY KEY AUTOINCREMENT
device_id TEXT NOT NULL           -- FK → devices
source    TEXT NOT NULL           -- mqtt|http|ws
command   TEXT NOT NULL           -- JSON
sent_at   INTEGER NOT NULL        -- Unix ms
acked     BOOLEAN DEFAULT 0
```

---

## 🔐 Security Notes

- **JWT Secret:** Must be 32+ random characters. Use:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

- **EMQX Connection:** Uses TLS (port 8883). For self-signed certs in dev, set `rejectUnauthorized: false` in `mqtt.js` (change in production).

- **Password Hashing:** Uses bcrypt (10 rounds).

- **Credential Rotation:** Temp MQTT credentials rotate automatically every 24 hours, limiting exposure of any compromised credentials.

- **Local Token:** Random 32-byte hex token for same-LAN HTTP/WS auth. Different from JWT.

---

## 🛠️ Development

### Start Dev Server
```bash
npm run dev
```

### Environment: Development
```
NODE_ENV=development
```
- Credential rotation every 30 minutes (for testing)
- Enhanced logging

### Environment: Production
```
NODE_ENV=production
```
- Credential rotation every 24 hours (at midnight)

---

## 📦 Dependencies

- **express** — Web framework
- **better-sqlite3** — SQLite database
- **mqtt** — MQTT client
- **jsonwebtoken** — JWT signing/verification
- **bcrypt** — Password hashing
- **dotenv** — Environment config
- **node-cron** — Scheduled tasks

---

## 🐛 Troubleshooting

**MQTT connection fails:**
- Check EMQX broker is running and accessible
- Verify EMQX_BROKER, EMQX_PORT, EMQX_API_USER, EMQX_API_PASS in .env
- Check firewall/network rules for port 8883

**Device not coming online:**
- Verify ESP32 received correct config.h during registration
- Check device has valid WiFi credentials provisioned via BLE
- Monitor MQTT topic: `device/+/status` for status messages

**JWT token errors:**
- Ensure JWT_SECRET is set in .env
- Token expires after 7 days; users need to re-login
- Check token format: `Authorization: Bearer <token>`

---

## 📞 Support

For detailed firmware implementation, see [ESP32 Firmware README](../firmware/iotyk_esp32/README.md).
