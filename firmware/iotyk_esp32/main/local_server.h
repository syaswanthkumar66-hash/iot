#ifndef MAIN_LOCAL_SERVER_H
#define MAIN_LOCAL_SERVER_H

#include <stdbool.h>
#include <string>

// Callback function type definition for handling JSON commands
typedef std::string (*command_callback_t)(const std::string& json_payload);

// Start the native HTTP and authenticated WS (WebSocket) server on port 80
void local_server_start(command_callback_t on_command);

// Stop the secure local server
void local_server_stop(void);

// Returns true if local server is actively running
bool local_server_is_active(void);

#endif // MAIN_LOCAL_SERVER_H
