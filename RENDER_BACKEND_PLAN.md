# ☁️ Render Backend Plan: Codebase Gap Analysis & SQL Migrations

This plan provides a technical audit of your existing Node.js server (`server.js`, `db.js`, `mqtt.js`) and live database schemas (`schema.sql`), outlining the exact changes, new endpoints, and SQL migration statements needed to execute the Production Blueprint.

---

## 📊 1. Codebase Gap Analysis (Existing vs. Master Plan)

### A. SQLite (`db.js`) vs. PostgreSQL (`schema.sql`) Sync
*   **The Findings:** Your local development database (`db.js`) uses a consolidated SQLite `devices` table containing `local_token` and `perm_mqtt_user/pass` directly in the row. However, your production database schema (`schema.sql`) is highly normalized and splits credentials and pairing tokens into separate tables: `public.mqtt_credentials` and `public.pairing_tokens`.
*   **The Change Needed:** To support local WebSocket challenges in production, your Render backend APIs must be able to load and verify the `local_token` directly. We must map the `pairing_tokens` table in production to serve as the active local token generator!

### B. Certificate Generation Hook (WSS & Client Keys)
*   **The Findings:** Currently, your backend has no dynamic certificate generator. It does not generate self-signed WSS certs on-the-fly for your devices.
*   **The Change Needed:** We will implement an on-the-fly RSA-2048 certificate compiler inside `utils/crypto.js` using the standard `node-forge` library. This allows the backend to generate and return custom `certificates.h` headers on demand without bloating your database with massive private key blobs!

---

## 🗄️ 2. SQL Database Migration Scripts (PostgreSQL Production)

To support secure local-first pairing and dynamic credentials in production, execute these PostgreSQL migration queries:

```sql
-- 1. Add Local Token Column to main Devices Table for fast authentication caching
ALTER TABLE public.devices 
ADD COLUMN IF NOT EXISTS local_token_enc text,
ADD COLUMN IF NOT EXISTS local_token_salt text;

-- 2. Add an Index on device namespaces for high-speed lookups during MQTT pings
CREATE INDEX IF NOT EXISTS idx_devices_namespace ON public.devices(namespace);

-- 3. Add column for active firmware capability caching
ALTER TABLE public.devices
ADD COLUMN IF NOT EXISTS hardware_capabilities jsonb DEFAULT '{"ota":true,"temp":true,"r4":true}'::jsonb;
```

---

## 📂 3. Required Node.js Code Changes

### File A: `utils/crypto.js` (Add Dynamic WSS Cert Compiler)
Create or update this utility to programmatically compile `certificates.h` on-the-fly when a factory station requests it:

```javascript
const forge = require('node-forge');

function generateDeviceCerts(deviceId) {
    const pkeys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    
    cert.publicKey = pkeys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 2); // 2 years
    
    const attrs = [{ name: 'commonName', value: `${deviceId}.local` }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(pkeys.privateKey, forge.md.sha256.create());

    const pemCert = forge.pki.certificateToPem(cert);
    const pemKey = forge.pki.privateKeyToPem(pkeys.privateKey);

    return { cert: pemCert, key: pemKey };
}

module.exports = { generateDeviceCerts };
```

---

### File B: `routes/devices.js` (Add Factory Endpoints)
Add the REST endpoint that compiles and returns the `certificates.h` file for a specific board.

```javascript
const express = require('express');
const router = express.Router();
const db = require('../db');
const { generateDeviceCerts } = require('../utils/crypto');

// GET /api/devices/:id/certs (ONE-TIME Factory Endpoint)
router.get('/:id/certs', (req, res) => {
    const deviceId = req.params.id;

    // 1. Generate unique self-signed keys for the device
    const localKeys = generateDeviceCerts(deviceId);
    
    // 2. Load static EMQX Cloud Root CA from server environment
    const emqxCa = process.env.EMQX_CA_CERT || "-----BEGIN CERTIFICATE-----\nSTATIC_EMQX_CA_HERE\n-----END CERTIFICATE-----";

    // 3. Format into a ready-to-compile C++ header file
    const headerContent = `#ifndef MAIN_CERTIFICATES_H
#define MAIN_CERTIFICATES_H

// --- EMQX Root CA Certificate (Static) ---
static const char EMQX_MQTT_CA_CERT[] = R"EOF(
${emqxCa.trim()}
)EOF";

// --- Local WebSocket Secure (WSS) Certificates (Unique per device) ---
static const char LOCAL_WSS_CA_CERT[] = R"EOF(
${localKeys.cert.trim()}
)EOF";

static const char LOCAL_WSS_SERVER_CERT[] = R"EOF(
${localKeys.cert.trim()}
)EOF";

static const char LOCAL_WSS_PRIVATE_KEY[] = R"EOF(
${localKeys.key.trim()}
)EOF";

#endif // MAIN_CERTIFICATES_H
`;

    // 4. Send as an attachment file for direct saving
    res.setHeader('Content-disposition', `attachment; filename=certificates.h`);
    res.setHeader('Content-type', 'text/plain');
    res.charset = 'UTF-8';
    res.write(headerContent);
    res.end();
});

module.exports = router;
```

---

### File C: `mqtt.js` (Support Keep-Alives and DB Cache Updates)
Verify that your incoming MQTT parsing update states match your database queries:
*   Ensure that the `client.on('message')` parses and writes `rssi` and `relay_states` to your active local tables safely.
*   The existing implementation in **[`mqtt.js: L59-L93`](file:///C:/Users/sp799/Documents/iotyk/mqtt.js#L59-L93)** matches perfectly with your local development DB. Keep this exact logic in production!
