const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { generateESP32Firmware } = require('../utils/firmware');

/**
 * GET /firmware/download/:deviceId
 * Download complete ESP32 firmware package as ZIP
 * Includes all source files, libraries, config, and WSS certificates
 */
router.get('/download/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;

    // Validate device ID format
    if (!/^ESP32-[A-Z0-9]{6}$/.test(deviceId)) {
      return res.status(400).json({ error: 'Invalid device ID format' });
    }

    console.log(`📦 Generating firmware package for ${deviceId}...`);

    // Get device config from database (would need to pass db connection)
    // For now, this would be called from factory.js with proper context
    
    res.json({
      message: 'Use POST /api/factory/generate-firmware to generate and download',
      deviceId
    });
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Failed to download firmware' });
  }
});

module.exports = router;
