const crypto = require('crypto');
const supabase = require('../utils/db');

module.exports = async (req, res) => {
  // 1. CORS Configuration
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Factory-Key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  const { deviceId, validationKey } = req.body;

  if (!deviceId || !validationKey) {
    return res.status(400).json({ error: 'Missing mandatory fields: deviceId, validationKey' });
  }

  try {
    // 2. Fetch the target device's registered hardware Root Secret
    const { data: device, error: devErr } = await supabase
      .from('devices')
      .select('device_root_secret')
      .ilike('device_id', deviceId)
      .maybeSingle();

    if (devErr || !device) {
      return res.status(404).json({ error: 'Device not found in factory registry' });
    }

    const rootSecret = device.device_root_secret || 'hardware_root_secret_pre_flashed_in_factory';

    // 3. Recalculate timing-safe HMAC-SHA256 to verify physical presence validation key
    const payload = `${deviceId.toLowerCase()}_RESET_CONFIRMED`;
    const expectedKey = crypto
      .createHmac('sha256', rootSecret)
      .update(payload)
      .digest('hex');

    // timingSafeEqual expects buffers of the same length
    const inputBuffer = Buffer.from(validationKey);
    const expectedBuffer = Buffer.from(expectedKey);

    if (inputBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(inputBuffer, expectedBuffer)) {
      return res.status(403).json({ error: 'Forbidden: Invalid validation key. Physical USB serial connection required.' });
    }

    // 4. Perform the Transition to Factory Mode (set owner_id = NULL)
    const { error: updateErr } = await supabase
      .from('devices')
      .update({ owner_id: null })
      .ilike('device_id', deviceId);

    if (updateErr) {
      return res.status(400).json({ error: 'Database update failed: ' + updateErr.message });
    }

    return res.status(200).json({
      status: 'ok',
      message: 'Device successfully reverted to Factory Mode (owner dissociated).'
    });

  } catch (err) {
    console.error("Factory Revert API error:", err);
    return res.status(500).json({ error: 'Internal Server Error: ' + err.message });
  }
};
