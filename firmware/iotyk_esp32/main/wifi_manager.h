#ifndef MAIN_WIFI_MANAGER_H
#define MAIN_WIFI_MANAGER_H

#include <stdbool.h>
#include <stddef.h>

// Initialize the ESP32 network interfaces (TCP/IP) and events system
void wifi_manager_init(void);

// Connect to a WiFi router in Station (STA) mode (non-blocking)
void wifi_manager_connect_sta(const char* ssid, const char* pass);

// Start an open Access Point (AP) fallback network
void wifi_manager_start_ap(const char* ssid, const char* pass);

// Check if WiFi station mode is fully connected and has obtained an IP address
bool wifi_manager_is_connected(void);

// Retrieve obtained IP address string
void wifi_manager_get_ip(char* out_ip, size_t max_len);

// Stop WiFi interfaces cleanly
void wifi_manager_stop(void);

// Check if WiFi connection retry limit has been exceeded
bool wifi_manager_has_failed(void);

// Configure dynamic WiFi power-save modem sleep modes
void wifi_manager_set_power_save(bool enable);

// Start mDNS host resolution service
void wifi_manager_start_mdns(const char* device_id);

#endif // MAIN_WIFI_MANAGER_H
