#!/bin/bash
# setup_arduino.sh - Self-contained Arduino environment for Render

set -e

# Get the project root directory
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

echo "Configuring Arduino CLI to be self-contained..."
# Create local config file in project root
arduino-cli config init --dest-dir "$PROJECT_ROOT" --overwrite

# Set all paths to be local to the project
arduino-cli config set directories.data "$DATA_DIR"
arduino-cli config set directories.downloads "$DATA_DIR/staging"
arduino-cli config set directories.user "$USER_DIR"
arduino-cli config set board_manager.additional_urls https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json

echo "Updating index..."
arduino-cli core update-index

echo "Installing ESP32 core (this will be persisted in arduino_data)..."
arduino-cli core install esp32:esp32

echo "Installing libraries (this will be persisted in arduino_user)..."
arduino-cli lib install "ArduinoJson" || echo "Failed/Skipped"
arduino-cli lib install "PubSubClient" || echo "Failed/Skipped"
arduino-cli lib install "WebSockets" || echo "Failed/Skipped"

echo "Arduino environment ready and self-contained!"
