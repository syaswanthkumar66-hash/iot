#ifndef MAIN_BLE_PROVISION_H
#define MAIN_BLE_PROVISION_H

#include <stdbool.h>

// Start BLE Advertising with custom service and characteristics (non-blocking)
void ble_provision_start(const char* device_id);

// Stop BLE Advertising and release Bluetooth controller resources
void ble_provision_stop(void);

// Returns true if BLE controller is actively advertising
bool ble_provision_is_active(void);

#endif // MAIN_BLE_PROVISION_H
