package com.iotyk.control.network

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.*
import org.json.JSONObject
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCancellableCoroutine

class WssGateway {
    private val TAG = "WSS_GATEWAY"

    /**
     * Obtains an OkHttpClient that ignores self-signed certificate checks
     */
    private fun getUnsafeOkHttpClient(): OkHttpClient {
        try {
            // Create a trust manager that does not validate certificate chains
            val trustAllCerts = arrayOf<TrustManager>(object : X509TrustManager {
                override fun checkClientTrusted(chain: Array<java.security.cert.X509Certificate>, authType: String) {}
                override fun checkServerTrusted(chain: Array<java.security.cert.X509Certificate>, authType: String) {}
                override fun getAcceptedIssuers(): Array<java.security.cert.X509Certificate> = arrayOf()
            })

            // Install the all-trusting trust manager
            val sslContext = SSLContext.getInstance("SSL")
            sslContext.init(null, trustAllCerts, java.security.SecureRandom())
            
            // Create an ssl socket factory with our all-trusting manager
            val sslSocketFactory = sslContext.socketFactory

            val builder = OkHttpClient.Builder()
            builder.sslSocketFactory(sslSocketFactory, trustAllCerts[0] as X509TrustManager)
            builder.hostnameVerifier { _, _ -> true }
            builder.connectTimeout(5, TimeUnit.SECONDS)
            builder.readTimeout(5, TimeUnit.SECONDS)
            
            return builder.build()
        } catch (e: Exception) {
            throw RuntimeException(e)
        }
    }

    /**
     * Connects, executes the secure JSON command, and returns the resulting state (1/0)
     */
    suspend fun executeWssCommand(
        ipAddress: String,
        port: Int,
        token: String,
        action: String, // "RELAY_ON" | "RELAY_OFF"
        onLog: (String, Map<String, String>?) -> Unit
    ): Int? = withContext(Dispatchers.IO) {
        val client = getUnsafeOkHttpClient()
        val url = "wss://$ipAddress:$port/"
        
        onLog("Opening WSS TLS proxy tunnel to $url...", null)

        val request = Request.Builder().url(url).build()

        suspendCancellableCoroutine { continuation ->
            var webSocket: WebSocket? = null

            val listener = object : WebSocketListener() {
                override fun onOpen(ws: WebSocket, response: Response) {
                    webSocket = ws
                    val jsonCmd = JSONObject().apply {
                        put("token", token)
                        put("action", action)
                    }

                    onLog("Sending secure JSON frames over WSS socket link", mapOf(
                        "JSON Payload" to jsonCmd.toString()
                    ))
                    ws.send(jsonCmd.toString())
                }

                override fun onMessage(ws: WebSocket, text: String) {
                    onLog("Received TLS encrypted WSS frame response", mapOf(
                        "WSS Reply" to text
                    ))

                    try {
                        val jsonRes = JSONObject(text)
                        if (jsonRes.optString("status") == "ok") {
                            val stateValue = if (action == "RELAY_ON") 1 else 0
                            continuation.resume(stateValue)
                        } else {
                            onLog("Error: WSS command failed: ${jsonRes.optString("error", "Unknown error")}", null)
                            continuation.resume(null)
                        }
                    } catch (e: Exception) {
                        onLog("Error: Failed to parse WSS JSON: ${e.message}", null)
                        continuation.resume(null)
                    } finally {
                        ws.close(1000, "Done")
                    }
                }

                override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                    Log.e(TAG, "WSS Socket failure", t)
                    onLog("Secure WSS proxy connection error: ${t.message}", null)
                    continuation.resume(null)
                }
            }

            client.newWebSocket(request, listener)

            continuation.invokeOnCancellation {
                webSocket?.close(1001, "Cancelled")
            }
        }
    }
}
