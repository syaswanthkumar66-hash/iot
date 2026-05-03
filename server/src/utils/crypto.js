import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// Password Hashing
export async function hashPassword(password) {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// AES-256-GCM Encryption for MQTT Passwords
// Requires AES_KEY in environment (32 bytes hex encoded = 64 hex chars)
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey() {
  const keyHex = process.env.AES_KEY;
  if (!keyHex) {
    throw new Error('AES_KEY environment variable is not set');
  }
  // Hash the provided AES_KEY with SHA-256 to guarantee a 32-byte key,
  // preventing errors if Render generates a random password that isn't exactly 64 hex chars.
  return crypto.createHash('sha256').update(String(keyHex)).digest();
}

export function encrypt(text) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encryptedData (all base64)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

export function decrypt(encryptedData) {
  const key = getEncryptionKey();
  const parts = encryptedData.split(':');
  
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const encryptedText = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

// Token Generation
export function generateToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

export function generateMqttPassword(length = 32) {
  // Base64Url safe password
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}
