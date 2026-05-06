import pg from 'pg';
import dotenv from 'dotenv';
import { hasRealEnvValue, requireRealEnvValue } from '../config/env.js';

dotenv.config();

const { Pool } = pg;

// Always use SSL if connecting to Supabase (or any external production DB)
const isSupabase = process.env.DATABASE_URL?.includes('supabase');
const pool = new Pool({
  connectionString: hasRealEnvValue('DATABASE_URL') ? process.env.DATABASE_URL : undefined,
  ssl: (process.env.NODE_ENV === 'production' || isSupabase) ? { rejectUnauthorized: false } : undefined,
});

export async function connectDB() {
  if (!hasRealEnvValue('DATABASE_URL')) {
    if (process.env.NODE_ENV === 'production') {
      requireRealEnvValue('DATABASE_URL', 'Postgres database URL');
    }

    console.warn('Database is not configured. Set DATABASE_URL in .env to enable database-backed API routes.');
    return false;
  }

  const client = await pool.connect();
  
  // Auto-migration for missing columns in existing Supabase databases
  try {
    await client.query(`
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS relay_count INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS flash_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_flashed_at TIMESTAMPTZ;
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS hardware_replaced BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS hardware_replace_count INTEGER NOT NULL DEFAULT 0;
      
      CREATE TABLE IF NOT EXISTS hardware_flash_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        notes TEXT,
        performed_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✅ Database schema verified and auto-migrated');
  } catch (err) {
    console.error('⚠️ Auto-migration skipped or failed:', err.message);
  }

  client.release();
  return true;
}

export async function query(text, params) {
  if (!hasRealEnvValue('DATABASE_URL')) {
    throw new Error('Database is not configured. Set DATABASE_URL in .env.');
  }

  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  // console.log('executed query', { text, duration, rows: res.rowCount });
  return res;
}

// Transaction helper
export async function withTransaction(callback) {
  if (!hasRealEnvValue('DATABASE_URL')) {
    throw new Error('Database is not configured. Set DATABASE_URL in .env.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
