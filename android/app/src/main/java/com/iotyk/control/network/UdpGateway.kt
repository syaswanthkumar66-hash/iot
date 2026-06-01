package com.iotyk.control.network

import android.util.Log
import com.iotyk.control.crypto.IoTykCrypto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.security.SecureRandom

class UdpGateway {
    private val TAG = "UDP_GATEWAY"
    private val secureRandom = SecureRandom()

    // Session store representing active secure channels
    class UdpSession(
        val sessionId: Int,
        val sessionKey: ByteArray,
        var clientCounter: Int = 0,
        var serverCounter: Int = 1000000,
        var lastActive: Long = System.currentTimeMillis()
    )

    private val sessions = mutableMapOf<String, UdpSession>()

    data class DiscoveredDevice(
        val id: String,
        val ip: String,
        val port: Int
    )

    /**
     * Broadcasts discovery frames and listens for replies for 2.5 seconds
     */
    suspend fun discoverDevices(onLog: (String, Map<String, String>?) -> Unit): List<DiscoveredDevice> = withContext(Dispatchers.IO) {
        val discovered = mutableListOf<DiscoveredDevice>()
        var socket: DatagramSocket? = null
        
        try {
            socket = DatagramSocket()
            socket.broadcast = true
            socket.soTimeout = 2500

            // Broadcast: [VERSION=0x00] [CONTROL_DISCOVER=0x00]
            val discoverPacketBytes = byteArrayOf(0x00, 0x00)
            val broadcastAddr = InetAddress.getByName("255.255.255.255")
            val packet = DatagramPacket(discoverPacketBytes, discoverPacketBytes.size, broadcastAddr, 5555)

            onLog("Sending UDP Discover Broadcast: 0x0000 to port 5555", null)
            socket.send(packet)

            val rxBuffer = ByteArray(256)
            val startTime = System.currentTimeMillis()

            while (System.currentTimeMillis() - startTime < 2500) {
                val rxPacket = DatagramPacket(rxBuffer, rxBuffer.size)
                try {
                    socket.receive(rxPacket)
                    val len = rxPacket.length
                    val msg = rxPacket.data

                    // Expected: [0x00] [CONTROL_DEVICE_INFO=0x03] [PORT (2, LE)] [DEV_ID_LEN (1)] [DEVICE_ID]
                    if (len >= 5 && msg[0] == 0x00.toByte() && msg[1] == 0x03.toByte()) {
                        val port = (msg[2].toInt() and 0xFF) or ((msg[3].toInt() and 0xFF) << 8)
                        val devIdLen = msg[4].toInt() and 0xFF
                        if (len >= 5 + devIdLen) {
                            val deviceId = String(msg, 5, devIdLen, Charsets.UTF_8)
                            val ip = rxPacket.address.hostAddress ?: ""
                            
                            val details = mapOf(
                                "Device ID" to deviceId,
                                "IP Address" to ip,
                                "Port" to port.toString(),
                                "Raw Hex" to msg.copyOfRange(0, len).joinToString("") { String.format("%02X", it) }
                            )
                            onLog("Discovered secure UDP target device $deviceId", details)

                            if (discovered.none { it.id == deviceId }) {
                                discovered.add(DiscoveredDevice(deviceId, ip, port))
                            }
                        }
                    }
                } catch (e: java.io.InterruptedIOException) {
                    // Timeout reached
                    break;
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Discovery failed", e)
            onLog("Discovery scan error: ${e.message}", null)
        } finally {
            socket?.close()
        }
        discovered
    }

    /**
     * Executes secure AES-GCM toggle/on/off control payloads
     */
    suspend fun executeCommand(
        deviceId: String,
        ipAddress: String,
        port: Int,
        token: String,
        commandId: Byte,
        relayId: Byte,
        onLog: (String, Map<String, String>?) -> Unit
    ): Int? = withContext(Dispatchers.IO) {
        var socket: DatagramSocket? = null
        try {
            socket = DatagramSocket()
            socket.soTimeout = 3000
            val inetAddress = InetAddress.getByName(ipAddress)

            var session = sessions[deviceId]
            val hasActiveSession = session != null && (System.currentTimeMillis() - session.lastActive < 10 * 60 * 1000)

            if (!hasActiveSession) {
                onLog("Establishing secure session handshake with $deviceId...", null)
                
                // Client challenge: 8 random bytes
                val clientChallenge = ByteArray(8)
                secureRandom.nextBytes(clientChallenge)
                
                // Handshake Packet: [VERSION=0x00] [CONTROL_SESSION_INIT=0x01] [CLIENT_CHALLENGE (8)]
                val handshakePacketBytes = byteArrayOf(0x00, 0x01) + clientChallenge
                val txPacket = DatagramPacket(handshakePacketBytes, handshakePacketBytes.size, inetAddress, port)
                
                onLog("Sending Handshake Request: [0x00 0x01 (8-byte challenge)]", mapOf(
                    "Challenge Hex" to clientChallenge.joinToString("") { String.format("%02X", it) },
                    "Handshake Packet" to handshakePacketBytes.joinToString("") { String.format("%02X", it) }
                ))
                socket.send(txPacket)

                // Receive Handshake Response
                val rxBuffer = ByteArray(256)
                val rxPacket = DatagramPacket(rxBuffer, rxBuffer.size)
                socket.receive(rxPacket)

                val len = rxPacket.length
                val msg = rxPacket.data

                // Expected response: [VERSION=0x00] [CONTROL_SESSION_REPLY=0x02] [SERVER_NONCE (16)] [SESSION_ID (4)]
                if (len == 22 && msg[0] == 0x00.toByte() && msg[1] == 0x02.toByte()) {
                    val serverNonce = msg.copyOfRange(2, 18)
                    val sessionId = IoTykCrypto.readUInt32LE(msg, 18)

                    onLog("Received handshake response from $deviceId", mapOf(
                        "Server Nonce" to serverNonce.joinToString("") { String.format("%02X", it) },
                        "Session ID" to "0x${Integer.toHexString(sessionId).uppercase()} ($sessionId)"
                    ))

                    // Derive session key
                    val sessionKey = IoTykCrypto.deriveSessionKey(token, serverNonce, clientChallenge)
                    session = UdpSession(sessionId, sessionKey)
                    sessions[deviceId] = session

                    onLog("Session derived successfully!", mapOf(
                        "Derived Session Key" to sessionKey.take(4).joinToString("") { String.format("%02X", it) } + "************************"
                    ))
                } else {
                    onLog("Error: Handshake response was malformed or unauthorized.", null)
                    return@withContext null
                }
            }

            // session is guaranteed active here
            session!!
            session.lastActive = System.currentTimeMillis()

            val version = 0x01.toByte() // Secure Packet version
            val counter = session.clientCounter++

            // IV: sessionId (4 bytes) + counter (4 bytes) + Client flag 0xA1 (1 byte) + Padding (3 bytes 0x00)
            val iv = ByteArray(12)
            IoTykCrypto.writeUInt32LE(session.sessionId, iv, 0)
            IoTykCrypto.writeUInt32LE(counter, iv, 4)
            iv[8] = 0xA1.toByte()

            // AAD: VERSION (1 byte) + sessionId (4 bytes) + counter (4 bytes)
            val aad = ByteArray(9)
            aad[0] = version
            IoTykCrypto.writeUInt32LE(session.sessionId, aad, 1)
            IoTykCrypto.writeUInt32LE(counter, aad, 5)

            // Plaintext Payload: [COMMAND_ID] [RELAY_ID]
            val plaintext = byteArrayOf(commandId, relayId)

            // Encrypt AES-GCM
            val (ciphertext, tag) = IoTykCrypto.encryptAesGcm(session.sessionKey, iv, aad, plaintext)

            // Final Packet: [VERSION=0x01] [session_id (4)] [counter (4)] [IV (12)] [ciphertext] [tag (16)]
            val secureHeader = byteArrayOf(version) + aad.copyOfRange(1, 5) + aad.copyOfRange(5, 9)
            val securePacketBytes = secureHeader + iv + ciphertext + tag

            onLog("Sending secure AES-GCM encrypted command", mapOf(
                "Plaintext Ops" to "Opcode: $commandId, Target: $relayId",
                "IV Nonce" to iv.joinToString("") { String.format("%02X", it) },
                "AAD Header" to aad.joinToString("") { String.format("%02X", it) },
                "Ciphertext" to ciphertext.joinToString("") { String.format("%02X", it) },
                "Integrity Tag" to tag.joinToString("") { String.format("%02X", it) }
            ))

            val securePacket = DatagramPacket(securePacketBytes, securePacketBytes.size, inetAddress, port)
            socket.send(securePacket)

            // Listen for command response
            val rxBuffer = ByteArray(256)
            val rxPacket = DatagramPacket(rxBuffer, rxBuffer.size)
            socket.receive(rxPacket)

            val len = rxPacket.length
            val msg = rxPacket.data

            if (len < 21 + 16) {
                onLog("Error: Response packet too short.", null)
                return@withContext null
            }

            val resVer = msg[0]
            val resSessionId = IoTykCrypto.readUInt32LE(msg, 1)
            val resCounter = IoTykCrypto.readUInt32LE(msg, 5)
            val resIv = msg.copyOfRange(9, 21)
            val resTag = msg.copyOfRange(len - 16, len)
            val resCiphertext = msg.copyOfRange(21, len - 16)

            if (resVer != 0x01.toByte()) {
                onLog("Error: Decrypt mismatch - packet version is $resVer instead of 0x01.", null)
                return@withContext null
            }
            if (resSessionId != session.sessionId) {
                onLog("Error: Session ID mismatch.", null)
                return@withContext null
            }

            // Verify Server Counter Nonce (0xA2 direction)
            val expectedIv = ByteArray(12)
            IoTykCrypto.writeUInt32LE(session.sessionId, expectedIv, 0)
            IoTykCrypto.writeUInt32LE(resCounter, expectedIv, 4)
            expectedIv[8] = 0xA2.toByte()

            if (!resIv.contentEquals(expectedIv)) {
                onLog("Error: Server counter nonce verification failed.", null)
                return@withContext null
            }

            val resAad = ByteArray(9)
            resAad[0] = resVer
            IoTykCrypto.writeUInt32LE(resSessionId, resAad, 1)
            IoTykCrypto.writeUInt32LE(resCounter, resAad, 5)

            // Decrypt Response
            val resPlaintext = IoTykCrypto.decryptAesGcm(session.sessionKey, resIv, resAad, resCiphertext, resTag)

            val opResponse = resPlaintext[0].toInt() and 0xFF
            val relayIndex = resPlaintext[1].toInt() and 0xFF
            val relayState = resPlaintext[2].toInt() and 0xFF

            onLog("Verified decrypted response from server", mapOf(
                "Decrypted Bytes" to resPlaintext.joinToString("") { String.format("%02X", it) },
                "Opcode" to "OPCODE_ACK ($opResponse)",
                "Relay ID" to relayIndex.toString(),
                "State" to if (relayState == 1) "ON" else "OFF"
            ))

            return@withContext relayState

        } catch (e: Exception) {
            Log.e(TAG, "Command execution failed", e)
            onLog("UDP command error: ${e.message}", null)
        } finally {
            socket?.close()
        }
        null
    }
}
