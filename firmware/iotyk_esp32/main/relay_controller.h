#ifndef MAIN_RELAY_CONTROLLER_H
#define MAIN_RELAY_CONTROLLER_H

#include <stdbool.h>
#include "config.h"

// Initialize the GPIO pins for output relays and set them to default off states
void relay_controller_init(void);

// Get the active relay count from NVS dynamically
int relay_controller_get_count(void);

// Set individual relay state (id is 0-indexed, state is true/false)
void relay_controller_set_state(int id, bool active);

// Get current tracked state of an individual relay
bool relay_controller_get_state(int id);

// Trigger Red and Blue indicator LEDs
void indicator_led_set_red(bool active);
void indicator_led_set_blue(bool active);

#endif // MAIN_RELAY_CONTROLLER_H
