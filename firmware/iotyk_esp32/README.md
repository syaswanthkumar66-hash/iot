# IoTYK ESP32 Firmware

## Arduino libraries

Install these libraries before flashing:

- ArduinoJson
- PubSubClient
- WebSockets by Markus Sattler

## Factory flashing

1. Generate a device from the factory website.
2. Download the generated `config.h`.
3. Replace `firmware/iotyk_esp32/config.h` with the downloaded file.
4. Paste the EMQX CA certificate into `certificates.h`.
5. Flash `iotyk_esp32.ino`.

The device uses BLE for first setup, local `ws://<device_id>.local:81` for LAN control, local HTTP on port 80 for `/info`, `/state`, and `/cmd`, and EMQX MQTT over TLS for remote control.

## Local WSS

The app tries local `wss://<device_id>.local:82` first and falls back to `ws://<device_id>.local:81`.

To enable ESP32 local WSS:

1. Generate a server certificate whose SAN includes `DNS:<device_id>.local`.
2. Install/trust the CA or server certificate on the phone OS.
3. Paste the server certificate and private key into `certificates.h`.
4. Set this in `config.h`:

```cpp
#define LOCAL_WSS_ENABLED true
```

Without phone OS trust, React Native WebSocket will reject local WSS even if the ESP32 has a certificate.

## Relay commands

Generated firmware supports 1 to 8 relays. Default GPIO allocation:

`26, 27, 14, 25, 33, 32, 23, 22`

Commands:

```json
{ "power": "on" }
```

Turns all relays on/off.

```json
{ "relay": 1, "power": "on" }
```

Controls one relay by 1-based relay number.

```json
{ "relays": [{ "id": 1, "power": "on" }, { "id": 2, "power": "off" }] }
```

Controls multiple relays in one message.

```json
{ "wifi": { "ssid": "NewNetwork", "password": "new-password" } }
```

Saves new WiFi credentials and restarts the ESP32 after acknowledging the command. This works through local WebSocket when the phone is on the same LAN, or through MQTT when the device is still reachable over the internet.
