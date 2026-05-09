# IoTYK Native ESP-IDF Firmware Guide

This project has been fully migrated to **100% native ESP-IDF (C/C++)** for maximum performance, minimal memory usage, and high-security standards. All Arduino dependencies have been eliminated.

---

## 🚀 How to Build and Flash

### 1. Prerequisite
Ensure you have the **Espressif ESP-IDF Toolchain** (v5.0 or later recommended) installed on your system.

### 2. Configure Environment
Open your ESP-IDF Command Prompt (or Terminal) and navigate to this folder:
```bash
cd firmware/iotyk_esp32
```

### 3. Build the Firmware
Compile the project natively. This will automatically download and link the lightweight **NimBLE** stack, build our SSL HTTPS/WSS servers, and generate the final binary:
```bash
idf.py build
```

### 4. Flash and Monitor
Connect your ESP32 device via USB and flash the program (replace `COMx` or `/dev/ttyUSBx` with your specific serial port):
```bash
idf.py -p COM3 flash monitor
```

---

## 🛠️ Web Factory Dashboard Diagnostics

When you open the **Web Factory Dashboard**, connect the device's USB serial port. The board will automatically pipe telemetry.
- Press **`AUTH`** inside the dashboard to input the device key (or let it read automatically from session storage) to unlock management routines.
- Run commands like **`STATUS`** for real-time networking state reports.
- Use **`PROV_PERM`** to burn permanent hardware identification keys into Non-Volatile Storage (NVS).
