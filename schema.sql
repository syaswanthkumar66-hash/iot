-- IoTYK Production Database Schema

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  name text,
  created_at timestamptz DEFAULT now()
);

-- 2. Devices Table
CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text UNIQUE NOT NULL,      -- e.g. ESP32-A1B2C3
  namespace text NOT NULL,             -- for MQTT topics
  device_key_hash text NOT NULL,       -- Master Pairing Key
  owner_id uuid REFERENCES users(id),  -- Linked after Pairing
  name text,                           -- User's nickname for device
  relay_count integer DEFAULT 1,
  last_state jsonb DEFAULT '{}',
  is_online boolean DEFAULT false,
  last_seen timestamptz,
  flash_count integer DEFAULT 0,
  hardware_replace_count integer DEFAULT 0,
  last_flashed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- 3. Sessions Table (App Login)
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  jwt_jti uuid UNIQUE NOT NULL,
  ip_address text,
  user_agent text,
  is_active boolean DEFAULT true,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 4. MQTT Credentials Table (1h and Permanent)
CREATE TABLE IF NOT EXISTS mqtt_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid REFERENCES devices(id), -- Nullable if for User
  user_id uuid REFERENCES users(id),     -- Nullable if for Device
  cred_type text NOT NULL,               -- 'permanent', 'temporary', 'user_temp'
  mqtt_username text UNIQUE NOT NULL,
  mqtt_password_enc text NOT NULL,
  expires_at timestamptz,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 5. Device Shares & Transfers
CREATE TABLE IF NOT EXISTS device_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid REFERENCES devices(id),
  owner_id uuid REFERENCES users(id),
  shared_with_id uuid REFERENCES users(id),
  role text DEFAULT 'viewer',            -- 'admin', 'viewer'
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_devices_owner ON devices(owner_id);
CREATE INDEX IF NOT EXISTS idx_mqtt_username ON mqtt_credentials(mqtt_username);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
