import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../db/connection.js';
import { hashPassword, verifyPassword, encrypt, generateMqttPassword } from '../utils/crypto.js';
import { emqxAdmin } from '../services/emqxAdmin.js';
import { requireAuth } from '../middleware/auth.js';
import rateLimit from 'express-rate-limit';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  message: { error: 'Too many attempts, please try again later' }
});

/**
 * @api {post} /api/v1/auth/register
 * Creates a new user account.
 */
router.post('/register', authLimiter, async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: 'Invalid email or password (min 6 chars)' });
  }

  try {
    const emailNorm = email.toLowerCase().trim();
    const existing = await query('SELECT id FROM users WHERE email = $1', [emailNorm]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hashed = await hashPassword(password);
    const userRes = await query(`
      INSERT INTO users (email, password_hash, name)
      VALUES ($1, $2, $3)
      RETURNING id, email, name
    `, [emailNorm, hashed, name || 'User']);

    res.status(201).json({ 
      message: 'User registered successfully', 
      user: userRes.rows[0] 
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * @api {post} /api/v1/auth/login
 * User login with session and temporary MQTT credentials.
 */
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Missing credentials' });
  }

  try {
    const userRes = await query('SELECT id, email, password_hash FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = userRes.rows[0];
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT
    const jti = uuidv4();
    const token = jwt.sign(
      { id: user.id, email: user.email, jti },
      process.env.JWT_SECRET || 'dev-secret-key',
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    // Generate Temporary MQTT Credentials (1 hour expiry)
    const mqttUsername = `app_${user.id.substring(0,8)}_${Date.now().toString(36)}`;
    const mqttPassword = generateMqttPassword();
    const mqttExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await withTransaction(async (client) => {
      // 1. Save Session
      await client.query(`
        INSERT INTO sessions (user_id, jwt_jti, ip_address, user_agent, expires_at)
        VALUES ($1, $2, $3, $4, NOW() + INTERVAL '24 hours')
      `, [user.id, jti, req.ip, req.get('user-agent')]);

      // 2. Save MQTT Creds
      await client.query(`
        INSERT INTO mqtt_credentials (user_id, cred_type, mqtt_username, mqtt_password_enc, expires_at)
        VALUES ($1, 'user_temp', $2, $3, $4)
      `, [user.id, mqttUsername, encrypt(mqttPassword), mqttExpiresAt]);

      // 3. Create user in EMQX
      await emqxAdmin.createUser(mqttUsername, mqttPassword);
    });

    res.json({
      token,
      user: { id: user.id, email: user.email },
      mqtt: {
        url: process.env.EMQX_BROKER_URL,
        username: mqttUsername,
        password: mqttPassword,
        expiresAt: mqttExpiresAt
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', requireAuth, async (req, res) => {
  try {
    await withTransaction(async (client) => {
      await client.query('UPDATE sessions SET is_active = false WHERE jwt_jti = $1', [req.user.jti]);
      
      const credsRes = await client.query(`
        SELECT mqtt_username FROM mqtt_credentials 
        WHERE user_id = $1 AND cred_type = 'user_temp' AND is_active = true
      `, [req.user.id]);

      await client.query(`
        UPDATE mqtt_credentials SET is_active = false 
        WHERE user_id = $1 AND cred_type = 'user_temp'
      `, [req.user.id]);

      for (const row of credsRes.rows) {
        await emqxAdmin.deleteUser(row.mqtt_username).catch(e => console.error('EMQX cleanup failed', e));
      }
    });
    res.json({ message: 'Logged out' });
  } catch (err) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

router.get('/project-ca', async (req, res) => {
  try {
    const { generateCertificates } = await import('../utils/certificates.js');
    const certs = generateCertificates('root-ca-fetch');
    res.setHeader('Content-Type', 'text/plain');
    res.send(certs.caCert);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch project CA' });
  }
});

export default router;
