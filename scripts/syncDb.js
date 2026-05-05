import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../src/db/connection.js';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function sync() {
  console.log('🔄 Starting Database Synchronization...');
  
  try {
    const schemaPath = path.join(__dirname, '../schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    // Split by semicolon to run individual commands (basic parser)
    const commands = schemaSql
      .split(';')
      .map(c => c.trim())
      .filter(c => c.length > 0);

    for (const cmd of commands) {
      try {
        await query(cmd);
      } catch (err) {
        // If table already exists, we might get an error depending on the SQL
        // But since we use CREATE TABLE IF NOT EXISTS, it should be fine.
        if (!err.message.includes('already exists')) {
          console.warn(`⚠️ Warning on command: ${cmd.substring(0, 50)}...`);
          console.warn(`   Reason: ${err.message}`);
        }
      }
    }

    console.log('✅ Database Schema is now Synchronized with the Server!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Sync Failed:', err.message);
    process.exit(1);
  }
}

sync();
