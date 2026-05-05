-- IoTYK Production Database Schema (Synchronized with Live DB)

-- 1. Users Table
CREATE TABLE public.users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id)
);

-- 2. Devices Table
CREATE TABLE public.devices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  device_id text NOT NULL UNIQUE,
  device_key_hash text,
  namespace text NOT NULL UNIQUE,
  name text,
  firmware text,
  owner_id uuid,
  last_state jsonb DEFAULT '{}'::jsonb,
  last_seen timestamp with time zone,
  is_online boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  relay_count integer NOT NULL DEFAULT 1 CHECK (relay_count >= 1 AND relay_count <= 8),
  flash_count integer NOT NULL DEFAULT 0,
  last_flashed_at timestamp with time zone,
  hardware_replaced boolean NOT NULL DEFAULT false,
  hardware_replace_count integer NOT NULL DEFAULT 0,
  CONSTRAINT devices_pkey PRIMARY KEY (id),
  CONSTRAINT devices_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id)
);

-- 3. Sessions Table
CREATE TABLE public.sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  jwt_jti text NOT NULL UNIQUE,
  ip_address text,
  user_agent text,
  expires_at timestamp with time zone NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT sessions_pkey PRIMARY KEY (id),
  CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);

-- 4. MQTT Credentials Table
CREATE TABLE public.mqtt_credentials (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  device_id uuid,
  cred_type text NOT NULL,
  mqtt_username text NOT NULL UNIQUE,
  mqtt_password_enc text NOT NULL,
  expires_at timestamp with time zone,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT mqtt_credentials_pkey PRIMARY KEY (id),
  CONSTRAINT mqtt_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
  CONSTRAINT mqtt_credentials_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id)
);

-- 5. Device Shares Table
CREATE TABLE public.device_shares (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  shared_with_id uuid,
  role text NOT NULL DEFAULT 'viewer'::text,
  invite_token text UNIQUE,
  invite_email text,
  status text NOT NULL DEFAULT 'pending'::text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT device_shares_pkey PRIMARY KEY (id),
  CONSTRAINT device_shares_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id),
  CONSTRAINT device_shares_shared_with_id_fkey FOREIGN KEY (shared_with_id) REFERENCES public.users(id),
  CONSTRAINT device_shares_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id)
);

-- 6. Device Transfers Table
CREATE TABLE public.device_transfers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL,
  from_user_id uuid NOT NULL,
  to_user_id uuid,
  transfer_token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'::text,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT device_transfers_pkey PRIMARY KEY (id),
  CONSTRAINT device_transfers_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES public.users(id),
  CONSTRAINT device_transfers_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES public.users(id),
  CONSTRAINT device_transfers_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id)
);

-- 7. Pairing Tokens Table
CREATE TABLE public.pairing_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL,
  user_id uuid,
  token text NOT NULL UNIQUE,
  expires_at timestamp with time zone NOT NULL,
  used boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT pairing_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT pairing_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
  CONSTRAINT pairing_tokens_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id)
);

-- 8. Hardware Flash Log
CREATE TABLE public.hardware_flash_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL,
  event_type text NOT NULL,
  notes text,
  performed_by text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT hardware_flash_log_pkey PRIMARY KEY (id),
  CONSTRAINT hardware_flash_log_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id)
);
