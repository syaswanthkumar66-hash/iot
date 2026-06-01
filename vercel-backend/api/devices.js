const supabase = require('../utils/db');

module.exports = async (req, res) => {
  // CORS Configuration
  res.setHeader('Access-Control-Allow-Credentials', true);
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,DELETE');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. Authenticate user JWT from headers
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing JWT access token' });
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized: Invalid access token' });
  }

  const userId = user.id; // Correct database UUID for the authenticated user

  try {
    if (req.method === 'GET') {
      // Fetch devices owned by this user (querying owner_id mapping to public.users.id)
      const { data, error } = await supabase
        .from('devices')
        .select('*')
        .eq('owner_id', userId);

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      // Format response keys for the frontend
      const formatted = data.map(d => ({
        id: d.device_id, // Return physical MAC device_id (e.g. ESP32-TEST-E0C656) to client
        name: d.name || d.device_id,
        ip: d.ip || "0.0.0.0",
        port: d.port || 5555,
        protocol: d.protocol || "UDP",
        relayCount: d.relay_count || 1,
        localToken: d.local_token || d.token,
        token: d.local_token || d.token // Map both token keys for full client cross-compatibility
      }));

      return res.status(200).json(formatted);
    } 
    
    else if (req.method === 'POST') {
      // SECURE CLAIM FLOW: Users cannot insert directly to public.devices.
      // They claim pre-registered factory hardware using a single-use pairing token!
      const { pairingToken, customName } = req.body;

      if (!pairingToken) {
        return res.status(400).json({ error: 'Missing required parameter: pairingToken' });
      }

      // 1. Verify and fetch the pairing token (resolving device relationship)
      const { data: tokenRecord, error: tokenErr } = await supabase
        .from('pairing_tokens')
        .select('*')
        .eq('token', pairingToken)
        .eq('used', false)
        .single();

      if (tokenErr || !tokenRecord) {
        return res.status(400).json({ error: 'Invalid, already used, or non-existent pairing token' });
      }

      // Check if token has expired
      if (new Date(tokenRecord.expires_at) < new Date()) {
        return res.status(400).json({ error: 'Pairing token has expired' });
      }

      const deviceUuid = tokenRecord.device_id; // Resolved UUID from related devices table

      // 2. Fetch the target device to verify ownership state
      const { data: device, error: devErr } = await supabase
        .from('devices')
        .select('*')
        .eq('id', deviceUuid)
        .single();

      if (devErr || !device) {
        return res.status(404).json({ error: 'Associated device not found' });
      }

      const resolvedToken = device.local_token || device.token;
      if (!resolvedToken) {
        return res.status(400).json({ error: 'Sync failed: Device has no credentials to sync' });
      }

      if (device.owner_id) {
        return res.status(400).json({ error: 'Device is already claimed by another user' });
      }

      // 3. Complete the claim (assign owner_id) and mark token as used
      const { error: claimErr } = await supabase
        .from('devices')
        .update({
          owner_id: userId,
          name: customName || device.name || `Relay Node (${device.device_id.substring(6)})`
        })
        .eq('id', deviceUuid);

      if (claimErr) {
        return res.status(400).json({ error: 'Ownership assignment failed: ' + claimErr.message });
      }

      const { error: updateTokenErr } = await supabase
        .from('pairing_tokens')
        .update({ used: true })
        .eq('id', tokenRecord.id);

      if (updateTokenErr) {
        console.error("Token mark used failed:", updateTokenErr);
      }

      return res.status(200).json({
        status: 'ok',
        device: {
          id: device.device_id,
          name: customName || device.name,
          ip: device.ip,
          port: device.port,
          protocol: device.protocol,
          relayCount: device.relay_count,
          localToken: device.local_token || device.token,
          token: device.local_token || device.token // Map both token keys for full client cross-compatibility
        }
      });
    } 
    
    else if (req.method === 'DELETE') {
      const { deviceId } = req.query; // Physical MAC device_id (text)

      if (!deviceId) {
        return res.status(400).json({ error: 'Missing deviceId query parameter' });
      }

      // 1. Resolve text deviceId to database UUID to confirm ownership match
      const { data: device, error: devErr } = await supabase
        .from('devices')
        .select('id')
        .ilike('device_id', deviceId)
        .eq('owner_id', userId)
        .single();

      if (devErr || !device) {
        return res.status(404).json({ error: 'Device not found or not owned by your account' });
      }

      // 2. Dissociate ownership (un-claim) instead of fully deleting factory device hardware logs
      const { error: releaseErr } = await supabase
        .from('devices')
        .update({ owner_id: null })
        .eq('id', device.id);

      if (releaseErr) {
        return res.status(400).json({ error: 'Failed to release device: ' + releaseErr.message });
      }

      return res.status(200).json({ status: 'ok' });
    } 
    
    else {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

  } catch (err) {
    console.error("Devices secure API error:", err);
    return res.status(500).json({ error: 'Internal Server Error: ' + err.message });
  }
};
