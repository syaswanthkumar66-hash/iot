const supabase = require('../utils/db');

module.exports = async (req, res) => {
  // 1. Handle CORS Preflight checks
  res.setHeader('Access-Control-Allow-Credentials', true);
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Missing email or password' });
  }

  try {
    // Authenticate user via Supabase Auth
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase(),
      password: password
    });

    if (error) {
      return res.status(401).json({ error: error.message });
    }

    // Return the signed JWT session token and user details
    return res.status(200).json({
      status: 'ok',
      token: data.session?.access_token || null,
      user: {
        id: data.user?.id,
        email: data.user?.email
      }
    });

  } catch (error) {
    console.error("Supabase Login error:", error);
    return res.status(500).json({ error: 'Internal Server Error: ' + error.message });
  }
};
