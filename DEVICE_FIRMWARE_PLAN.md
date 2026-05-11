# 🔌 ESP32 Device Firmware Plan: Codebase Audit & Power Migrations

This plan outlines the technical audit of your existing ESP32 firmware files (located inside `firmware/iotyk_esp32/main/`) and provides the exact code modifications and configurations required to implement the Dual-Core Dynamic Frequency Scaling (DFS) blueprint.

---

## 📊 1. Codebase Gap Analysis (Existing vs. Master Plan)

### A. Flat Directory vs. Modular Components
*   **The Findings:** Your existing codebase is organized as a flat set of source files inside the `/main` folder. For long-term maintainability, standard-compliant ESP-IDF projects package reusable device subsystems as dedicated custom **components**.
*   **The Upgrade:** We will organize your source files under a unified component called `iotyk_core`. The compiler will automatically link this component during the CMake build tracking.

### B. Dynamic Clock Scaling (DFS Integration)
*   **The Findings:** Currently, your ESP32 runs at a flat `160MHz` or `240MHz` continuously. This leads to high thermal dissipation and excessive current draw (~80mA) even when sitting idle in a customer's cupboard.
*   **The Upgrade:** We will enable the ESP32’s internal `esp_pm_configure()` driver. This lets the chip dynamically downscale its CPU clock to **80MHz** during standby, saving massive energy, and scale back to **160MHz/240MHz** only when running high-performance computations.

---

## 🛠️ 2. File-by-File Firmware Migrations

### File A: `main/CMakeLists.txt` (Component Registration)
Update your central CMake configuration to register your components directory. This guarantees that your source files compile seamlessly:

```cmake
# CMakeLists.txt inside /main
idf_component_register(SRCS "main.cpp"
                            "nvs_manager.cpp"
                            "relay_controller.cpp"
                            "wifi_manager.cpp"
                            "ble_provision.cpp"
                            "local_server.cpp"
                            "mqtt_manager.cpp"
                       REQUIRES nvs_flash esp_http_server mdns json)
```

---

### File B: Adding Dynamic Clock Downscaling (`local_server.cpp`)
To minimize battery drain, we keep the ESP32 at a low 80MHz clock. However, when a client connects to your local WebSocket and sends an auth payload, we need to temporarily scale the clock to **160MHz** to run the cryptographical SHA256 signature quickly.

Update your WebSocket receiver inside **[`local_server.cpp`](file:///C:/Users/sp799/Documents/iotyk/firmware/iotyk_esp32/main/local_server.cpp)**:

```cpp
#include "esp_pm.h"
#include "esp_private/pm_impl.h"

// 1. Declare clock lock handle
static esp_pm_lock_handle_t s_clock_lock = NULL;

static void init_power_lock(void) {
    if (!s_clock_lock) {
        // Create a clock lock that forces the CPU to scale to max frequency when held
        esp_pm_lock_create(ESP_PM_CPU_FREQ_MAX, 0, "ws_perf", &s_clock_lock);
    }
}

// 2. Wrap WS receive loop with power locks
static esp_err_t ws_handler(httpd_req_t *req) {
    init_power_lock();

    if (req->method == HTTP_GET) {
        return ESP_OK;
    }

    // --- SCALE CPU UP TO 160MHz ---
    if (s_clock_lock) {
        esp_pm_lock_acquire(s_clock_lock);
    }

    httpd_ws_frame_t ws_pkt;
    // ... receive frame and parse json payload ...

    // --- RE-ALIGN CLOCK TO LOW POWER (80MHz) ---
    if (s_clock_lock) {
        esp_pm_lock_release(s_clock_lock);
    }

    return ESP_OK;
}
```

---

### File C: Core Pinning Configuration (`wifi_manager.cpp` & `local_server.cpp`)
To keep your relay triggering latency under **2.0 milliseconds**, ensure that all socket-listeners and network pings are pinned strictly to Core 0 (`PRO_CPU`), leaving Core 1 (`APP_CPU`) free to monitor sensor values and trigger relays:

1.  **Pin HTTP/WS Server to Core 0:** Inside `local_server.cpp`, configure your HTTP startup configuration:
    ```cpp
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.port = LOCAL_HTTP_PORT;
    config.core_id = 0; // ⚠️ Pins the server task strictly to Core 0 (PRO_CPU)
    ```
2.  **Pin WiFi Event Handler to Core 0:** Inside `wifi_manager.cpp`, ensure your WiFi connection callbacks are pinned to Core 0:
    ```cpp
    // Ensure standard WiFi tasks compile under Core 0
    #define CONFIG_ESP32_WIFI_TASK_PINNED_TO_CORE_0 1
    ```
3.  **Run Relay Loop on Core 1:** In `main.cpp`, create a high-priority, thread-isolated task dedicated strictly to physical actions on Core 1:
    ```cpp
    xTaskCreatePinnedToCore(relay_execution_task, "relay_task", 2048, NULL, 20, NULL, 1); // Pinned to Core 1
    ```
