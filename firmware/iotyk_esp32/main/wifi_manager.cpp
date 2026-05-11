#include "wifi_manager.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "mdns.h"
#include "config.h"
#include <string.h>

static const char* TAG = "WIFI_MGR";

static esp_netif_t* sta_netif = NULL;
static esp_netif_t* ap_netif = NULL;
static bool s_connected = false;
static bool s_has_failed = false;
static char s_ip_addr[32] = "0.0.0.0";
static int s_retry_num = 0;
#define WIFI_MAX_RETRY 5

static void event_handler(void* arg, esp_event_base_t event_base,
                                int32_t event_id, void* event_data) {
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
        ESP_LOGI(TAG, "WiFi Station mode started. Connecting...");
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        s_connected = false;
        if (s_retry_num < WIFI_MAX_RETRY) {
            esp_wifi_connect();
            s_retry_num++;
            ESP_LOGI(TAG, "Disconnected from AP. Retrying (%d/%d)...", s_retry_num, WIFI_MAX_RETRY);
        } else {
            ESP_LOGW(TAG, "Failed to connect after max retries.");
            s_has_failed = true;
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t* event = (ip_event_got_ip_t*) event_data;
        esp_ip4addr_ntoa(&event->ip_info.ip, s_ip_addr, sizeof(s_ip_addr));
        ESP_LOGI(TAG, "Got IP address: %s", s_ip_addr);
        s_connected = true;
        s_retry_num = 0;
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_AP_STACONNECTED) {
        wifi_event_ap_staconnected_t* event = (wifi_event_ap_staconnected_t*) event_data;
        ESP_LOGI(TAG, "Station " MACSTR " joined AP, AID=%d",
                 MAC2STR(event->mac), event->aid);
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_AP_STADISCONNECTED) {
        wifi_event_ap_stadisconnected_t* event = (wifi_event_ap_stadisconnected_t*) event_data;
        ESP_LOGI(TAG, "Station " MACSTR " left AP, AID=%d",
                 MAC2STR(event->mac), event->aid);
    }
}

void wifi_manager_init(void) {
    static bool netif_initialized = false;
    if (!netif_initialized) {
        ESP_ERROR_CHECK(esp_netif_init());
        ESP_ERROR_CHECK(esp_event_loop_create_default());
        netif_initialized = true;
    }

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT,
                                                        ESP_EVENT_ANY_ID,
                                                        &event_handler,
                                                        NULL,
                                                        NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT,
                                                        IP_EVENT_STA_GOT_IP,
                                                        &event_handler,
                                                        NULL,
                                                        NULL));
    
    ESP_LOGI(TAG, "WiFi network stack initialized");
}

void wifi_manager_connect_sta(const char* ssid, const char* pass) {
    if (sta_netif == NULL) {
        sta_netif = esp_netif_create_default_wifi_sta();
    }

    wifi_config_t wifi_config = {};
    strncpy((char*)wifi_config.sta.ssid, ssid, sizeof(wifi_config.sta.ssid) - 1);
    strncpy((char*)wifi_config.sta.password, pass, sizeof(wifi_config.sta.password) - 1);
    wifi_config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());
    
    s_retry_num = 0;
    s_has_failed = false;
    ESP_LOGI(TAG, "Starting connection to SSID: %s", ssid);
}

void wifi_manager_start_ap(const char* ssid, const char* pass) {
    if (ap_netif == NULL) {
        ap_netif = esp_netif_create_default_wifi_ap();
    }

    wifi_config_t wifi_config = {};
    strncpy((char*)wifi_config.ap.ssid, ssid, sizeof(wifi_config.ap.ssid) - 1);
    strncpy((char*)wifi_config.ap.password, pass, sizeof(wifi_config.ap.password) - 1);
    wifi_config.ap.ssid_len = strlen(ssid);
    wifi_config.ap.max_connection = 4;
    wifi_config.ap.authmode = strlen(pass) == 0 ? WIFI_AUTH_OPEN : WIFI_AUTH_WPA2_PSK;

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "SoftAP started. SSID: %s, Pass: %s", ssid, pass);
}

bool wifi_manager_is_connected(void) {
    return s_connected;
}

void wifi_manager_get_ip(char* out_ip, size_t max_len) {
    strncpy(out_ip, s_ip_addr, max_len - 1);
    out_ip[max_len - 1] = '\0';
}

void wifi_manager_stop(void) {
    esp_wifi_stop();
    s_connected = false;
    s_has_failed = false;
    strcpy(s_ip_addr, "0.0.0.0");
    ESP_LOGI(TAG, "WiFi stopped");
}

bool wifi_manager_has_failed(void) {
    return s_has_failed;
}

void wifi_manager_set_power_save(bool enable) {
    // Direct power (5V 5W) connected. Keep WiFi transceiver fully active at all times for sub-ms ping times!
    esp_wifi_set_ps(WIFI_PS_NONE);
    ESP_LOGI(TAG, "WiFi Power Save forced disabled (Max Performance Mode at all times)");
}

void wifi_manager_start_mdns(const char* device_id) {
    // Initialize mDNS service
    esp_err_t err = mdns_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "mDNS Init failed: %d", err);
        return;
    }

    // Set hostname (e.g. iotyk-123456.local)
    mdns_hostname_set(device_id);
    // Set instance name
    mdns_instance_name_set("IoTYK Smart Relay Board");

    // Add HTTP and WebSocket services to resolve over mDNS
    mdns_service_add(NULL, "_http", "_tcp", LOCAL_HTTP_PORT, NULL, 0);
    mdns_service_add(NULL, "_ws", "_tcp", LOCAL_HTTP_PORT, NULL, 0);

    ESP_LOGI(TAG, "mDNS started successfully. Hostname: %s.local", device_id);
}
