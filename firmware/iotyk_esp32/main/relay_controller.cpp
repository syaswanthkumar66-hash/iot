#include "relay_controller.h"
#include "driver/gpio.h"
#include "nvs_manager.h"
#include <esp_log.h>
#include <stdlib.h>

static const char* TAG = "RELAY_CTRL";
static bool current_relay_states[RELAY_COUNT] = {false};

int relay_controller_get_count(void) {
    char buf[16] = {0};
    // Fetch dynamic relay count string from NVS (defaults to "1")
    nvs_manager_get_str(KEY_RELAY_COUNT, buf, sizeof(buf), "1");
    int count = atoi(buf);
    if (count < 1) count = 1;
    if (count > RELAY_COUNT) count = RELAY_COUNT; // Safety cap at compile-time max array size (4)
    return count;
}

void relay_controller_init(void) {
    int count = relay_controller_get_count();

    // 1. Configure Relays
    gpio_config_t io_conf = {};
    io_conf.intr_type = GPIO_INTR_DISABLE;
    io_conf.mode = GPIO_MODE_INPUT_OUTPUT; // Input_Output so we can read back state if needed
    io_conf.pin_bit_mask = 0;
    
    for (int i = 0; i < count; i++) {
        io_conf.pin_bit_mask |= (1ULL << RELAY_PINS[i]);
    }
    
    io_conf.pull_down_en = GPIO_PULLDOWN_DISABLE;
    io_conf.pull_up_en = GPIO_PULLUP_DISABLE;
    gpio_config(&io_conf);

    // Write initial OFF states
    for (int i = 0; i < count; i++) {
        current_relay_states[i] = false;
        bool initial_pin_state = RELAY_ACTIVE_LOW ? true : false;
        gpio_set_level((gpio_num_t)RELAY_PINS[i], initial_pin_state ? 1 : 0);
    }

    // 2. Configure Indicator LEDs (Red and Blue)
    gpio_config_t led_conf = {};
    led_conf.intr_type = GPIO_INTR_DISABLE;
    led_conf.mode = GPIO_MODE_OUTPUT;
    led_conf.pin_bit_mask = (1ULL << LED_PIN_RED) | (1ULL << LED_PIN_BLUE);
    led_conf.pull_down_en = GPIO_PULLDOWN_DISABLE;
    led_conf.pull_up_en = GPIO_PULLUP_DISABLE;
    gpio_config(&led_conf);
    
    // Initial states are OFF
    gpio_set_level((gpio_num_t)LED_PIN_RED, 0);
    gpio_set_level((gpio_num_t)LED_PIN_BLUE, 0);

    ESP_LOGI(TAG, "Relay controller initialized (%d channels active, max %d)", count, RELAY_COUNT);
}

void relay_controller_set_state(int id, bool active) {
    int count = relay_controller_get_count();
    if (id < 0 || id >= count) {
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
    int count = relay_controller_get_count();
    if (id < 0 || id >= count) return false;
    return current_relay_states[id];
}

void indicator_led_set_red(bool active) {
    gpio_set_level((gpio_num_t)LED_PIN_RED, active ? 1 : 0);
}

void indicator_led_set_blue(bool active) {
    gpio_set_level((gpio_num_t)LED_PIN_BLUE, active ? 1 : 0);
}
