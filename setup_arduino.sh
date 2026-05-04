#!/bin/bash
# setup_arduino.sh - Pre-cached Arduino environment for Render

set -e

PROJECT_ROOT=$(pwd)
ARDUINO_DIR="$PROJECT_ROOT/arduino_cli"
BIN_DIR="$ARDUINO_DIR/bin"
DATA_DIR="$PROJECT_ROOT/arduino_data"
USER_DIR="$PROJECT_ROOT/arduino_user"

echo "Creating directories..."
mkdir -p "$BIN_DIR" "$DATA_DIR" "$USER_DIR"

export PATH="$BIN_DIR:$PATH"

if [ -f "$BIN_DIR/arduino-cli" ]; then
    echo "Arduino CLI already installed."
else
    echo "Installing Arduino CLI to $BIN_DIR..."
    curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | BINDIR="$BIN_DIR" sh
fi

echo "Configuring Arduino CLI..."
arduino-cli config init --dest-dir "$PROJECT_ROOT" --overwrite
arduino-cli config set directories.data "$DATA_DIR"
arduino-cli config set directories.downloads "$DATA_DIR/staging"
arduino-cli config set directories.user "$USER_DIR"
arduino-cli config set board_manager.additional_urls https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json

echo "Updating index..."
arduino-cli core update-index

echo "Installing ESP32 core..."
arduino-cli core install esp32:esp32

echo "Installing libraries..."
arduino-cli lib install "ArduinoJson" || true
arduino-cli lib install "PubSubClient" || true
arduino-cli lib install "WebSockets" || true

echo "Pre-caching tools via dummy compile..."
mkdir -p dummy_sketch
echo "void setup(){} void loop(){}" > dummy_sketch/dummy_sketch.ino
# This forces ctags, discovery tools, etc. to be downloaded and installed in the build phase
arduino-cli compile --fqbn esp32:esp32:esp32 dummy_sketch/dummy_sketch.ino
rm -rf dummy_sketch

echo "Arduino environment ready and fully cached!"
