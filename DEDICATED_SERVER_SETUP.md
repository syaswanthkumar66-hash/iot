# IoTYK Dedicated Server Setup Guide

This guide details how to set up the dedicated backend for IoTYK using **Render**, **Supabase**, and **EMQX Cloud**.

## 1. Prerequisites
- **Supabase Account**: For the PostgreSQL database.
- **EMQX Cloud Account**: For the MQTT broker and device management.
- **Render Account**: For hosting the Node.js server.
- **GitHub Repository**: To host your server code for auto-deployment.

## 2. Database Setup (Supabase)
1. Create a new project in Supabase.
2. Go to the **SQL Editor** and run the schema provided in `schema.sql` (or see the schema section in the user request).
3. Go to **Project Settings -> Database** and copy the **Connection string** (URI mode). It should look like:
   `postgres://postgres:[PASSWORD]@[HOST]:5432/postgres`
   Save this as `DATABASE_URL`.

## 3. MQTT Broker Setup (EMQX Cloud)
1. Create a new deployment in EMQX Cloud.
2. Go to **Authentication** and create an authentication source (e.g., MySQL or built-in).
3. Go to **API Key** and create a new key. Save the `App ID` and `App Secret`.
4. Copy the **Broker URL** (e.g., `xxxx.ala.us-east-1.emqxsl.com`).
5. Create a service user in EMQX with administrative permissions for the MQTT bridge. Save as `MQTT_SERVICE_USER` and `MQTT_SERVICE_PASS`.

## 4. Environment Variables
Configure the following variables in your Render Dashboard:

| Variable | Description |
| :--- | :--- |
| `DATABASE_URL` | Supabase Postgres connection string |
| `AES_KEY` | 32-character string for credential encryption |
| `JWT_SECRET` | Secret for user sessions |
| `FACTORY_API_KEY` | Secret for your Factory Admin dashboard |
| `EMQX_API_URL` | EMQX Cloud API URL (usually ends in `/api/v5`) |
| `EMQX_APP_ID` | EMQX API Key Name |
| `EMQX_APP_SECRET` | EMQX API Key Secret |
| `EMQX_BROKER_URL` | Full MQTT URL (e.g., `mqtts://...:8883`) |
| `EMQX_MQTT_HOST` | Hostname only (e.g., `xxxx.ala.us-east-1.emqxsl.com`) |
| `MQTT_SERVICE_USER` | Admin MQTT user for status monitoring |
| `MQTT_SERVICE_PASS` | Password for the admin MQTT user |

## 5. Deployment on Render
1. Connect your GitHub repository to Render.
2. Select the **Web Service** type.
3. Render will automatically detect the `render.yaml` file and prompt you for the environment variables.
4. Once deployed, your server will be available at `https://your-app-name.onrender.com`.

## 6. Accessing the Factory Admin Dashboard
1. Open your browser to `https://your-app-name.onrender.com/index.html`.
2. Enter your `FACTORY_API_KEY` to authenticate.
3. You can now provision new devices, download firmware ZIPs, and manage existing hardware.

## 7. Connecting the Mobile App
Update your mobile app's API endpoint (usually in `src/config/env.js`) to point to your new Render URL.
