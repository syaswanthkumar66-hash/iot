const Database = require('better-sqlite3');
const path = require('path');

// Initialize SQLite database
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'iotyk.db'));

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize schema
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      namespace TEXT UNIQUE NOT NULL,
      perm_mqtt_user TEXT NOT NULL,
      perm_mqtt_pass TEXT NOT NULL,
      temp_mqtt_user TEXT NOT NULL,
      temp_mqtt_pass TEXT NOT NULL,
      local_token TEXT NOT NULL,
      firmware_version TEXT,
      online BOOLEAN DEFAULT 0,
      last_seen INTEGER,
      relay_states TEXT DEFAULT '["off"]',
      rssi INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS commands_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      source TEXT NOT NULL,
      command TEXT NOT NULL,
      sent_at INTEGER NOT NULL,
      acked BOOLEAN DEFAULT 0,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
    CREATE INDEX IF NOT EXISTS idx_devices_namespace ON devices(namespace);
    CREATE INDEX IF NOT EXISTS idx_commands_log_device ON commands_log(device_id);
  `);
}

initSchema();

module.exports = db;
