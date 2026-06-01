const supabase = require('../utils/db');
const crypto = require('crypto');

const FACTORY_API_KEY = process.env.FACTORY_API_KEY || 'factory_super_secret_auth_key_2026';

module.exports = async (req, res) => {
  // CORS Configuration
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Factory-Key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  // 1. Strict Factory Key Authorization check
  const factoryKey = req.headers['x-factory-key'];
  if (!factoryKey || factoryKey !== FACTORY_API_KEY) {
    return res.status(403).json({ error: 'Forbidden: Invalid or missing factory authorization key' });
  }

  const { deviceId, relayCount, localToken, namespace, customTopic, deviceRootSecret } = req.body;

  if (!deviceId || !relayCount || !localToken || !namespace) {
    return res.status(400).json({ error: 'Missing mandatory manufacturing fields: deviceId, relayCount, localToken, namespace' });
  }

  try {
    // 2. Prevent active hardware hijacking: Check if device exists and is claimed by an owner
    const { data: existingDevice } = await supabase
      .from('devices')
      .select('owner_id')
      .ilike('device_id', deviceId)
      .maybeSingle();

    if (existingDevice && existingDevice.owner_id) {
      return res.status(400).json({ error: 'Conflict: Device is already claimed by an active user. Release ownership before factory re-registration.' });
    }

    // 3. Pre-register or update the device (unclaimed) matching unique constraint device_id
    const { data: newDevice, error: devErr } = await supabase
      .from('devices')
      .upsert({
        device_id: deviceId,
        relay_count: parseInt(relayCount),
        local_token: localToken,
        namespace: namespace,
        custom_topic: customTopic || `iotyk@${deviceId}`,
        device_root_secret: deviceRootSecret || crypto.randomBytes(32).toString('hex'),
        owner_id: null // Explicitly unclaimed
      }, { onConflict: 'device_id' })
      .select()
      .single();

    if (devErr || !newDevice) {
      return res.status(400).json({ error: 'Factory hardware registration failed: ' + devErr.message });
    }

    // 3. Generate a secure, unique pairing token for the QR code sticker
    const pairingToken = "pr_" + crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48 Hours expiration window

    const { error: tokenErr } = await supabase
      .from('pairing_tokens')
      .insert({
        device_id: newDevice.id, // Resolved internal Database UUID!
        token: pairingToken,
        expires_at: expiresAt,
        used: false
      });

    if (tokenErr) {
      return res.status(400).json({ error: 'Pairing token generation failed: ' + tokenErr.message });
    }

    // 4. Return success and the pairing token for QR code printing
    return res.status(201).json({
      status: 'ok',
      message: 'Hardware pre-registered and pairing token active',
      deviceId: newDevice.device_id,
      pairingToken,
      expiresAt,
      printQrData: JSON.stringify({
        id: newDevice.device_id,
        token: pairingToken
      })
    });

  } catch (err) {
    console.error("Factory API error:", err);
    return res.status(500).json({ error: 'Internal Server Error: ' + err.message });
  }
};
