#!/bin/bash
# setup_arduino.sh - Install Arduino CLI and ESP32 core for auto-compilation

set -e

ARDUINO_DIR="$HOME/arduino_cli"
BIN_DIR="$ARDUINO_DIR/bin"
mkdir -p "$BIN_DIR"

export PATH="$BIN_DIR:$PATH"

if command -v arduino-cli &> /dev/null; then
    echo "Arduino CLI already installed."
else
    echo "Installing Arduino CLI..."
    curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | BINDIR="$BIN_DIR" sh
fi

echo "Configuring Arduino CLI..."
arduino-cli config init --overwrite
arduino-cli config set board_manager.additional_urls https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json

echo "Updating index..."
arduino-cli core update-index

if arduino-cli core list | grep -q "esp32:esp32"; then
    echo "ESP32 core already installed."
else
    echo "Installing ESP32 core (this may take a few minutes)..."
    arduino-cli core install esp32:esp32
fi

echo "Installing libraries..."
arduino-cli lib install "ArduinoJson" || echo "ArduinoJson already installed or failed"
arduino-cli lib install "PubSubClient" || echo "PubSubClient already installed or failed"

echo "Arduino environment ready!"
