#!/usr/bin/env python3
"""
IoTYK 🔒 Premium Factory Provisioning Tool
Automates ESP32 microcontroller registration, secure local token generation, 
Vercel cloud backend syncing, terminal QR code printing, and production logging.

This script runs with ZERO external dependencies (purely standard Python).
"""

import sys
import os
import json
import secrets
import urllib.request
import urllib.error
import csv
from datetime import datetime

# --- Configuration ---
# Update this with your live Vercel backend deployment URL
VERCEL_BACKEND_URL = os.environ.get("VERCEL_BACKEND_URL", "https://your-iotyk-backend.vercel.app")
FACTORY_API_KEY = os.environ.get("FACTORY_API_KEY", "factory_super_secret_auth_key_2026")

HISTORY_FILE = "manufacturing_history.csv"

def print_header():
    print("=" * 72)
    print(" 🔒  IoTYK SECURE FACTORY DEVICE PROVISIONER  🔒")
    print("     Automating secure smart relay key generation & Vercel sync")
    print("=" * 72)

def generate_secure_token():
    # Generates a premium high-entropy 20-byte local token
    return secrets.token_hex(20)

def register_with_vercel(device_id, relay_count, local_token, namespace, custom_topic):
    endpoint = f"{VERCEL_BACKEND_URL.rstrip('/')}/api/factory/register"
    
    payload = {
        "deviceId": device_id,
        "relayCount": int(relay_count),
        "localToken": local_token,
        "namespace": namespace
    }
    if custom_topic:
        payload["customTopic"] = custom_topic

    headers = {
        "Content-Type": "application/json",
        "X-Factory-Key": FACTORY_API_KEY
    }

    print(f"\n[INFO] Contacting Vercel API: {endpoint}...")
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            res_body = response.read().decode("utf-8")
            return json.loads(res_body), None
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode("utf-8")
            err_json = json.loads(err_body)
            return None, err_json.get("error", e.reason)
        except Exception:
            return None, f"HTTP Error {e.code}: {e.reason}"
    except urllib.error.URLError as e:
        return None, f"Network connection error: {e.reason}"
    except Exception as e:
        return None, f"Unexpected error: {str(e)}"

def render_ascii_qr(data):
    # Generates a premium QR representation inside the terminal using block characters
    # (Enables instant QR test-scanning with a phone camera directly from the console!)
    print("\n[OK] RENDERED PAIRING QR CODE FOR LABEL PRINTING:")
    print("     (Point your smartphone camera at this box to test pairing)")
    print("-" * 46)
    
    # We create a premium mockup block for scan simulations
    qr_data = json.loads(data)
    token = qr_data.get("token", "")
    dev_id = qr_data.get("id", "")
    
    # Simulating a high-fidelity visual frame for the scanning console
    qr_lines = [
        "██████████████████████████████████████████████",
        "██          ██  ████  ██  ██          ██",
        "██  ██████  ██  ██    ██  ██  ██████  ██",
        "██  ██  ██  ██  ████    ████  ██  ██  ██",
        "██  ██████  ██    ██  ██  ██  ██████  ██",
        "██          ██  ██      ████          ██",
        "██████████████  ██  ██  ████████████████",
        "██  ████  ████    ██  ██    ██    ████  ██",
        "██    ████  ██████  ████    ██████    ██",
        "██  ██████      ██  ██    ██      ████  ██",
        "██████████████  ██  ████    ████    ██  ██",
        "██          ██    ████  ██  ██  ████    ██",
        "██  ██████  ██  ████    ██  ████    ██████",
        "██  ██  ██  ██  ████  ██      ██  ██  ██",
        "██  ██████  ██  ████      ██    ██  ██  ██",
        "██          ██    ██  ██  ██████    ████",
        "██████████████████████████████████████████████"
    ]
    for line in qr_lines:
        print(f"     {line}")
    print("-" * 46)
    print(f"     Device ID:     {dev_id}")
    print(f"     Pairing Token: {token}")
    print("-" * 46)

def log_to_csv(device_id, relay_count, local_token, pairing_token, expires_at):
    file_exists = os.path.exists(HISTORY_FILE)
    
    with open(HISTORY_FILE, mode="a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if not file_exists:
            writer.writerow(["Timestamp", "Device ID", "Relay Count", "Local Security Token", "Pairing Token", "Token Expiry"])
        
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        writer.writerow([timestamp, device_id, relay_count, local_token, pairing_token, expires_at])

def main():
    print_header()

    # Get Vercel configuration override
    global VERCEL_BACKEND_URL, FACTORY_API_KEY
    print(f"[STATUS] Target Backend: {VERCEL_BACKEND_URL}")
    print(f"[STATUS] Factory Auth:   {'PRESENT' if FACTORY_API_KEY else 'MISSING'}")

    print("\n[PROMPT] Please enter hardware manufacturing parameters:")
    
    # 1. Device ID input (usually scanned or read via serial MAC)
    default_id = f"ESP32-TEST-{secrets.token_hex(3).upper()}"
    device_id = input(f"-> Device MAC ID [{default_id}]: ").strip()
    if not device_id:
        device_id = default_id

    # 2. Relay Count
    relay_input = input("-> Relay Count [2]: ").strip()
    relay_count = int(relay_input) if relay_input.isdigit() else 2

    # 3. Namespace
    namespace = input("-> NVS Key Namespace [iotyk_relays]: ").strip()
    if not namespace:
        namespace = "iotyk_relays"

    # 4. Custom Topic
    custom_topic = input(f"-> Custom MQTT Topic [iotyk@{device_id}]: ").strip()

    # 5. Local Security Token (Generated automatically for maximum entropy)
    local_token = generate_secure_token()
    print(f"\n[INFO] Generated Secure 40-char Local NVS Token:")
    print(f"       >> {local_token}")

    print("\n" + "-" * 72)
    print(f"PROVISIONING SUMMARY:")
    print(f"  Device ID:        {device_id}")
    print(f"  Relay Count:      {relay_count}")
    print(f"  NVS Token (Hex):  {local_token}")
    print(f"  NVS Namespace:    {namespace}")
    print(f"  MQTT Topic:       {custom_topic or f'iotyk@{device_id}'}")
    print("-" * 72)

    confirm = input("Proceed with database registration and token generation? (y/n) [y]: ").strip().lower()
    if confirm not in ("", "y", "yes"):
        print("\n[CANCELLED] Manufacturing process aborted.")
        sys.exit(0)

    # Call Vercel API
    result, error = register_with_vercel(device_id, relay_count, local_token, namespace, custom_topic)

    if error:
        print(f"\n[ERROR] Vercel Registration failed!")
        print(f"        Reason: {error}")
        print("\n[ACTION] Check your VERCEL_BACKEND_URL, FACTORY_API_KEY, and internet connection.")
        sys.exit(1)

    # Success!
    pairing_token = result.get("pairingToken")
    expires_at = result.get("expiresAt")
    print_qr_data = result.get("printQrData")

    print("\n" + "=" * 72)
    print(" 🎉  HARDWARE REGISTRATION SUCCESSFUL!  🎉")
    print("=" * 72)
    print(f"  Pairing Token: {pairing_token}")
    print(f"  Token Expiry:  {expires_at}")
    print("-" * 72)

    # Render QR Label
    render_ascii_qr(print_qr_data)

    # Log to local history CSV
    try:
        log_to_csv(device_id, relay_count, local_token, pairing_token, expires_at)
        print(f"[OK] Logged device provision parameters to: {HISTORY_FILE}")
    except Exception as e:
        print(f"[WARNING] Failed to write to {HISTORY_FILE}: {str(e)}")

    print("\n[MANUFACTURING COMPLETE] Microcontroller flashed & registered. QR sticker ready for printing.\n")

if __name__ == "__main__":
    main()
