#include "relay_controller.h"
#include "driver/gpio.h"
#include <esp_log.h>

static const char* TAG = "RELAY_CTRL";
static bool current_relay_states[RELAY_COUNT] = {false};

void relay_controller_init(void) {
    // 1. Configure Relays
    gpio_config_t io_conf = {};
    io_conf.intr_type = GPIO_INTR_DISABLE;
    io_conf.mode = GPIO_MODE_INPUT_OUTPUT; // Input_Output so we can read back state if needed
    io_conf.pin_bit_mask = 0;
    
    for (int i = 0; i < RELAY_COUNT; i++) {
        io_conf.pin_bit_mask |= (1ULL << RELAY_PINS[i]);
    }
    
    io_conf.pull_down_en = GPIO_PULLDOWN_DISABLE;
    io_conf.pull_up_en = GPIO_PULLUP_DISABLE;
    gpio_config(&io_conf);

    // Write initial OFF states
    for (int i = 0; i < RELAY_COUNT; i++) {
        current_relay_states[i] = false;
        bool initial_pin_state = RELAY_ACTIVE_LOW ? true : false;
        gpio_set_level((gpio_num_t)RELAY_PINS[i], initial_pin_state ? 1 : 0);
    }

    // 2. Configure Indicator LED (usually GPIO 2)
    gpio_config_t led_conf = {};
    led_conf.intr_type = GPIO_INTR_DISABLE;
    led_conf.mode = GPIO_MODE_OUTPUT;
    led_conf.pin_bit_mask = (1ULL << LED_PIN);
    led_conf.pull_down_en = GPIO_PULLDOWN_DISABLE;
    led_conf.pull_up_en = GPIO_PULLUP_DISABLE;
    gpio_config(&led_conf);
    
    // Initial LED state is OFF
    gpio_set_level((gpio_num_t)LED_PIN, 0);

    ESP_LOGI(TAG, "Relay controller initialized (%d relays)", RELAY_COUNT);
}

void relay_controller_set_state(int id, bool active) {
    if (id < 0 || id >= RELAY_COUNT) {
        ESP_LOGW(TAG, "Invalid relay index toggle requested: %d", id);
        return;
    }

    current_relay_states[id] = active;
    bool pin_level = active;
    if (RELAY_ACTIVE_LOW) {
        pin_level = !active;
    }

    gpio_set_level((gpio_num_t)RELAY_PINS[id], pin_level ? 1 : 0);
    ESP_LOGI(TAG, "Relay %d set to %s (Pin level: %d)", id + 1, active ? "ON" : "OFF", pin_level);
}

bool relay_controller_get_state(int id) {
    if (id < 0 || id >= RELAY_COUNT) return false;
    return current_relay_states[id];
}

void indicator_led_set(bool active) {
    gpio_set_level((gpio_num_t)LED_PIN, active ? 1 : 0);
}
