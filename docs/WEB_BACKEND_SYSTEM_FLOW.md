# ☁️ IoTYK Web Dashboard & Render Backend — Cloud System Flow Manual

This manual details the architecture, file modules, API endpoints, and data flows of the **IoTYK Web Dashboard (Frontend)** and the **Render Cloud Backend (Server)**, detailing how they orchestrate devices and handle production.

---

## 🗺️ 1. Complete Web & Cloud Architecture Flowchart

This diagram traces the entire web-based data flow, showing how the Frontend Browser, Render Backend, and EMQX Cloud Broker interact.

```mermaid
graph TD
    %% Styling Definitions
    classDef file fill:#1e1e2f,stroke:#4f4f7f,stroke-width:2px,color:#d4d4d4;
    classDef process fill:#1a4d6c,stroke:#2a6d9c,stroke-width:2px,color:#ffffff;
    classDef external fill:#4a1c5a,stroke:#6e2c8a,stroke-width:2px,color:#ffffff;
    classDef payload fill:#5a5a1c,stroke:#8a8a2c,stroke-width:2px,color:#ffffff;

    %% Web Frontend Files (Browser)
    subgraph Web Frontend / Factory Dashboard (Client Browser)
        F_INDEX["index.html<br/>(Dashboard Layout)"]:::file
        F_STYLE["style.css<br/>(Premium Glassmorphism Style)"]:::file
        F_APP["app.js<br/>(Web Serial, Web Bluetooth & API Engine)"]:::file
    end

    %% Render Backend Files (Node.js/Express)
    subgraph Render Cloud Backend Modules (Server)
        B_SERVER["server.js<br/>(Express Core & Middleware)"]:::file
        B_DEV_R["routes/device.js<br/>(REST API Endpoints)"]:::file
        B_CRY_U["utils/crypto.js<br/>(HMAC, Cert Generator & Key Decryption)"]:::file
        B_EMQ_I["config/emqx.js<br/>(EMQX API Integration)"]:::file
    end

    %% External Systems
    subgraph External System Entities
        ESP32_D["ESP32 Relay Device<br/>(Hardware Module)"]:::external
        EMQX_CL["EMQX Cloud MQTTS Broker<br/>(Cloud MQTT Manager)"]:::external
    end

    %% Web APIs & Interchanges
    F_APP -->|1. Web Serial API| ESP32_D
    F_APP -->|2. Web Bluetooth API| ESP32_D
    
    %% Frontend to Render Backend HTTP REST API
    F_APP -->|3. POST /api/device/unlock| B_DEV_R
    F_APP -->|4. GET /api/device/:id/certs| B_DEV_R
    F_APP -->|5. POST /api/device/:id/command| B_DEV_R

    %% Render Backend Module Interaction
    B_SERVER -->|Loads Routes| B_DEV_R
    B_DEV_R -->|Calculates HMAC & WSS Certs| B_CRY_U
    B_DEV_R -->|Sends HTTP commands| B_EMQ_I

    %% Backend to Broker API
    B_EMQ_I -->|6. HTTPS POST /api/v5/publish| EMQX_CL
    EMQX_CL -->|7. Secure MQTTS on Port 8883| ESP32_D
```

---

## 📂 2. Render Backend Directory Structure (Recommended Layout)

The standard modular structure for your Render Cloud Backend matches your clean firmware design:

```text
iotyk-backend/
├── package.json               # Dependencies (express, cryptography, mqtt, dotenv)
├── server.js                  # Main server listener
├── .env                       # Environment variables (EMQX_KEY, EMQX_SECRET, EMQX_CA)
├── config/
│   └── emqx.js                # EMQX Cloud API credentials and HTTP connection setup
├── routes/
│   └── device.js              # Express routers for registering & configuring devices
└── utils/
    ├── cert_generator.js      # Runs dynamic RSA-2048 keypair/WSS certificate generation
    └── crypto.js              # Performs secure HMAC-SHA256 signature calculations
```

---

## 🔌 3. End-to-End REST API Specifications

The Render Backend exposes these core HTTP endpoints to power the Factory Dashboard and automate production.

### 🔐 3.1. Calculate Terminal Unlock Signature (`POST /api/device/unlock`)
Used in the factory to calculate the authentication unlock key from the chip's boot-up nonce.

*   **Endpoint:** `POST https://your-backend.render.com/api/device/unlock`
*   **Request JSON Payload:**
    ```json
    {
      "challenge": "A1B2C3D4E5F67890A1B2C3D4E5F67890"
    }
    ```
*   **Backend logic:** Reads the `FACTORY_LOCAL_TOKEN` from its secret environment variables (`process.env.FACTORY_LOCAL_TOKEN`) and calculates:
    `HMAC-SHA256(key=FACTORY_LOCAL_TOKEN, data=challenge)`
*   **Response JSON Payload:**
    ```json
    {
      "status": "success",
      "signature": "65b9e8a71234bcdef90123456789abcd65b9e8a71234bcdef90123456789abcd"
    }
    ```

---

### 📦 3.2. Fetch Dynamic Certificates (`GET /api/device/:id/certs`)
Called by the factory computer to download the pre-packaged `certificates.h` header file containing the static EMQX certificate and unique dynamic WSS certificates.

*   **Endpoint:** `GET https://your-backend.render.com/api/device/iotyk-customer-1029/certs`
*   **Request parameters:** `:id` = The unique Device ID.
*   **Backend logic:**
    1.  Generates a dynamic RSA-2048 WSS private key and signed certificate for `iotyk-customer-1029.local`.
    2.  Loads the static EMQX root certificate (`emqxsl-ca.crt`) from the backend environment.
    3.  Formulate a raw text response formatted exactly like `certificates.h` with C-string `EOF` syntax.
*   **Response Header:** `Content-Type: text/plain` (or `application/octet-stream` to download `certificates.h` directly).
*   **Response Body (Plain C Code):**
    ```cpp
    #ifndef MAIN_CERTIFICATES_H
    #define MAIN_CERTIFICATES_H

    static const char EMQX_MQTT_CA_CERT[] = R"EOF(
    -----BEGIN CERTIFICATE-----
    (Static EMQX CA Certificate Block)
    -----END CERTIFICATE-----
    )EOF";

    static const char LOCAL_WSS_CA_CERT[] = R"EOF(
    -----BEGIN CERTIFICATE-----
    (Generated CA Certificate for this Device ID)
    -----END CERTIFICATE-----
    )EOF";

    static const char LOCAL_WSS_SERVER_CERT[] = R"EOF(
    -----BEGIN CERTIFICATE-----
    (Generated Server Certificate for this Device ID)
    -----END CERTIFICATE-----
    )EOF";

    static const char LOCAL_WSS_PRIVATE_KEY[] = R"EOF(
    -----BEGIN PRIVATE KEY-----
    (Generated Private Key for this Device ID)
    -----END PRIVATE KEY-----
    )EOF";

    #endif // MAIN_CERTIFICATES_H
    ```

---

### ☁️ 3.3. Send Cloud Control Commands (`POST /api/device/:id/command`)
Called by the customer dashboard website to send commands to the device over the internet via the EMQX HTTP REST API.

*   **Endpoint:** `POST https://your-backend.render.com/api/device/iotyk-customer-1029/command`
*   **Request JSON Payload:**
    ```json
    {
      "action": "relay",
      "id": 0,
      "state": true
    }
    ```
*   **Backend logic:**
    1.  Authorizes the web user's session.
    2.  Forwards this payload to the EMQX Cloud API under the topic `device/iotyk-customer-1029/cmd` using the EMQX credentials:
        ```text
        POST https://your-emqx-endpoint.emqx.com/api/v5/publish
        Authorization: Basic <Base64_EMQX_Keys>
        Payload: {
          "topic": "device/iotyk-customer-1029/cmd",
          "payload": "{\"action\":\"relay\",\"id\":0,\"state\":true}",
          "qos": 1
        }
        ```
*   **Response JSON Payload:**
    ```json
    {
      "status": "success",
      "message": "Toggle command successfully published to MQTT"
    }
    ```

---

## 💻 4. Interactive Browser Dashboard Flow (Web APIs)

Your **Web Frontend Dashboard** uses modern browser features to talk directly to your physical ESP32 boards on the assembly line:

```mermaid
sequenceDiagram
    autonumber
    actor Tech as Factory Operator
    participant Browser as Web Browser (index.html/app.js)
    participant Render as Render Backend (server.js)
    participant Device as ESP32 Device (via USB)

    Tech->>Browser: Opens Dashboard page
    Tech->>Browser: Clicks "Connect ESP32 (Web Serial)"
    Browser->>Device: Opens Serial Port (115200 baud)
    Device-->>Browser: Outputs CHALLENGE_NONCE:A1B2C3D4...
    
    Browser->>Render: POST /api/device/unlock { challenge }
    Render-->>Browser: Returns computed { signature }
    
    Browser->>Device: Writes AUTH:<signature> over USB
    Device-->>Browser: Outputs AUTH_OK (Unlocked!)
    
    Browser->>Render: GET /api/device/:id/certs (Download)
    Render-->>Browser: Generates & returns "certificates.h"
    
    Note over Browser: Browser script saves certificates.h to the local folder
    Note over Browser: Technican runs build and flash!
```

---

## 🛡️ 5. Absolute Cloud Security Checklist
1.  **Environment Isolation:** Keep your backend variables (`EMQX_APP_API_KEY`, `EMQX_APP_API_SECRET`, and `FACTORY_LOCAL_TOKEN`) completely hidden in Render's **Environment Settings** dashboard. Never hardcode them in your Git repository.
2.  **HTTPS Enforcement:** Force HTTPS on all Render routes to prevent Man-in-the-Middle attacks when the Factory Dashboard downloads certificates.
3.  **WSS Verification:** The unique pairing token (`token`) generated by the database should be calculated cryptographically (e.g., using random bytes or UUIDv4) for absolute client authentication strength on Port 80.
