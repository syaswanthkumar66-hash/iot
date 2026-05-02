#!/usr/bin/env python3
"""
generate_certs.py - Generate local WSS certificates for ESP32 IoTYK project
Usage: python3 generate_certs.py --device-id <DEVICE_ID> --out-dir <OUTPUT_DIR>

Requirements:
- pip install cryptography
- Generates self-signed CA and server certificates for local WSS on ESP32
"""

import argparse
import datetime
import ipaddress
import os
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa


def generate_ca_cert():
    """Generate self-signed CA key and certificate (RSA 2048, valid 10 years)"""
    # Generate CA key
    ca_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )

    # CA subject
    ca_subject = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
        x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "California"),
        x509.NameAttribute(NameOID.LOCALITY_NAME, "San Francisco"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "IoTYK"),
        x509.NameAttribute(NameOID.COMMON_NAME, "IoTYK Local CA"),
    ])

    # CA certificate - valid 10 years
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    ca_cert = (
        x509.CertificateBuilder()
        .subject_name(ca_subject)
        .issuer_name(ca_subject)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=3650))  # 10 years
        .add_extension(
            x509.BasicConstraints(ca=True, path_length=None),
            critical=True,
        )
        .sign(ca_key, hashes.SHA256())
    )

    return ca_key, ca_cert


def generate_server_cert(ca_key, ca_cert, device_id):
    """Generate server key and certificate signed by CA (RSA 2048, valid 825 days)"""
    # Generate server key
    server_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )

    # Server subject
    server_subject = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
        x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "California"),
        x509.NameAttribute(NameOID.LOCALITY_NAME, "San Francisco"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "IoTYK"),
        x509.NameAttribute(NameOID.COMMON_NAME, f"{device_id}.local"),
    ])

    # SANs - iOS hard limit is 825 days
    san = x509.SubjectAlternativeName([
        x509.DNSName(f"{device_id}.local"),
        x509.DNSName("localhost"),
        x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
    ])

    # Server certificate - valid 825 days (iOS hard limit)
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    server_cert = (
        x509.CertificateBuilder()
        .subject_name(server_subject)
        .issuer_name(ca_cert.subject)
        .public_key(server_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=825))  # iOS hard limit
        .add_extension(san, critical=False)
        .sign(ca_key, hashes.SHA256())
    )

    return server_key, server_cert


def save_cert_file(path, data, is_private_key=False):
    """Save certificate or key to file and return PEM data"""
    if is_private_key:
        pem = data.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption()
        )
    else:
        pem = data.public_bytes(serialization.Encoding.PEM)

    with open(path, "wb") as f:
        f.write(pem)
    print("Saved: {}".format(path))
    return pem


def generate_paste_note(ca_cert_pem, server_cert_pem, server_key_pem, out_dir):
    """Generate the paste note text with exact format specified"""
    note = []
    note.append("=" * 60)
    note.append("STEP 1 \u2014 the full C string blocks ready to paste into certificates.h:")
    note.append("=" * 60)
    note.append("")

    # CA cert block
    note.append('static const char LOCAL_WSS_CA_CERT[] PROGMEM = R"EOF(')
    for line in ca_cert_pem.decode().strip().split('\n'):
        note.append(line)
    note.append(')EOF";')
    note.append("")

    # Server cert block
    note.append('static const char LOCAL_WSS_SERVER_CERT[] PROGMEM = R"EOF(')
    for line in server_cert_pem.decode().strip().split('\n'):
        note.append(line)
    note.append(')EOF";')
    note.append("")

    # Server key block
    note.append('static const char LOCAL_WSS_PRIVATE_KEY[] PROGMEM = R"EOF(')
    for line in server_key_pem.decode().strip().split('\n'):
        note.append(line)
    note.append(')EOF";')
    note.append("")

    note.append("=" * 60)
    note.append("STEP 2 \u2014 one line: #define LOCAL_WSS_ENABLED true  (goes in config.h)")
    note.append("=" * 60)
    note.append("")

    note.append("=" * 60)
    note.append("STEP 3 \u2014 how to trust the CA on the phone:")
    note.append("=" * 60)
    note.append("Android: adb push {}/ca.crt /sdcard/iotyk_ca.crt".format(out_dir))
    note.append("         Settings \u2192 Security \u2192 Install certificate \u2192 CA certificate")
    note.append("iOS:     AirDrop or email ca.crt \u2192 tap install")
    note.append("         Settings \u2192 General \u2192 About \u2192 Certificate Trust Settings \u2192 Enable")
    note.append("")

    note.append("=" * 60)
    note.append("STEP 4 \u2014 exact instructions for pasting the EMQX CA certificate:")
    note.append("=" * 60)
    note.append("1. Log into EMQX Cloud console")
    note.append("2. Go to: Deployment \u2192 Overview \u2192 Connection guide")
    note.append("3. Download the CA certificate (emqxsl-ca.crt)")
    note.append("4. Open in text editor, copy everything from -----BEGIN to END-----")
    note.append("5. Paste into EMQX_MQTT_CA_CERT in certificates.h replacing the")
    note.append("   PASTE_EMQX_CA_CERTIFICATE_HERE placeholder")
    note.append("Rules:")
    note.append("  - Keep -----BEGIN CERTIFICATE----- and -----END CERTIFICATE-----")
    note.append("  - No leading spaces on cert lines")
    note.append("  - No extra blank lines inside the cert block")
    note.append("  - The )EOF\"; closing must stay on its own line")
    note.append("")

    return '\n'.join(note)


def main():
    parser = argparse.ArgumentParser(description="Generate local WSS certificates for IoTYK ESP32")
    parser.add_argument("--device-id", required=True, help="Device ID (e.g., ESP32-6GTEZ6)")
    parser.add_argument("--out-dir", required=True, help="Output directory for certificates")
    args = parser.parse_args()

    # Create output directory if it doesn't exist
    os.makedirs(args.out_dir, exist_ok=True)

    print("Generating certificates for device: {}".format(args.device_id))
    print("Output directory: {}".format(args.out_dir))
    print("-" * 50)

    # Generate CA
    print("Generating CA certificate (RSA 2048, valid 10 years)...")
    ca_key, ca_cert = generate_ca_cert()

    # Generate server cert
    print("Generating server certificate (RSA 2048, valid 825 days)...")
    server_key, server_cert = generate_server_cert(ca_key, ca_cert, args.device_id)

    # Save files and get PEM data
    print("Saving certificate files...")

    ca_key_path = os.path.join(args.out_dir, "ca.key")
    ca_cert_path = os.path.join(args.out_dir, "ca.crt")
    server_key_path = os.path.join(args.out_dir, "server.key")
    server_cert_path = os.path.join(args.out_dir, "server.crt")

    # Save and get PEM data
    ca_key_pem = save_cert_file(ca_key_path, ca_key, is_private_key=True)
    ca_cert_pem = save_cert_file(ca_cert_path, ca_cert)
    server_key_pem = save_cert_file(server_key_path, server_key, is_private_key=True)
    server_cert_pem = save_cert_file(server_cert_path, server_cert)

    # Generate note
    note = generate_paste_note(ca_cert_pem, server_cert_pem, server_key_pem, args.out_dir)

    # Save note to file (use utf-8 encoding)
    note_path = os.path.join(args.out_dir, "certificates_paste_note.txt")
    with open(note_path, "w", encoding="utf-8") as f:
        f.write(note)
    print("Saved note to: {}".format(note_path))

    # Print note to stdout (handle encoding issues)
    print("\n" + "=" * 60)
    print("PASTE NOTE (also saved to certificates_paste_note.txt)")
    print("=" * 60)
    try:
        print(note)
    except UnicodeEncodeError:
        # Fallback: print with ascii replacement
        print(note.encode('ascii', 'replace').decode('ascii'))

    print("\nCertificate generation complete!")


if __name__ == "__main__":
    main()
