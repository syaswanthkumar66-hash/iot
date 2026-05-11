# 📱 Mobile App Plan: Codebase Gap Analysis & Actionable Upgrades

This plan outlines the technical audit of your existing React Native / Expo application files (located inside `mobile-app/src/services/`) and provides the exact code implementations and adjustments required to connect with the new firmware.

---

## 📊 1. Codebase Gap Analysis (Existing vs. Master Plan)

### A. Local WebSocket Auth Handshake (`local.js`)
*   **The Findings:** Your existing WebSocket connection logic inside **[`local.js`](file:///C:/Users/sp799/Documents/iotyk/mobile-app/src/services/local.js)** opens a connection directly but does not handle the newly optimized **cryptographic challenge-response sequence**.
*   **The Change Needed:** We must update the WebSocket listener in `local.js`. Upon opening the socket, it must intercept the incoming random `nonce`, compute a SHA-256 HMAC of the nonce using your saved `local_token`, and send back the authorization payload to unlock control.

### B. BLE Base64 Encoding (`ble.js`)
*   **The Findings:** Your existing BLE service **[`ble.js`](file:///C:/Users/sp799/Documents/iotyk/mobile-app/src/services/ble.js)** writes plaintext strings to character properties. Modern mobile systems require safe string conversions.
*   **The Change Needed:** Ensure all JSON payloads written to `BLE_TOKEN_CHAR_UUID` are correctly flattened, minified, and Base64 encoded before calling `writeCharacteristicWithResponse`.

---

## 🛠️ 2. File-by-File Code Implementations

### File A: `src/services/local.js` (Add Local HMAC Handshake)
Update your WebSocket connection logic to automatically authenticate using your device's private token:

```javascript
import CryptoJS from 'crypto-js';
import { getLocalTokenFromStorage } from './auth'; // Helper to fetch token

let ws = null;

export function connectLocalWS(deviceIP, deviceId, onStatusChange, onMessageReceived) {
    const wsUrl = `ws://${deviceIP}/ws`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log(`Connected to local WebSocket: ${wsUrl}`);
    };

    ws.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);

            // 1. Intercept Challenge Nonce from ESP32
            if (data.nonce) {
                console.log(`Received challenge nonce: ${data.nonce}`);
                
                // Fetch saved device local token
                const localToken = await getLocalTokenFromStorage(deviceId);
                
                // Calculate HMAC-SHA256(key = localToken, data = nonce)
                const hash = CryptoJS.HmacSHA256(data.nonce, localToken);
                const hashHex = CryptoJS.enc.Hex.stringify(hash);

                // Send back auth response
                const authPayload = {
                    v: 2,
                    auth: hashHex
                };
                ws.send(JSON.stringify(authPayload));
                return;
            }

            // 2. Intercept Handshake Status
            if (data.status === "auth_ok") {
                console.log("✓ Local WebSocket authorized successfully!");
                onStatusChange("authorized");
                return;
            }

            // 3. Handle standard control messages
            onMessageReceived(data);

        } catch (error) {
            console.error("Failed to parse WS payload:", error);
        }
    };

    ws.onclose = () => {
        console.log("Local WebSocket closed");
        onStatusChange("disconnected");
    };

    ws.onerror = (error) => {
        console.error("Local WebSocket error:", error);
    };
}

export function sendLocalCommand(cmdJson) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ v: 2, ...cmdJson }));
        return true;
    }
    return false;
}
```

---

### File B: `src/services/ble.js` (Format and Encode Pairing strings)
Ensure that the onboarding credentials payload is correctly formatted and serialized:

```javascript
import { Buffer } from 'buffer';

export async function writeOnboardingCredentials(device, wifiSsid, wifiPass, localToken, mqttUser, mqttPass) {
    const wifiCharUuid = "abcd1234-5678-1234-5678-abcdef123456";
    const tokenCharUuid = "abcd1234-5678-1234-5678-abcdef123457";

    // 1. Write WiFi payload
    const wifiPayload = `${wifiSsid},${wifiPass}`;
    const base64Wifi = Buffer.from(wifiPayload).toString('base64');
    await device.writeCharacteristicWithResponseForService(
        "12345678-1234-1234-1234-123456789abc",
        wifiCharUuid,
        base64Wifi
    );

    // 2. Write Authentication/Pairing payload
    const pairingObj = {
        key: "iotyk-factory-initial-key-2026",
        token: localToken,
        mqtt: {
            u: mqttUser,
            p: mqttPass
        }
    };

    const pairingString = JSON.stringify(pairingObj);
    const base64Pairing = Buffer.from(pairingString).toString('base64');

    await device.writeCharacteristicWithResponseForService(
        "12345678-1234-1234-1234-123456789abc",
        tokenCharUuid,
        base64Pairing
    );

    console.log("✓ Onboarding payload successfully transmitted over BLE!");
}
```

---

### File C: `src/services/api.js` (Support Keep-Alive Spin Checks)
Modify your central REST configuration to prevent freezing during backend sleep times:
*   Configure the connection timeout to **50 seconds** in Axios settings.
*   Expose the `/health` checker endpoint to trigger the "Waking up server..." UI loader whenever a latency spike above 1.5 seconds is detected.
