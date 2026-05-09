#include "local_server.h"
#include "esp_https_server.h"
#include "esp_log.h"
#include "nvs_manager.h"
#include "certificates.h"
#include "config.h"
#include <string.h>

static const char* TAG = "WSS_SRV";
static httpd_handle_t s_server = NULL;
static command_callback_t s_on_command = NULL;

// Helper to check Authorization header matches the stored pairing key/token
static bool is_authorized(httpd_req_t *req) {
    char auth_hdr[128] = {0};
    if (httpd_req_get_hdr_value_str(req, "Authorization", auth_hdr, sizeof(auth_hdr)) != ESP_OK) {
        return false;
    }
    if (strncmp(auth_hdr, "Bearer ", 7) != 0) {
        return false;
    }
    const char* req_token = auth_hdr + 7;

    char stored_token[64] = {0};
    nvs_manager_get_str(KEY_LOCAL_TOKEN, stored_token, sizeof(stored_token), FACTORY_LOCAL_TOKEN);

    return strcmp(req_token, stored_token) == 0;
}

// GET /info (Public Diagnostic Info)
static esp_err_t info_get_handler(httpd_req_t *req) {
    char d_id[32] = {0};
    nvs_manager_get_str(KEY_DEVICE_ID, d_id, sizeof(d_id), FACTORY_DEVICE_ID);

    char resp[128];
    snprintf(resp, sizeof(resp), "{\"id\":\"%s\",\"type\":\"esp32_relay\",\"fw\":\"%s\"}", d_id, FIRMWARE_VERSION);

    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, resp);
    return ESP_OK;
}

// GET /state (Authenticated State Fetch)
static esp_err_t state_get_handler(httpd_req_t *req) {
    if (!is_authorized(req)) {
        httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Unauthorized");
        return ESP_OK;
    }

    std::string resp = s_on_command("{\"cmd\":\"state\"}");
    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, resp.c_str());
    return ESP_OK;
}

// POST /cmd (Authenticated Relay Toggles)
static esp_err_t cmd_post_handler(httpd_req_t *req) {
    if (!is_authorized(req)) {
        httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Unauthorized");
        return ESP_OK;
    }

    char content[256] = {0};
    size_t recv_size = req->content_len;
    if (recv_size >= sizeof(content)) {
        recv_size = sizeof(content) - 1;
    }

    int ret = httpd_req_recv(req, content, recv_size);
    if (ret <= 0) {
        if (ret == HTTPD_SOCK_ERR_TIMEOUT) {
            httpd_resp_send_408(req);
        }
        return ESP_FAIL;
    }
    content[ret] = '\0';

    std::string resp = s_on_command(content);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, resp.c_str());
    return ESP_OK;
}

// WebSocket Event handler (GET /ws)
static esp_err_t ws_handler(httpd_req_t *req) {
    if (req->method == HTTP_GET) {
        ESP_LOGI(TAG, "Handshake completed! Secure WebSocket client connected.");
        return ESP_OK;
    }

    httpd_ws_frame_t ws_pkt;
    uint8_t *buf = NULL;
    memset(&ws_pkt, 0, sizeof(httpd_ws_frame_t));
    ws_pkt.type = HTTPD_WS_TYPE_TEXT;

    esp_err_t ret = httpd_ws_recv_frame(req, &ws_pkt, 0);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to read packet length: %s", esp_err_to_name(ret));
        return ret;
    }

    if (ws_pkt.len > 0) {
        buf = (uint8_t*)calloc(1, ws_pkt.len + 1);
        if (!buf) {
            ESP_LOGE(TAG, "Out of memory allocating frame buffer");
            return ESP_ERR_NO_MEM;
        }
        ws_pkt.payload = buf;
        ret = httpd_ws_recv_frame(req, &ws_pkt, ws_pkt.len);
        if (ret != ESP_OK) {
            ESP_LOGE(TAG, "Failed to read packet payload: %s", esp_err_to_name(ret));
            free(buf);
            return ret;
        }
    }

    if (ws_pkt.type == HTTPD_WS_TYPE_TEXT) {
        std::string msg((char*)ws_pkt.payload, ws_pkt.len);
        ESP_LOGI(TAG, "WS payload: %s", msg.c_str());

        // Process message through command callback
        std::string resp = s_on_command(msg);

        if (!resp.empty()) {
            httpd_ws_frame_t out_pkt;
            memset(&out_pkt, 0, sizeof(httpd_ws_frame_t));
            out_pkt.payload = (uint8_t*)resp.c_str();
            out_pkt.len = resp.length();
            out_pkt.type = HTTPD_WS_TYPE_TEXT;
            httpd_ws_send_frame(req, &out_pkt);
        }
    }

    free(buf);
    return ESP_OK;
}

void local_server_start(command_callback_t on_command) {
    if (s_server != NULL) return;
    s_on_command = on_command;

    httpd_ssl_config_t config = HTTPD_SSL_CONFIG_DEFAULT();
    config.servercert = (const uint8_t*)LOCAL_WSS_SERVER_CERT;
    config.servercert_len = strlen(LOCAL_WSS_SERVER_CERT);
    config.prvkey_pem = (const uint8_t*)LOCAL_WSS_PRIVATE_KEY;
    config.prvkey_len = strlen(LOCAL_WSS_PRIVATE_KEY);
    config.port_secure = LOCAL_WSS_PORT;
    config.httpd.max_open_sockets = 4;
    config.httpd.max_uri_handlers = 8;

    ESP_LOGI(TAG, "Starting SSL Server on port %d...", LOCAL_WSS_PORT);
    esp_err_t ret = httpd_ssl_start(&s_server, &config);
    if (ret == ESP_OK) {
        // Register HTTP URIs
        httpd_uri_t info_uri = {
            .uri = "/info",
            .method = HTTP_GET,
            .handler = info_get_handler,
            .user_ctx = NULL,
            .is_websocket = false
        };
        httpd_register_uri_handler(s_server, &info_uri);

        httpd_uri_t state_uri = {
            .uri = "/state",
            .method = HTTP_GET,
            .handler = state_get_handler,
            .user_ctx = NULL,
            .is_websocket = false
        };
        httpd_register_uri_handler(s_server, &state_uri);

        httpd_uri_t cmd_uri = {
            .uri = "/cmd",
            .method = HTTP_POST,
            .handler = cmd_post_handler,
            .user_ctx = NULL,
            .is_websocket = false
        };
        httpd_register_uri_handler(s_server, &cmd_uri);

        // Register WebSocket URI
        httpd_uri_t ws_uri = {
            .uri = "/ws",
            .method = HTTP_GET,
            .handler = ws_handler,
            .user_ctx = NULL,
            .is_websocket = true
        };
        httpd_register_uri_handler(s_server, &ws_uri);

        ESP_LOGI(TAG, "Secure local server initialized");
    } else {
        ESP_LOGE(TAG, "SSL Startup failure: %s", esp_err_to_name(ret));
    }
}

void local_server_stop(void) {
    if (s_server != NULL) {
        httpd_ssl_stop(s_server);
        s_server = NULL;
        ESP_LOGI(TAG, "Secure local server stopped");
    }
}

bool local_server_is_active(void) {
    return s_server != NULL;
}
