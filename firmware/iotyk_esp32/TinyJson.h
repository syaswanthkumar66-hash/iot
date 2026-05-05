#ifndef TINY_JSON_H
#define TINY_JSON_H

#include <Arduino.h>

class TinyJson {
public:
    // Simple parser to extract an integer value for a key like "relay": 1
    static int getInt(String json, String key) {
        int keyPos = json.indexOf("\"" + key + "\"");
        if (keyPos == -1) return -1;
        
        int colonPos = json.indexOf(":", keyPos);
        if (colonPos == -1) return -1;
        
        // Find start of number
        int start = colonPos + 1;
        while (start < (int)json.length() && !isdigit(json[start]) && json[start] != '-') start++;
        
        // Find end of number (integers only, no decimal)
        int end = start;
        while (end < (int)json.length() && (isdigit(json[end]) || json[end] == '-')) end++;
        
        if (start == end) return -1;
        return json.substring(start, end).toInt();
    }

    // Simple parser for boolean value like "state": true
    static bool getBool(String json, String key) {
        int keyPos = json.indexOf("\"" + key + "\"");
        if (keyPos == -1) return false;
        
        int colonPos = json.indexOf(":", keyPos);
        if (colonPos == -1) return false;
        
        String val = json.substring(colonPos + 1);
        val.trim();
        return val.startsWith("true");
    }

    // Simple parser for string value like "power": "on"
    static String getString(String json, String key) {
        int keyPos = json.indexOf("\"" + key + "\"");
        if (keyPos == -1) return "";
        
        int colonPos = json.indexOf(":", keyPos);
        if (colonPos == -1) return "";
        
        int start = colonPos + 1;
        while (start < (int)json.length() && json[start] != '"') start++;
        start++; // Skip opening quote
        
        int end = start;
        while (end < (int)json.length() && json[end] != '"') end++;
        
        if (start >= end) return "";
        return json.substring(start, end);
    }

    // Generator for current state
    static String createState(String deviceId, int relayCount, bool* states) {
        String json = "{";
        json += "\"id\":\"" + deviceId + "\",";
        json += "\"relays\":[";
        for (int i = 0; i < relayCount; i++) {
            json += states[i] ? "true" : "false";
            if (i < relayCount - 1) json += ",";
        }
        json += "]}";
        return json;
    }
};

#endif
