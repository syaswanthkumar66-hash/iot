const supabase = require('../utils/db');
const crypto = require('crypto');

// Symmetric Encryption Key used to decrypt passwords stored in DB (or mock decrypted payload)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'server_symmetric_aes_key_base_2026';

function decryptPassword(encryptedText) {
  try {
    // Standard Node.js Decipher logic matching your encryption structure
    // If plaintext was stored directly during dev, return it
    if (!encryptedText.includes(':')) return encryptedText;
    
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts.shift(), 'hex');
    const encryptedTextBuffer = Buffer.from(parts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32).substring(0, 32)), iv);
    let decrypted = decipher.update(encryptedTextBuffer);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (err) {
    console.error("Decryption failed, returning input:", err.message);
    return encryptedText; // Fallback
  }
}

module.exports = async (req, res) => {
  // CORS Configuration
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Device-Signature');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { deviceId, timestamp } = req.body;
  const incomingSignature = req.headers['x-device-signature'];

  if (!deviceId || !timestamp || !incomingSignature) {
    return res.status(400).json({ error: 'Missing mandatory parameters: deviceId, timestamp, or X-Device-Signature header' });
  }

  // 1. Prevent Replay Attacks: Enforce 5-minute maximum timestamp drift window
  const currentEpoch = Math.floor(Date.now() / 1000);
  const timeDrift = Math.abs(currentEpoch - parseInt(timestamp));
  if (timeDrift > 300) {
    return res.status(401).json({ error: 'Unauthorized: Timestamp drift exceeds 5 minutes. Replay blocked.' });
  }

  try {
    // 2. Resolve the text device_id to fetch database UUID and local security token
    const { data: device, error: devErr } = await supabase
      .from('devices')
      .select('*')
      .ilike('device_id', deviceId)
      .single();

    if (devErr || !device) {
      return res.status(404).json({ error: 'Device not pre-registered' });
    }

    if (!device.local_token) {
      return res.status(400).json({ error: 'Sync failed: Device has no credentials to sync' });
    }

    // 3. Cryptographically verify the signature
    // Expected = HMAC-SHA256(key = local_token, data = deviceId + timestamp)
    const hmac = crypto.createHmac('sha256', device.local_token);
    hmac.update(deviceId + timestamp.toString());
    const expectedSignature = hmac.digest('hex');

    if (incomingSignature.toLowerCase() !== expectedSignature.toLowerCase()) {
      return res.status(401).json({ error: 'Unauthorized: Cryptographic signature mismatch' });
    }

    // 4. Retrieve the active, unexpired MQTT credentials for this device UUID
    const { data: credentials, error: credErr } = await supabase
      .from('mqtt_credentials')
      .select('*')
      .eq('device_id', device.id) // Resolved Database UUID!
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    let finalUsername = "";
    let finalPassword = "";

    if (credErr || !credentials || credentials.length === 0) {
      // Generate a new temporary credential pair automatically if none is active
      // (This guarantees the device re-syncs successfully even after major downtimes!)
      finalUsername = "rot_user_" + crypto.randomBytes(8).toString('hex');
      const plainPass = crypto.randomBytes(16).toString('hex');
      
      // Encrypt for database safety
      const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32).substring(0, 32)), Buffer.alloc(16));
      let encryptedPass = cipher.update(plainPass);
      encryptedPass = Buffer.concat([encryptedPass, cipher.final()]);
      const encText = Buffer.alloc(16).toString('hex') + ":" + encryptedPass.toString('hex');

      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2-hour credential expiry

      await supabase
        .from('mqtt_credentials')
        .insert({
          device_id: device.id,
          cred_type: 'temporary',
          mqtt_username: finalUsername,
          mqtt_password_enc: encText,
          expires_at: expiresAt,
          is_active: true
        });

      finalPassword = plainPass; // Return plain to device!
    } else {
      finalUsername = credentials[0].mqtt_username;
      finalPassword = decryptPassword(credentials[0].mqtt_password_enc);
    }

    // 5. Securely return plain configuration data
    return res.status(200).json({
      status: 'ok',
      username: finalUsername,
      password: finalPassword,
      topic: device.custom_topic || `iotyk@${device.device_id}`
    });

  } catch (err) {
    console.error("Renew API error:", err);
    return res.status(500).json({ error: 'Internal Server Error: ' + err.message });
  }
};
