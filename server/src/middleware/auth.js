import jwt from 'jsonwebtoken';
import { query } from '../db/connection.js';

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify JWT
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired', code: 'token_expired' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Check if session is still active in DB
    const sessionRes = await query(
      'SELECT is_active FROM sessions WHERE jwt_jti = $1',
      [decoded.jti]
    );

    if (sessionRes.rows.length === 0 || !sessionRes.rows[0].is_active) {
      return res.status(401).json({ error: 'Session invalidated', code: 'session_invalid' });
    }

    // Attach user info to request
    req.user = {
      id: decoded.id,
      email: decoded.email,
      jti: decoded.jti
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
}
