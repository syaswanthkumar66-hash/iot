import forge from 'node-forge';

export function generateCertificates(deviceId) {
  // Generate CA
  const caKeys = forge.pki.rsa.generateKeyPair(2048);
  const caCert = forge.pki.createCertificate();
  caCert.publicKey = caKeys.publicKey;
  caCert.serialNumber = '01';
  caCert.validity.notBefore = new Date();
  caCert.validity.notAfter = new Date();
  caCert.validity.notAfter.setFullYear(caCert.validity.notBefore.getFullYear() + 10);
  
  const caAttrs = [
    { name: 'commonName', value: 'IoTYK Local CA' },
    { name: 'countryName', value: 'US' },
    { name: 'organizationName', value: 'IoTYK' }
  ];
  caCert.setSubject(caAttrs);
  caCert.setIssuer(caAttrs);
  caCert.setExtensions([{ name: 'basicConstraints', cA: true }]);
  caCert.sign(caKeys.privateKey, forge.md.sha256.create());
  
  // Generate Server
  const serverKeys = forge.pki.rsa.generateKeyPair(2048);
  const serverCert = forge.pki.createCertificate();
  serverCert.publicKey = serverKeys.publicKey;
  serverCert.serialNumber = '02';
  serverCert.validity.notBefore = new Date();
  serverCert.validity.notAfter = new Date();
  serverCert.validity.notAfter.setDate(serverCert.validity.notBefore.getDate() + 825);
  
  const serverAttrs = [
    { name: 'commonName', value: `${deviceId}.local` },
    { name: 'countryName', value: 'US' },
    { name: 'organizationName', value: 'IoTYK' }
  ];
  serverCert.setSubject(serverAttrs);
  serverCert.setIssuer(caAttrs);
  serverCert.setExtensions([
    { name: 'basicConstraints', cA: false },
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: `${deviceId}.local` }, // DNS
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' } // IP
      ]
    }
  ]);
  serverCert.sign(caKeys.privateKey, forge.md.sha256.create());
  
  return {
    caKey: forge.pki.privateKeyToPem(caKeys.privateKey),
    caCert: forge.pki.certificateToPem(caCert),
    serverKey: forge.pki.privateKeyToPem(serverKeys.privateKey),
    serverCert: forge.pki.certificateToPem(serverCert)
  };
}

export function formatCertificatesHeader(certs, emqxCaCert = null) {
  let header = `#ifndef IOTYK_CERTIFICATES_H
#define IOTYK_CERTIFICATES_H

#include <string.h>

`;

  if (emqxCaCert) {
    header += `static const char EMQX_MQTT_CA_CERT[] PROGMEM = R"EOF(
${emqxCaCert.trim()}
)EOF";\n\n`;
  }

  header += `static const char LOCAL_WSS_CA_CERT[] PROGMEM = R"EOF(
${certs.caCert.trim()}
)EOF";

static const char LOCAL_WSS_SERVER_CERT[] PROGMEM = R"EOF(
${certs.serverCert.trim()}
)EOF";

static const char LOCAL_WSS_PRIVATE_KEY[] PROGMEM = R"EOF(
${certs.serverKey.trim()}
)EOF";

#endif
`;
  return header;
}
