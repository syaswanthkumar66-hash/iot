#!/bin/bash

# IoTYK Server Quick Start Guide
# This script helps set up the server environment

set -e

echo "🚀 IoTYK Server Setup"
echo "====================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js >= 16.0.0"
    exit 1
fi
echo "✅ Node.js $(node -v) found"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm not found"
    exit 1
fi
echo "✅ npm $(npm -v) found"

echo ""
echo "📦 Installing dependencies..."
npm install

echo ""
echo "⚙️  Configuration"
echo "================="

if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo ""
    echo "⚠️  IMPORTANT: Edit .env with your configuration:"
    echo "   - EMQX_BROKER      (your MQTT broker host)"
    echo "   - EMQX_API_USER    (EMQX admin username)"
    echo "   - EMQX_API_PASS    (EMQX admin password)"
    echo "   - JWT_SECRET       (generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\")"
    echo ""
    echo "   Edit: .env"
else
    echo "✅ .env already exists"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "🚀 To start the server:"
echo ""
echo "   Development (with auto-reload):"
echo "   $ npm run dev"
echo ""
echo "   Production:"
echo "   $ npm start"
echo ""
echo "📡 Server will run on: http://localhost:3000"
echo "🏥 Health check:       http://localhost:3000/health"
echo ""
