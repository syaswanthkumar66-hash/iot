# CMakeLists.txt for native main component in ESP-IDF (Pure C++ / No Arduino)
idf_component_register(SRCS "main.cpp"
                            "nvs_manager.cpp"
                            "relay_controller.cpp"
                            "wifi_manager.cpp"
                            "ble_provision.cpp"
                            "local_server.cpp"
                            "mqtt_manager.cpp"
                       INCLUDE_DIRS "."
                       REQUIRES nvs_flash esp_wifi esp_event esp_http_server mqtt nimble json)
