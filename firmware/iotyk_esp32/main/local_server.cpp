#include "local_server.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_random.h"
#include "nvs_manager.h"
#include "config.h"
#include "psa/crypto.h"
#include "esp_mac.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char* TAG = "WS_SRV";
static httpd_handle_t s_server = NULL;
static command_callback_t s_on_command = NULL;

// Stateful connection context for WebSocket authentication
typedef struct {
    char nonce[33];
    bool authenticated;
} ws_session_ctx_t;

// Constant-time string comparison to prevent timing attacks
static bool constant_time_compare(const char* a, const char* b, size_t len) {
    if (strlen(a) < len || strlen(b) < len) return false;
    int result = 0;
    for (size_t i = 0; i < len; i++) {
        result |= (a[i] ^ b[i]);
    }
    return (result == 0);
}

// Compute HMAC-SHA256(key=local_token, data=nonce)
static void compute_hmac(const char* token, const char* nonce, char* out_hex) {
    psa_crypto_init();

    psa_key_attributes_t attributes = PSA_KEY_ATTRIBUTES_INIT;
    psa_set_key_usage_flags(&attributes, PSA_KEY_USAGE_SIGN_MESSAGE);
    psa_set_key_algorithm(&attributes, PSA_ALG_HMAC(PSA_ALG_SHA_256));
    psa_set_key_type(&attributes, PSA_KEY_TYPE_HMAC);

    psa_key_id_t key_id = 0;
    psa_status_t status = psa_import_key(&attributes, 
                                         (const uint8_t*)token, 
                                         strlen(token), 
                                         &key_id);
    if (status != PSA_SUCCESS) {
        memset(out_hex, 0, 65);
        return;
    }

    uint8_t hmac_buf[32];
    size_t mac_length = 0;
    status = psa_mac_compute(
        key_id,
        PSA_ALG_HMAC(PSA_ALG_SHA_256),
        (const uint8_t*)nonce,
        32,
        hmac_buf,
        sizeof(hmac_buf),
        &mac_length
    );

    psa_destroy_key(key_id);

    if (status != PSA_SUCCESS) {
        memset(out_hex, 0, 65);
        return;
    }

    for (int i = 0; i < 32; i++) {
        sprintf(&out_hex[i * 2], "%02x", hmac_buf[i]);
    }
    out_hex[64] = '\0';
}

// GET /info (Public Diagnostic Info)
static esp_err_t info_get_handler(httpd_req_t *req) {
    char d_id[64] = {0};
    
    nvs_manager_get_str(KEY_DEVICE_ID, d_id, sizeof(d_id), FACTORY_DEVICE_ID);
    if (strlen(d_id) == 0) {
        uint8_t mac[6];
        esp_efuse_mac_get_default(mac);
        snprintf(d_id, sizeof(d_id), "iotyk-%02X%02X%02X%02X%02X%02X", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    }

    char resp[256];
    snprintf(resp, sizeof(resp), "{\"id\":\"%s\",\"type\":\"esp32_relay\",\"fw\":\"%s\",\"cap\":{\"ota\":1,\"temp\":1,\"r4\":1}}", d_id, FIRMWARE_VERSION);

    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, resp);
    return ESP_OK;
}

// WebSocket Event handler (GET /ws)
static esp_err_t ws_handler(httpd_req_t *req) {
    if (req->method == HTTP_GET) {
        // Handshake completed: allocate context
        ws_session_ctx_t *ctx = (ws_session_ctx_t*)calloc(1, sizeof(ws_session_ctx_t));
        if (!ctx) {
            ESP_LOGE(TAG, "Out of memory allocating session context");
            return ESP_ERR_NO_MEM;
        }

        // Generate 16-byte random nonce
        uint8_t rand_bytes[16];
        esp_fill_random(rand_bytes, 16);
        for (int i = 0; i < 16; i++) {
            sprintf(&ctx->nonce[i * 2], "%02x", rand_bytes[i]);
        }
        ctx->nonce[32] = '\0';
        ctx->authenticated = false;

        req->sess_ctx = ctx;
        req->free_ctx = free; // Cleaned up automatically on socket closure

        ESP_LOGI(TAG, "WS handshake completed. Sent challenge nonce: %s", ctx->nonce);
        printf("Local client connected\n");

        char nonce_payload[64];
        snprintf(nonce_payload, sizeof(nonce_payload), "{\"nonce\":\"%s\"}", ctx->nonce);

        httpd_ws_frame_t out_pkt;
        memset(&out_pkt, 0, sizeof(httpd_ws_frame_t));
        out_pkt.payload = (uint8_t*)nonce_payload;
        out_pkt.len = strlen(nonce_payload);
        out_pkt.type = HTTPD_WS_TYPE_TEXT;
        return httpd_ws_send_frame(req, &out_pkt);
    }

    ws_session_ctx_t *ctx = (ws_session_ctx_t*)req->sess_ctx;
    if (!ctx) {
        return ESP_FAIL;
    }

    httpd_ws_frame_t ws_pkt;
    uint8_t *buf = NULL;
    memset(&ws_pkt, 0, sizeof(httpd_ws_frame_t));
    ws_pkt.type = HTTPD_WS_TYPE_TEXT;

    esp_err_t ret = httpd_ws_recv_frame(req, &ws_pkt, 0);
    if (ret != ESP_OK) {
        return ret;
    }

    if (ws_pkt.len > 0) {
        buf = (uint8_t*)calloc(1, ws_pkt.len + 1);
        if (!buf) {
            return ESP_ERR_NO_MEM;
        }
        ws_pkt.payload = buf;
        ret = httpd_ws_recv_frame(req, &ws_pkt, ws_pkt.len);
        if (ret != ESP_OK) {
            free(buf);
            return ret;
        }
    }

    if (ws_pkt.type == HTTPD_WS_TYPE_TEXT && ws_pkt.payload) {
        std::string msg((char*)ws_pkt.payload, ws_pkt.len);

        if (!ctx->authenticated) {
            // Intercept auth payload: expect {"auth":"<hmac_hex>"}
            size_t auth_pos = msg.find("\"auth\":\"");
            if (auth_pos != std::string::npos) {
                size_t start = auth_pos + 8;
                size_t end = msg.find("\"", start);
                if (end != std::string::npos) {
                    std::string client_auth = msg.substr(start, end - start);
                    
                    // Fetch token from redundant NVS config
                    io_tyk_config_t cfg;
                    char stored_token[64] = {0};
                    if (nvs_manager_load_config(&cfg) == ESP_OK && strlen(cfg.local_token) > 0) {
                        strncpy(stored_token, cfg.local_token, sizeof(stored_token) - 1);
                    } else {
                        strncpy(stored_token, FACTORY_LOCAL_TOKEN, sizeof(stored_token) - 1);
                    }

                    char expected_hmac[65];
                    compute_hmac(stored_token, ctx->nonce, expected_hmac);

                    if (constant_time_compare(client_auth.c_str(), expected_hmac, 64)) {
                        ctx->authenticated = true;
                        ESP_LOGI(TAG, "WS Authentication SUCCESSFUL");
                        
                        char auth_ok_resp[] = "{\"status\":\"auth_ok\"}";
                        httpd_ws_frame_t out_pkt;
                        memset(&out_pkt, 0, sizeof(httpd_ws_frame_t));
                        out_pkt.payload = (uint8_t*)auth_ok_resp;
                        out_pkt.len = strlen(auth_ok_resp);
                        out_pkt.type = HTTPD_WS_TYPE_TEXT;
                        httpd_ws_send_frame(req, &out_pkt);
                    } else {
                        ESP_LOGE(TAG, "WS Authentication FAILED! expected: %s", expected_hmac);
                        char auth_fail_resp[] = "{\"e\":101}";
                        httpd_ws_frame_t out_pkt;
                        memset(&out_pkt, 0, sizeof(httpd_ws_frame_t));
                        out_pkt.payload = (uint8_t*)auth_fail_resp;
                        out_pkt.len = strlen(auth_fail_resp);
                        out_pkt.type = HTTPD_WS_TYPE_TEXT;
                        httpd_ws_send_frame(req, &out_pkt);
                        
                        // Force session termination
                        free(buf);
                        return ESP_FAIL;
                    }
                }
            } else {
                // Not authenticated and payload is not auth, reject
                char auth_fail_resp[] = "{\"e\":101}";
                httpd_ws_frame_t out_pkt;
                memset(&out_pkt, 0, sizeof(httpd_ws_frame_t));
                out_pkt.payload = (uint8_t*)auth_fail_resp;
                out_pkt.len = strlen(auth_fail_resp);
                out_pkt.type = HTTPD_WS_TYPE_TEXT;
                httpd_ws_send_frame(req, &out_pkt);
            }
        } else {
            // Already authenticated, forward commands directly to command parser
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
    }

    free(buf);
    return ESP_OK;
}

void local_server_start(command_callback_t on_command) {
    if (s_server != NULL) return;
    s_on_command = on_command;

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.port = LOCAL_HTTP_PORT;
    config.max_open_sockets = 4;
    config.max_uri_handlers = 4;

    ESP_LOGI(TAG, "Starting plain WebSocket Server on port %d...", LOCAL_HTTP_PORT);
    esp_err_t ret = httpd_start(&s_server, &config);
    if (ret == ESP_OK) {
        httpd_uri_t info_uri = {
            .uri = "/info",
            .method = HTTP_GET,
            .handler = info_get_handler,
            .user_ctx = NULL,
            .is_websocket = false
        };
        httpd_register_uri_handler(s_server, &info_uri);

        httpd_uri_t ws_uri = {
            .uri = "/ws",
            .method = HTTP_GET,
            .handler = ws_handler,
            .user_ctx = NULL,
            .is_websocket = true
        };
        httpd_register_uri_handler(s_server, &ws_uri);

        ESP_LOGI(TAG, "Plain WS server initialized.");
    } else {
        ESP_LOGE(TAG, "HTTP/WS Startup failure: %s", esp_err_to_name(ret));
    }
}

void local_server_stop(void) {
    if (s_server != NULL) {
        httpd_stop(s_server);
        s_server = NULL;
        ESP_LOGI(TAG, "WebSocket server stopped");
    }
}

bool local_server_is_active(void) {
    return s_server != NULL;
}
