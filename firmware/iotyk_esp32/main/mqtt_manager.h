#ifndef MAIN_MQTT_MANAGER_H
#define MAIN_MQTT_MANAGER_H

#include <stdbool.h>
#include <string>

// Callback function type definition for handling incoming command payloads from the cloud
typedef std::string (*mqtt_command_callback_t)(const std::string& json_payload);

// Initialize and start the secure MQTTS connection to EMQX broker
void mqtt_manager_start(const char* client_id, const char* username, const char* password, mqtt_command_callback_t on_command);

// Publish a message payload securely to a specific MQTT topic
void mqtt_manager_publish(const char* topic, const char* payload, int qos, bool retain);

// Stop the secure cloud MQTT client
void mqtt_manager_stop(void);

// Returns true if secure MQTT client is fully connected and authenticated
bool mqtt_manager_is_connected(void);

#endif // MAIN_MQTT_MANAGER_H
