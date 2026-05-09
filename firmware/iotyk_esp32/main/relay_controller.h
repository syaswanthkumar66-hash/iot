#ifndef MAIN_RELAY_CONTROLLER_H
#define MAIN_RELAY_CONTROLLER_H

#include <stdbool.h>
#include "config.h"

// Initialize the GPIO pins for output relays and set them to default off states
void relay_controller_init(void);

// Set individual relay state (id is 0-indexed, state is true/false)
void relay_controller_set_state(int id, bool active);

// Get current tracked state of an individual relay
bool relay_controller_get_state(int id);

// Trigger standard indicator LED blinking
void indicator_led_set(bool active);

#endif // MAIN_RELAY_CONTROLLER_H
