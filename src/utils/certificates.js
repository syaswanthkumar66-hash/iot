import forge from 'node-forge';

/**
 * Generates a Local CA and a signed Device Certificate for mDNS (device_id.local).
 */
export function generateCertificates(deviceId) {
  const pki = forge.pki;
  
  // 1. Generate Local Root CA (for App-to-Device Trust)
  const caKeys = pki.rsa.generateKeyPair(2048);
  const caCert = pki.createCertificate();
  caCert.publicKey = caKeys.publicKey;
  caCert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(8));
  caCert.validity.notBefore = new Date();
  caCert.validity.notAfter = new Date();
  caCert.validity.notAfter.setFullYear(caCert.validity.notBefore.getFullYear() + 10);
  
  const caAttrs = [
    { name: 'commonName', value: 'IoTYK Local Root CA' },
    { name: 'organizationName', value: 'IoTYK' }
  ];
  caCert.setSubject(caAttrs);
  caCert.setIssuer(caAttrs);
  caCert.setExtensions([{ name: 'basicConstraints', cA: true }]);
  caCert.sign(caKeys.privateKey, forge.md.sha256.create());
  
  // 2. Generate Device Certificate signed by Local Root CA
  const serverKeys = pki.rsa.generateKeyPair(2048);
  const serverCert = pki.createCertificate();
  serverCert.publicKey = serverKeys.publicKey;
  serverCert.serialNumber = '02' + forge.util.bytesToHex(forge.random.getBytesSync(8));
  serverCert.validity.notBefore = new Date();
  serverCert.validity.notAfter = new Date();
  serverCert.validity.notAfter.setFullYear(serverCert.validity.notBefore.getFullYear() + 2);
  
  const serverAttrs = [
    { name: 'commonName', value: `${deviceId}.local` },
    { name: 'organizationName', value: 'IoTYK' }
  ];
  serverCert.setSubject(serverAttrs);
  serverCert.setIssuer(caAttrs);
  serverCert.setExtensions([
    { name: 'basicConstraints', cA: false },
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: `${deviceId}.local` },
        { type: 2, value: 'localhost' },
        { type: 7, ip: '192.168.4.1' } // ESP32 AP Mode IP
      ]
    }
  ]);
  serverCert.sign(caKeys.privateKey, forge.md.sha256.create());
  
  return {
    caCert: pki.certificateToPem(caCert),
    serverCert: pki.certificateToPem(serverCert),
    serverKey: pki.privateKeyToPem(serverKeys.privateKey)
  };
}

export function formatCertificatesHeader(certs, mqttCaCert = '') {
  // Use provided cert, or environment variable, or fallback to empty
  const emqxCa = (mqttCaCert && mqttCaCert.length > 64) ? mqttCaCert : (process.env.MQTT_CA_CERT || '');

  return `#ifndef IOTYK_CERTIFICATES_H
#define IOTYK_CERTIFICATES_H

#include <string.h>

// --- Cloud MQTT CA (EMQX) ---
static const char EMQX_MQTT_CA_CERT[] PROGMEM = R"EOF(
${emqxCa.trim()}
)EOF";

// --- Local WSS Certificates (for mDNS trust) ---
static const char LOCAL_WSS_CA_CERT[] PROGMEM = R"EOF(
${certs.caCert.trim()}
)EOF";

static const char LOCAL_WSS_SERVER_CERT[] PROGMEM = R"EOF(
${certs.serverCert.trim()}
)EOF";

static const char LOCAL_WSS_PRIVATE_KEY[] PROGMEM = R"EOF(
${certs.serverKey.trim()}
)EOF";

/**
 * Helper to check if a certificate is present and valid-looking
 */
inline bool hasUsableCa(const char* ca) {
    return (ca != nullptr && strlen(ca) > 64 && strstr(ca, "-----BEGIN CERTIFICATE-----") != nullptr);
}

#endif
`;
}
