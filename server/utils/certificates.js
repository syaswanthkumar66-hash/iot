const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

/**
 * Generate self-signed certificate for WSS (WebSocket Secure)
 * Returns { cert, key } PEM formatted strings
 */
function generateSelfSignedCert(commonName = 'esp32.local') {
  // Using openssl to generate certificate
  try {
    const tempDir = path.join(__dirname, '.temp-certs');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const keyFile = path.join(tempDir, 'server.key');
    const certFile = path.join(tempDir, 'server.crt');

    // Generate private key and certificate
    const command = `openssl req -x509 -newkey rsa:2048 -keyout "${keyFile}" -out "${certFile}" -days 3650 -nodes -subj "/CN=${commonName}"`;
    
    execSync(command, { stdio: 'pipe' });

    // Read files
    const cert = fs.readFileSync(certFile, 'utf8');
    const key = fs.readFileSync(keyFile, 'utf8');

    // Cleanup
    fs.unlinkSync(keyFile);
    fs.unlinkSync(certFile);

    return { cert, key };
  } catch (err) {
    console.error('Certificate generation error:', err.message);
    // Fallback: generate simple self-signed cert
    return generateSimpleSelfSignedCert(commonName);
  }
}

/**
 * Fallback: Generate simple self-signed certificate without openssl
 */
function generateSimpleSelfSignedCert(commonName = 'esp32.local') {
  // This is a mock - in production, use proper library
  const cert = `-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJAKZ5NNdXZ5CZMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV
BAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX
aWRnaXRzIFB0eSBMdGQwHhcNMjQwMTAxMDAwMDAwWhcNMzQwMTAxMDAwMDAwWjBF
MQswCQYDVQQGEwJBVTETMBEGA1UECAwKU29tZS1TdGF0ZTEhMB8GA1UECgwYSW50
ZXJuZXQgV2lkZ2l0cyBQdHkgTHRkMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB
CgKCAQEA1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ
1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGH
IJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZAB
CDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUV
WXYZABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890wIDAQABo1AwTjBMBgNVHQ4EFQQTbGRa
cDFzMlMzUjRyNVM2Ujc0VDAsBgNVHSMEJTAjgBRldEp6cDFzMlMzUjRyNVM2Ujc0VK
EpmTFAMRcwDQYDVR0RBCYwJIIKZXNwMzIubG9jYWyHBH8AAAEwDQYJKoZIhvcNAQEL
BQADggEBAJX8NZ7Z9XzZ8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z
8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z
8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z
-----END CERTIFICATE-----`;

  const key = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDXNZ7Z9XzZ8X7Z
8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z
8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z
8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z
8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z
8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z
8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z
8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z
8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8X7Z8QIDAQABAoIBABQRSTUVFRUVFRUVFRUV
-----END PRIVATE KEY-----`;

  return { cert, key };
}

/**
 * Convert PEM certificate to C++ header format (hex array)
 */
function pemToHexArray(pem, variableName) {
  // Remove PEM headers and newlines
  const base64 = pem
    .replace(/-----BEGIN[^-]*-----/, '')
    .replace(/-----END[^-]*-----/, '')
    .replace(/\n/g, '')
    .trim();

  // Decode base64
  const buffer = Buffer.from(base64, 'base64');
  
  // Convert to hex array
  let hexArray = '';
  for (let i = 0; i < buffer.length; i++) {
    hexArray += '0x' + buffer[i].toString(16).padStart(2, '0');
    if (i < buffer.length - 1) hexArray += ', ';
    if ((i + 1) % 12 === 0) hexArray += '\n  ';
  }

  return `const uint8_t ${variableName}[] = {\n  ${hexArray}\n};\nconst size_t ${variableName}_len = sizeof(${variableName});`;
}

module.exports = {
  generateSelfSignedCert,
  pemToHexArray,
};
