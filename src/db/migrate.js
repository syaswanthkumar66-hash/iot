import { query, connectDB } from './connection.js';

async function runMigrations() {
  console.log('🔄 Starting database migrations...');

  try {
    await connectDB();

    // 1. Users
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✅ Checked table: users');

    // 2. Devices
    await query(`
      CREATE TABLE IF NOT EXISTS devices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id TEXT UNIQUE NOT NULL,
        device_key_hash TEXT,
        namespace TEXT UNIQUE NOT NULL,
        name TEXT,
        firmware TEXT,
        relay_count INTEGER NOT NULL DEFAULT 1,
        owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
        last_state JSONB DEFAULT '{}'::jsonb,
        last_seen TIMESTAMPTZ,
        is_online BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await query(`
      ALTER TABLE devices
      ADD COLUMN IF NOT EXISTS relay_count INTEGER NOT NULL DEFAULT 1;
    `);
    console.log('✅ Checked table: devices');

    // 3. Device Shares
    await query(`
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
    `);
    console.log('✅ Checked table: device_shares');

    // 4. Device Transfers
    await query(`
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
    `);
    console.log('✅ Checked table: device_transfers');

    // 5. Pairing Tokens
    await query(`
      CREATE TABLE IF NOT EXISTS pairing_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✅ Checked table: pairing_tokens');

    // 6. MQTT Credentials
    await query(`
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
    `);
    console.log('✅ Checked table: mqtt_credentials');

    // 7. Sessions
    await query(`
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
    `);
    console.log('✅ Checked table: sessions');

    console.log('🎉 All migrations completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigrations();
