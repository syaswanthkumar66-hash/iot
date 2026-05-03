const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../auth');

/**
 * POST /auth/login
 * Authenticate user and return JWT token
 */
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Find user by email
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    if (!auth.checkPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Issue JWT token
    const token = auth.issueJWT(user.id);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * GET /auth/me
 * Get authenticated user profile and device list
 * Requires: Authorization: Bearer <JWT>
 */
router.get('/me', (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = auth.verifyJWT(token);
    const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(decoded.userId);

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Get user's devices
    const devices = db.prepare('SELECT id FROM devices WHERE user_id = ?').all(user.id);
    const deviceIds = devices.map(d => d.id);

    res.json({
      id: user.id,
      email: user.email,
      devices: deviceIds,
    });
  } catch (err) {
    console.error('Auth error:', err);
    res.status(401).json({ error: 'Invalid token' });
  }
});

/**
 * Middleware: Verify JWT token
 */
function verifyToken(req, res, next) {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = auth.verifyJWT(token);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { router, verifyToken };
