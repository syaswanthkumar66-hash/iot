# IoTYK Production ESP-IDF Firmware Guide
**ESP32-S3 | 4 MB Flash | High-Security Local WebSockets & Redundancy**

This firmware is written in **100% Native ESP-IDF (C/C++)** optimized for maximum performance, minimum memory footprint, and military-grade local and serial authorization. All heavy legacy TLS stacks and dynamic parser leaks have been eradicated.

---

## 🚀 1. How to Build and Flash

### Prerequisite
Install the **Espressif ESP-IDF Command Line Toolchain** (v5.1 or later recommended) on your machine.

### Build and Clean
Launch your ESP-IDF Terminal and navigate to the project directory:
```powershell
cd firmware/iotyk_esp32
```
To run a clean build and generate the highly optimized `-Os` binary with Link Time Optimization (LTO) active:
```powershell
idf.py fullclean
idf.py build
```

### Flash and Monitor
Attach your ESP32-S3 device via USB and flash the program (replace `COMx` or `/dev/ttyUSBx` with your specific serial interface):
```powershell
idf.py -p COM3 flash monitor
```

---

## 🛠️ 2. Custom 4 MB Partition Table

The flash memory structure has been custom tailored inside `partitions.csv` for bulletproof over-the-air (OTA) updates with **zero SPIFFS space**:

| Partition Name | Type | Size | Purpose |
|:---|:---|:---|:---|
| `nvs` | Data | 24 KB | Redundant configuration database |
| `otadata` | Data | 8 KB | OTA active partition slot selectors |
| `factory_rescue` | App | 1024 KB | Golden image fallback partition |
| `ota_0` | App | 1472 KB | Main active app binary slot |
| `ota_1` | App | 1472 KB | Secondary update app binary slot |

---

## 🔐 3. Hardware Provisioning & Serial Handshake (Flow 2)

Once compiled and flashed, the firmware locks down the UART console to prevent unauthorized tampering.

### Provisioning Handshake Steps:
1. **Challenge Issuance:** On boot, the ESP32-S3 outputs a cryptographically secure random challenge hex over serial:
   ```text
   CHALLENGE_NONCE:3AC1D4E9F8B2D102C4E9...
   ```
2. **Dashboard Capture:** The Web Factory Console captures this challenge automatically.
3. **Backend Signature:** When the operator clicks **`Authenticate`**, the dashboard submits this nonce to the backend (`POST /api/v1/factory/sign-nonce`). The backend signs it using the **Factory Private Key** (`HMAC-SHA256`) and returns the hex signature.
4. **Console Unlock:** The dashboard transmits `AUTH:<signature_hex>` back over the USB serial line.
5. **Lockout Lifted:** The ESP32-S3 validates the signature in constant-time using mbedTLS. If correct, it returns `AUTH_OK`, enabling provisioning commands.
6. **Physical Lock:** Once a device is fully provisioned, the board permanently shuts down standard UART RX interrupts to prevent remote or physical logic injections.

---

## 📡 4. Serial Command Terminal Map

Once authenticated, the following control codes are supported via Web Serial:

*   **`STATUS`** — Emits real-time diagnostic reports on heap caps, internal temperature sensor registers, NVS health, and WiFi/MQTT connection links.
*   **`PROV:<json_payload>`** — Writes temporary 24-hour setup tokens and WiFi SSID/Passwords to begin onboarding:
    ```json
    PROV:{"ssid":"HomeWiFi","pass":"secret","mqtt_u":"temp_user","mqtt_p":"temp_pass","l_tok":"local_token"}
    ```
*   **`PROV_PERM:<json_payload>`** — Burns permanent MQTT usernames/passwords, device IDs, and local tokens permanently into NVS:
    ```json
    PROV_PERM:{"device_id":"iotyk-ESP32-123","user":"perm_u","pass":"perm_p","token":"local_token","r_cnt":"4"}
    ```
*   **`RESET`** — Safe software reboot.
*   **`FACTORY_RESET`** or **`CLEAR_NVS`** — Clears NVS parameters and reboots to unprovisioned state.
