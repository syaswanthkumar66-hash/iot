#include "mqtt_manager.h"
#include "mqtt_client.h"
#include "esp_log.h"
#include "certificates.h"
#include "config.h"
#include <stdio.h>
#include <string.h>
#include <string>

static const char* TAG = "MQTT_MGR";
static esp_mqtt_client_handle_t s_client = NULL;
static bool s_connected = false;
static std::string s_cmd_topic = "";
static std::string s_state_topic = "";
static mqtt_command_callback_t s_on_command = NULL;

static void mqtt_event_handler(void* handler_args, esp_event_base_t base, int32_t event_id, void* event_data) {
    esp_mqtt_event_handle_t event = (esp_mqtt_event_handle_t)event_data;
    esp_mqtt_client_handle_t client = event->client;

    switch ((esp_mqtt_event_id_t)event_id) {
        case MQTT_EVENT_CONNECTED:
            ESP_LOGI(TAG, "MQTTS Secure Client Connected to Broker.");
            s_connected = true;
            printf("Setup completed. Now connected to MQTT.\n");
            if (!s_cmd_topic.empty()) {
                int msg_id = esp_mqtt_client_subscribe(client, s_cmd_topic.c_str(), 1);
                ESP_LOGI(TAG, "Subscribed to topic: %s (msg_id=%d)", s_cmd_topic.c_str(), msg_id);
            }
            break;
        case MQTT_EVENT_DISCONNECTED:
            ESP_LOGI(TAG, "MQTTS Secure Client Disconnected from Broker.");
            s_connected = false;
            break;
        case MQTT_EVENT_SUBSCRIBED:
            ESP_LOGI(TAG, "Subscription successful. MsgID: %d", event->msg_id);
            break;
        case MQTT_EVENT_DATA: {
            std::string topic(event->topic, event->topic_len);
            std::string data(event->data, event->data_len);
            ESP_LOGI(TAG, "MQTTS command received on %s: %s", topic.c_str(), data.c_str());

            if (s_on_command) {
                std::string resp = s_on_command(data);
                if (!resp.empty() && !s_state_topic.empty()) {
                    esp_mqtt_client_publish(client, s_state_topic.c_str(), resp.c_str(), resp.length(), 1, 0);
                    ESP_LOGI(TAG, "State report published back to: %s", s_state_topic.c_str());
                }
            }
            break;
        }
        case MQTT_EVENT_ERROR:
            ESP_LOGE(TAG, "MQTTS client encountered connection errors.");
            break;
        default:
            break;
    }
}

void mqtt_manager_start(const char* client_id, const char* username, const char* password, mqtt_command_callback_t on_command) {
    if (s_client != NULL) return;
    s_on_command = on_command;

    s_cmd_topic = "device/" + std::string(client_id) + "/cmd";
    s_state_topic = "device/" + std::string(client_id) + "/state";

    char uri_buf[128];
    snprintf(uri_buf, sizeof(uri_buf), "mqtts://%s:%d", DEFAULT_MQTT_BROKER, MQTT_PORT);

    esp_mqtt_client_config_t mqtt_cfg = {};
    mqtt_cfg.broker.address.uri = uri_buf;

    if (hasUsableCa(EMQX_MQTT_CA_CERT)) {
        mqtt_cfg.broker.verification.certificate = EMQX_MQTT_CA_CERT;
    } else {
        ESP_LOGW(TAG, "EMQX ca.crt not provided. Commencing unverified SSL/TLS link.");
    }

    mqtt_cfg.credentials.client_id = client_id;
    mqtt_cfg.credentials.username = username;
    mqtt_cfg.credentials.authentication.password = password;

    ESP_LOGI(TAG, "Initializing secure cloud MQTTS broker link (ClientID: %s)...", client_id);
    s_client = esp_mqtt_client_init(&mqtt_cfg);

    esp_mqtt_client_register_event(s_client, (esp_mqtt_event_id_t)ESP_EVENT_ANY_ID, mqtt_event_handler, NULL);
    esp_mqtt_client_start(s_client);
}

void mqtt_manager_publish(const char* topic, const char* payload, int qos, bool retain) {
    if (s_client && s_connected) {
        esp_mqtt_client_publish(s_client, topic, payload, strlen(payload), qos, retain ? 1 : 0);
    }
}

void mqtt_manager_stop(void) {
    if (s_client) {
        esp_mqtt_client_stop(s_client);
        esp_mqtt_client_destroy(s_client);
        s_client = NULL;
        s_connected = false;
        ESP_LOGI(TAG, "Secure MQTT client destroyed");
    }
}

bool mqtt_manager_is_connected(void) {
    return s_connected;
}
