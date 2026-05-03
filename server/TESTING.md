# IoTYK Server - API Testing Guide

Quick reference for testing all endpoints with curl.

## Prerequisites

- Server running: `npm start` or `npm run dev`
- Default: http://localhost:3000

## 1. Register Device

Register a new device and user, get config.h.

```bash
curl -X POST http://localhost:3000/api/factory/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@iotyk.local",
    "password": "SecurePassword123",
    "relay_count": 2
  }'
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
  }
}
```

Copy the `config_h` content and save to `config.h` in your ESP32 firmware project.

---

## 2. User Login

Authenticate and get JWT token.

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@iotyk.local",
    "password": "SecurePassword123"
  }'
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_1725340800123",
    "email": "admin@iotyk.local"
  }
}
```

**Save the token for next requests:**
```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## 3. Get User Profile

Get authenticated user and their devices.

```bash
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "id": "user_1725340800123",
  "email": "admin@iotyk.local",
  "devices": ["ESP32-ABC123"]
}
```

---

## 4. List All Devices

Get all devices for this user with current state.

```bash
curl -X GET http://localhost:3000/api/devices \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
[
  {
    "id": "ESP32-ABC123",
    "namespace": "ns_19e0fc21e130476e",
    "online": false,
    "last_seen": null,
    "relay_states": ["off", "off"],
    "rssi": null,
    "fw": null
  }
]
```

---

## 5. Get Device Details

Get single device full information.

```bash
curl -X GET http://localhost:3000/api/devices/ESP32-ABC123 \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "id": "ESP32-ABC123",
  "namespace": "ns_19e0fc21e130476e",
  "online": false,
  "last_seen": null,
  "relay_states": ["off", "off"],
  "rssi": null,
  "firmware_version": null,
  "created_at": 1725340800123
}
```

---

## 6. Get Local Token

Get token for local HTTP/WS authentication (same LAN).

```bash
curl -X GET http://localhost:3000/api/devices/ESP32-ABC123/token \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "local_token": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
}
```

---

## 7. Send Relay Command

Send command to control relays.

### Turn all relays on
```bash
curl -X POST http://localhost:3000/api/devices/ESP32-ABC123/cmd \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "power": "on" }'
```

### Turn all relays off
```bash
curl -X POST http://localhost:3000/api/devices/ESP32-ABC123/cmd \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "power": "off" }'
```

### Control relay 1 only (1-based)
```bash
curl -X POST http://localhost:3000/api/devices/ESP32-ABC123/cmd \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "relay": 1, "power": "on" }'
```

### Control multiple relays
```bash
curl -X POST http://localhost:3000/api/devices/ESP32-ABC123/cmd \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "relays": [
      { "id": 1, "power": "on" },
      { "id": 2, "power": "off" }
    ]
  }'
```

### Update WiFi credentials
```bash
curl -X POST http://localhost:3000/api/devices/ESP32-ABC123/cmd \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "wifi": {
      "ssid": "MyNetwork",
      "password": "WifiPassword123"
    }
  }'
```

**Response:**
```json
{
  "sent": true,
  "command": { "power": "on" }
}
```

---

## 8. Get Command History

Get last 50 commands sent to device.

```bash
curl -X GET http://localhost:3000/api/devices/ESP32-ABC123/commands \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
[
  {
    "id": 1,
    "device_id": "ESP32-ABC123",
    "source": "mqtt",
    "command": { "power": "on" },
    "sent_at": 1725340800123,
    "acked": false
  }
]
```

---

## 9. Rotate Credentials

Manually rotate temporary MQTT credentials.

```bash
curl -X POST http://localhost:3000/api/devices/ESP32-ABC123/rotate \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "temp_user": "tmp_newXXXX",
  "temp_pass": "NewSecurePassword123..."
}
```

---

## 10. Delete Device

Soft delete device (marks offline).

```bash
curl -X DELETE http://localhost:3000/api/devices/ESP32-ABC123 \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "message": "Device deleted"
}
```

---

## Health Check

Check if server is running (no auth required).

```bash
curl http://localhost:3000/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-05-01T12:00:00.000Z"
}
```

---

## Error Responses

### Missing token
```bash
curl http://localhost:3000/api/devices
```

**Response (401):**
```json
{ "error": "No token provided" }
```

### Invalid token
```bash
curl -X GET http://localhost:3000/api/devices \
  -H "Authorization: Bearer invalid-token"
```

**Response (401):**
```json
{ "error": "Invalid token" }
```

### Device not found
```bash
curl -X GET http://localhost:3000/api/devices/ESP32-UNKNOWN \
  -H "Authorization: Bearer $TOKEN"
```

**Response (404):**
```json
{ "error": "Device not found" }
```

---

## Save Token to Environment

```bash
# Get token and save to variable
export TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@iotyk.local",
    "password": "SecurePassword123"
  }' | jq -r '.token')

echo $TOKEN
```

---

## Useful jq Filters

Extract specific data from responses:

```bash
# Get device ID
curl -s http://localhost:3000/api/devices \
  -H "Authorization: Bearer $TOKEN" | jq '.[0].id'

# Get all device states
curl -s http://localhost:3000/api/devices \
  -H "Authorization: Bearer $TOKEN" | jq '.[] | {id, online, relay_states}'

# Get command count
curl -s http://localhost:3000/api/devices/ESP32-ABC123/commands \
  -H "Authorization: Bearer $TOKEN" | jq 'length'
```

---

## Troubleshooting

**Connection refused:**
- Make sure server is running: `npm start`
- Check port 3000 is accessible

**Invalid token:**
- Generate new token with login endpoint
- Tokens expire after 7 days

**Device not found:**
- Register device first: POST /api/factory/register
- Check device ID spelling

**MQTT not connected:**
- Check EMQX broker is running
- Verify EMQX_BROKER, EMQX_API_USER, EMQX_API_PASS in .env
