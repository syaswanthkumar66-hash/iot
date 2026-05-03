const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRY = '7d';

/**
 * Hash a plain password using bcrypt
 */
function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

/**
 * Check if a plain password matches a hash
 */
function checkPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

/**
 * Issue a JWT token for a user
 */
function issueJWT(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

/**
 * Verify and decode a JWT token
 */
function verifyJWT(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Generate a device ID with optional prefix
 * e.g., "ESP32-" + 6 random uppercase alphanumeric
 */
function generateId(prefix = 'DEV-', bytes = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = prefix;
  for (let i = 0; i < bytes; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * Generate namespace: "ns_" + 16 random hex chars
 */
function generateNs(bytes = 16) {
  return 'ns_' + crypto.randomBytes(bytes).toString('hex');
}

/**
 * Generate permanent MQTT username from namespace
 */
function generateMqttUser(ns) {
  return 'perm_' + ns;
}

/**
 * Generate a secure password for MQTT
 * Random URL-safe characters, 24 chars long
 */
function generateMqttPass(len = 24) {
  return crypto.randomBytes(Math.ceil(len * 3 / 4))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
    .substring(0, len);
}

/**
 * Generate local HTTP/WS authentication token
 */
function generateLocalToken(len = 32) {
  return crypto.randomBytes(len).toString('hex');
}

/**
 * Generate temporary MQTT username
 */
function generateTempUser(ns) {
  return 'tmp_' + crypto.randomBytes(4).toString('hex');
}

/**
 * Generate temporary MQTT password
 */
function generateTempPass(len = 24) {
  return crypto.randomBytes(Math.ceil(len * 3 / 4))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
    .substring(0, len);
}

module.exports = {
  hashPassword,
  checkPassword,
  issueJWT,
  verifyJWT,
  generateId,
  generateNs,
  generateMqttUser,
  generateMqttPass,
  generateLocalToken,
  generateTempUser,
  generateTempPass,
};
