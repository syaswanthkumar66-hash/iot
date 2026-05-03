require('dotenv').config();
const path = require('path');
const express = require('express');
const db = require('./db');
const { connectMQTT } = require('./mqtt');
const { startRotationCron } = require('./cron/rotate');

// Import route handlers
const factoryRouter = require('./routes/factory');
const { router: authRouter } = require('./routes/auth');
const devicesRouter = require('./routes/devices');
const commandsRouter = require('./routes/commands');
const firmwareRouter = require('./routes/firmware');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check route (no auth required)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use(['/api/factory', '/api/v1/factory'], factoryRouter);
app.use('/api/auth', authRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/devices', commandsRouter);
app.use('/api/firmware', firmwareRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function start() {
  try {
    // Initialize database
    console.log('✓ Database initialized');

    // Connect to MQTT broker
    connectMQTT();

    // Start credential rotation cron job
    startRotationCron();

    // Start Express server
    app.listen(PORT, () => {
      console.log(`\n✓ IoTYK Server running on port ${PORT}`);
      console.log(`  Local:    http://localhost:${PORT}`);
      console.log(`  API:      http://localhost:${PORT}/api`);
      console.log(`  Health:   http://localhost:${PORT}/health`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⚠ Shutting down gracefully...');
  process.exit(0);
});

start();
