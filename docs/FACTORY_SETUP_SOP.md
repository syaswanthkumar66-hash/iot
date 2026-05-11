# 🏭 IoTYK ESP32 Smart Relay — Factory Production SOP Manual

This manual outlines the Standard Operating Procedure (SOP) for preparing, compiling, flashing, and provisioning the IoTYK ESP32 Smart Relay board on the production line.

---

## 🖥️ Phase 1: BEFORE Flashing (Preparation Phase)

Before flashing the firmware onto any chip, the generic configurations and cloud security certificates must be set once in the source code.

### Step 1: Configure Cloud Certificates
1. Download your EMQX MQTT Root CA Certificate (`ca.crt`) from your EMQX website console.
2. Open the file **`main/certificates.h`** on your computer.
3. Paste your EMQX Root Certificate content into the static variable **`EMQX_MQTT_CA_CERT`** (retaining the newline `\n` characters).
   ```cpp
   static const char EMQX_MQTT_CA_CERT[] = 
   "-----BEGIN CERTIFICATE-----\n"
   "YOUR_EMQX_CA_CERTIFICATE_HERE\n"
   "-----END CERTIFICATE-----";
   ```

### Step 2: Configure Default Broker URL
1. Open the file **`main/config.h`** on your computer.
2. Navigate to line 49 and update the **`DEFAULT_MQTT_BROKER`** macro with your official EMQX Cloud Broker domain address:
   ```cpp
   #define DEFAULT_MQTT_BROKER "xxxx.ala.us-east-1.emqxsl.com"
   ```

### Step 3: Verify the Factory Token
1. In the same **`main/config.h`** file, check that the pre-shared Factory Master Token on line 58 is matching your mobile application:
   ```cpp
   #define FACTORY_LOCAL_TOKEN "iotyk-factory-initial-key-2026"
   ```

---

## ⚡ Phase 2: FLASHING (Production Phase)

Once your source code configuration is ready, perform the physical programming of the ESP32 module.

### Step 1: Connect the Microcontroller
1. Connect your ESP32 DevKit board to the computer using a high-quality micro-USB or USB-C cable (ensuring it uses a CP2102 or CH340 USB-to-UART bridge).
2. Open Windows **Device Manager** and check under "Ports (COM & LPT)" to identify the assigned port (e.g., `COM5`).

### Step 2: Compile & Flash the Firmware
Open your PowerShell terminal and execute the sequential compilation and flashing command:

```powershell
ninja -j 1 -C build; idf.py -p COM5 flash monitor
```

*Note: The `-j 1` flag prevents Windows Defender from locking the build files, ensuring a clean, uninterrupted compilation.*

---

## 🔌 Phase 3: AFTER Flashing (Provisioning & Quality Check)

Once the flashing completes, the device automatically boots and opens the interactive USB Serial shell. You must now configure its unique individual identity.

### Step 1: Check the Boot Output
When the serial monitor connects, verify that the board boots up correctly and prints its dynamic boot details:

```text
Device booted
Device ID: iotyk-3FF4A21D80C4         <-- MAC-based default ID
CHALLENGE_NONCE:9F3E5A7B8C2D3E4F...  <-- Random 32-character nonce
Device Name: IoTYK Smart Relay
Device started
BLE onboarding mode started
```

### Step 2: Unlock the Serial Terminal
Because a factory key is set, the input commands are initially locked. Your Factory Dashboard program must automatically read the `CHALLENGE_NONCE` from stdout, calculate the HMAC-SHA256 signature using the `FACTORY_LOCAL_TOKEN`, and send the unlock key:

```text
AUTH:<computed_hmac_hex_signature>
```

*Response:*
```text
AUTH_OK
[I] Serial terminal successfully unlocked.
```

### Step 3: Write the Unique Customer Configuration
Once unlocked, send the unique customer credentials to provision the board permanently:

```json
PROV_PERM:{"device_id":"iotyk-customer-1029","user":"mqtt_usr_1029","pass":"mqtt_pwd_1029","token":"secure_pairing_token_1029","r_cnt":"4"}
```

#### What this payload configures:
*   `device_id`: The official registered serial ID for this customer.
*   `user` / `pass`: The unique, private MQTT broker credentials for this device.
*   `token`: The secure pairing key used to encrypt the local WebSocket communication for this specific client.
*   `r_cnt`: Sets whether this specific physical unit has 1, 2, or 4 active relay channels.

### Step 4: Automatic Reboot & Quality Check (QA)
After receiving the payload, the device automatically saves the configuration across both redundant NVS partitions, reboots, and displays its finalized secure identity:

```text
Device booted
Device ID: iotyk-customer-1029
[I] Device is fully provisioned. Shutting down serial RX interrupts for lock safety.
```

*The setup is now complete! The serial RX port is locked down automatically for hardware tamper protection. The device can now be disconnected, packaged, and shipped to the customer!* 🚀
