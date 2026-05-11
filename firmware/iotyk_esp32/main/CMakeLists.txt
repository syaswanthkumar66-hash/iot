set(extra_reqs)
if(NOT IDF_TARGET STREQUAL "esp32s2")
    list(APPEND extra_reqs esp-nimble-cpp bt)
endif()

idf_component_register(SRCS "main.cpp"
                            "nvs_manager.cpp"
                            "relay_controller.cpp"
                            "wifi_manager.cpp"
                            "ble_provision.cpp"
                            "local_server.cpp"
                            "mqtt_manager.cpp"
                       INCLUDE_DIRS "."
                       REQUIRES nvs_flash esp_wifi esp_event esp_http_server esp_driver_gpio esp_driver_tsens mdns json ${extra_reqs})
