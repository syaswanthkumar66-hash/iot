const crypto = require('crypto');

// 1. Configuration (matches what the ESP32 hardware knows)
const VERCEL_URL = "https://iot-delta-wine.vercel.app/api/device/renew";
const DEVICE_ID = "ESP32-TEST-E0C656"; // The device from your UI
const LOCAL_TOKEN = "test_tok_5b08259c97eb798d9664"; // The token from your UI

async function simulateEmqxSync() {
  console.log(`\n=== 🚀 SIMULATING ESP32 EMQX SYNC ===`);
  console.log(`Device: ${DEVICE_ID}`);
  
  // 2. The ESP32 generates a timestamp (Unix epoch seconds)
  const timestamp = Math.floor(Date.now() / 1000);
  
  // 3. The ESP32 creates an HMAC-SHA256 signature using its local token
  const dataToSign = DEVICE_ID + timestamp.toString();
  const hmac = crypto.createHmac('sha256', LOCAL_TOKEN);
  hmac.update(dataToSign);
  const signature = hmac.digest('hex');
  
  console.log(`Generated Timestamp: ${timestamp}`);
  console.log(`Generated Signature: ${signature}`);
  console.log(`\nSending POST request to ${VERCEL_URL}...`);

  // 4. The ESP32 sends the payload to the Vercel Backend
  try {
    const response = await fetch(VERCEL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Signature": signature
      },
      body: JSON.stringify({
        deviceId: DEVICE_ID,
        timestamp: timestamp
      })
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log(`\n✅ SYNC SUCCESS! Received EMQX Credentials:`);
      console.log(JSON.stringify(data, null, 2));
      console.log(`\nThe device can now connect to EMQX using mqtt_username: ${data.mqtt_username}`);
    } else {
      console.log(`\n❌ SYNC FAILED! (Status ${response.status})`);
      console.log(`Error Message: ${data.error}`);
      console.log(`\nNOTE: If you get "No entrypoint found" or the old error message, it means Vercel hasn't deployed the fix yet!`);
    }

  } catch (err) {
    console.error(`\n❌ NETWORK ERROR:`, err.message);
  }
}

simulateEmqxSync();
