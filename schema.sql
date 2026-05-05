-- IoTYK Backend Database Schema
-- Run this in the Supabase SQL Editor to initialize the database

-- 1. Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Devices
CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT UNIQUE NOT NULL,
  device_key_hash TEXT,
  namespace TEXT UNIQUE NOT NULL,
  name TEXT,
  firmware TEXT,
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  last_state JSONB DEFAULT '{}'::jsonb,
  last_seen TIMESTAMPTZ,
  is_online BOOLEAN DEFAULT false,
  relay_count INTEGER NOT NULL DEFAULT 1,
  -- Hardware replacement tracking
  flash_count INTEGER NOT NULL DEFAULT 0,         -- how many times firmware was downloaded/sent
  last_flashed_at TIMESTAMPTZ,                    -- last time credentials were sent to hardware
  hardware_replaced BOOLEAN NOT NULL DEFAULT false, -- true if marked as replaced hardware
  hardware_replace_count INTEGER NOT NULL DEFAULT 0,-- how many times hardware was replaced
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Device Shares
CREATE TABLE IF NOT EXISTS device_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_with_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer',
  invite_token TEXT UNIQUE,
  invite_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Device Transfers
CREATE TABLE IF NOT EXISTS device_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  transfer_token TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Pairing Tokens
CREATE TABLE IF NOT EXISTS pairing_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. MQTT Credentials
CREATE TABLE IF NOT EXISTS mqtt_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
  cred_type TEXT NOT NULL,
  mqtt_username TEXT UNIQUE NOT NULL,
  mqtt_password_enc TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jwt_jti TEXT UNIQUE NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Hardware Flash Log
-- Tracks every time credentials were sent to a physical ESP32 board
CREATE TABLE IF NOT EXISTS hardware_flash_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,  -- 'initial_flash' | 'credential_send' | 'hardware_replace' | 'factory_reset'
  notes TEXT,                -- optional reason (e.g. "Board burnt", "Water damage")
  performed_by TEXT,         -- factory admin note
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION: Add new columns to existing databases (safe to run on existing DBs)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE devices ADD COLUMN IF NOT EXISTS relay_count           INTEGER      NOT NULL DEFAULT 1;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS flash_count           INTEGER      NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_flashed_at       TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS hardware_replaced     BOOLEAN      NOT NULL DEFAULT false;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS hardware_replace_count INTEGER     NOT NULL DEFAULT 0;
