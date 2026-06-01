package com.iotyk.control.crypto

import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

object IoTykCrypto {
    private const val HMAC_ALGO = "HmacSHA256"

    /**
     * Extracts pseudo-random key using HMAC-SHA256
     */
    private fun hkdfExtract(salt: ByteArray, ikm: ByteArray): ByteArray {
        val mac = Mac.getInstance(HMAC_ALGO)
        mac.init(SecretKeySpec(salt, HMAC_ALGO))
        return mac.doFinal(ikm)
    }

    /**
     * Expands pseudo-random key into output keying material
     */
    private fun hkdfExpand(prk: ByteArray, info: ByteArray, length: Int): ByteArray {
        val mac = Mac.getInstance(HMAC_ALGO)
        mac.init(SecretKeySpec(prk, HMAC_ALGO))
        val okm = ByteArray(length)
        var t = ByteArray(0)
        var offset = 0
        var count = 1
        
        while (offset < length) {
            mac.reset()
            mac.update(t)
            mac.update(info)
            mac.update(count.toByte())
            t = mac.doFinal()
            val copyLen = minOf(t.size, length - offset)
            System.arraycopy(t, 0, okm, offset, copyLen)
            offset += copyLen
            count++
        }
        return okm
    }

    /**
     * Derives a 32-byte session key matching the IoTYK ESP32 HKDF specification
     */
    fun deriveSessionKey(token: String, serverNonce: ByteArray, clientChallenge: ByteArray): ByteArray {
        val tokenBytes = token.toByteArray(Charsets.UTF_8)
        val ikm = tokenBytes + serverNonce + clientChallenge
        val salt = ByteArray(32) // 32-bytes zero salt
        val info = "IoTYK-Session-Key".toByteArray(Charsets.UTF_8)
        
        val prk = hkdfExtract(salt, ikm)
        return hkdfExpand(prk, info, 32)
    }

    /**
     * Encrypts plaintext command payload using AES-256-GCM
     * @return Pair of (Ciphertext, 16-byte Auth Tag)
     */
    fun encryptAesGcm(key: ByteArray, iv: ByteArray, aad: ByteArray, plaintext: ByteArray): Pair<ByteArray, ByteArray> {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val keySpec = SecretKeySpec(key, "AES")
        val gcmSpec = GCMParameterSpec(128, iv)
        cipher.init(Cipher.ENCRYPT_MODE, keySpec, gcmSpec)
        cipher.updateAAD(aad)
        
        val ciphertextAndTag = cipher.doFinal(plaintext)
        val ciphertextLen = ciphertextAndTag.size - 16
        val ciphertext = ciphertextAndTag.copyOfRange(0, ciphertextLen)
        val tag = ciphertextAndTag.copyOfRange(ciphertextLen, ciphertextAndTag.size)
        return Pair(ciphertext, tag)
    }

    /**
     * Decrypts ESP32 server response using AES-256-GCM
     */
    fun decryptAesGcm(key: ByteArray, iv: ByteArray, aad: ByteArray, ciphertext: ByteArray, tag: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val keySpec = SecretKeySpec(key, "AES")
        val gcmSpec = GCMParameterSpec(128, iv)
        cipher.init(Cipher.DECRYPT_MODE, keySpec, gcmSpec)
        cipher.updateAAD(aad)
        
        return cipher.doFinal(ciphertext + tag)
    }

    /**
     * Helper to write a uint32 into a byte array in Little-Endian format
     */
    fun writeUInt32LE(value: Int, buffer: ByteArray, offset: Int) {
        buffer[offset] = (value and 0xFF).toByte()
        buffer[offset + 1] = ((value shr 8) and 0xFF).toByte()
        buffer[offset + 2] = ((value shr 16) and 0xFF).toByte()
        buffer[offset + 3] = ((value shr 24) and 0xFF).toByte()
    }

    /**
     * Helper to read a Little-Endian uint32 from a byte array
     */
    fun readUInt32LE(buffer: ByteArray, offset: Int): Int {
        return (buffer[offset].toInt() and 0xFF) or
               ((buffer[offset + 1].toInt() and 0xFF) << 8) or
               ((buffer[offset + 2].toInt() and 0xFF) << 16) or
               ((buffer[offset + 3].toInt() and 0xFF) << 24)
    }
}
