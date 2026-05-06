import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { connectDB } from './db/connection.js';
import { mqttBridge } from './services/mqttBridge.js';
import './cron/credentialRotation.js';

// Route imports
import authRoutes from './routes/auth.js';
import mqttRoutes from './routes/mqtt.js';
import deviceRoutes from './routes/devices.js';
import pairingRoutes from './routes/pairing.js';
import sharingRoutes from './routes/sharing.js';
import factoryRoutes from './routes/factory.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disabled temporarily for the CDN scripts (qrcode.js) on the dashboard
}));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public')); // Serve static admin dashboard

// Trust the Render reverse proxy so express-rate-limit works correctly
app.set('trust proxy', 1);

// Global rate limiting
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later.' },
});
app.use(globalLimiter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/mqtt', mqttRoutes);
app.use('/api/v1/user/devices', deviceRoutes);
app.use('/api/v1/pairing', pairingRoutes);
app.use('/api/v1/sharing', sharingRoutes); // handles transfer too
app.use('/api/v1/factory', factoryRoutes);

// Start server
async function start() {
  try {
    const databaseReady = await connectDB();
    if (databaseReady) {
      console.log('Connected to database');
    }

    mqttBridge.connect();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

start();
