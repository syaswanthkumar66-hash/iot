package com.iotyk.control

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.iotyk.control.network.UdpGateway
import com.iotyk.control.network.WssGateway
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// --- Theme Tokens ---
val BgPrimary = Color(0xFF060813)
val BgSecondary = Color(0xFF0C0F24)
val GlassBg = Color(0x730D1127)
val GlassBorder = Color(0x0AFFFFFF)
val TextPrimary = Color(0xFFF1F3F9)
val TextSecondary = Color(0xFF8E99B7)
val TextMuted = Color(0xFF5E6681)

val CyanNeon = Color(0xFF00F2FE)
val BlueNeon = Color(0xFF3B82F6)
val PurpleNeon = Color(0xFFA855F7)
val MagentaNeon = Color(0xFFFF2A85)
val EmeraldNeon = Color(0xFF10B981)
val RoseNeon = Color(0xFFEF4444)
val AmberNeon = Color(0xFFF59E0B)

data class Device(
    val id: String,
    val name: String,
    val ip: String,
    val port: Int,
    val protocol: String, // "UDP" | "WSS"
    val token: String,
    var state: Int = 0,
    var online: Boolean = false
)

data class TerminalLog(
    val timestamp: String,
    val type: String, // "info" | "tx" | "rx" | "crypto" | "success" | "error"
    val message: String,
    val details: Map<String, String>? = null
)

class MainActivity : ComponentActivity() {
    private val udpGateway = UdpGateway()
    private val wssGateway = WssGateway()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            IoTykApp()
        }
    }

    @OptIn(ExperimentalMaterial3Api::class)
    @Composable
    fun IoTykApp() {
        val coroutineScope = rememberCoroutineScope()
        
        // --- State Store ---
        val devices = remember {
            mutableStateListOf(
                Device("ESP32-TEST-E0C656", "Living Room (Secure UDP)", "192.168.1.100", 5555, "UDP", "test_tok_5b08259c97eb798d9664", 0, true),
                Device("ESP32-439D16", "Master Bedroom (Secure WSS)", "192.168.1.101", 82, "WSS", "f9ab0ffa09911e5606c5fa5757b1367dd75ec88f", 0, true)
            )
        }
        
        val logs = remember {
            mutableStateListOf(
                TerminalLog(getCurrentTime(), "info", "NATIVE Android cryptographic sniffer initialized."),
                TerminalLog(getCurrentTime(), "info", "Waiting for secure UDP/WSS network traffic...")
            )
        }

        var isScanning by remember { mutableStateOf(false) }
        var activeSessionsCount by remember { mutableStateOf(0) }
        var txCounter by remember { mutableStateOf(0) }
        var rxCounter by remember { mutableStateOf(0) }

        // Discovery Scanner list
        val discoveredDevices = remember { mutableStateListOf<UdpGateway.DiscoveredDevice>() }

        // Form Fields State
        var friendlyName by remember { mutableStateOf("") }
        var devId by remember { mutableStateOf("") }
        var ipAddr by remember { mutableStateOf("") }
        var portStr by remember { mutableStateOf("") }
        var protocolSelection by remember { mutableStateOf("UDP") }
        var securityToken by remember { mutableStateOf("") }

        // Helper: Append log safely from anywhere
        fun addLog(type: String, message: String, details: Map<String, String>? = null) {
            logs.add(TerminalLog(getCurrentTime(), type, message, details))
            if (type == "tx") txCounter++
            if (type == "rx") rxCounter++
            if (type == "crypto") activeSessionsCount = 1 // Simplified representation
        }

        // --- Layout ---
        Scaffold(
            modifier = Modifier.fillMaxSize(),
            topBar = {
                TopAppBar(
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = BgSecondary),
                    title = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(Brush.linearGradient(listOf(CyanNeon, BlueNeon))),
                                contentAlignment = Alignment.Center
                            ) {
                                Text("🔒", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                            }
                            Spacer(modifier = Modifier.width(12.dp))
                            Column {
                                Text("IoTYK", color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = 18.sp, fontFamily = FontFamily.SansSerif)
                                Text("SECURE CONTROL CENTER", color = CyanNeon, fontWeight = FontWeight.Bold, fontSize = 9.sp, letterSpacing = 1.sp)
                            }
                        }
                    },
                    actions = {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .clip(RoundedCornerShape(30.dp))
                                .background(Color(0x0DFFFFFF))
                                .padding(horizontal = 12.dp, vertical = 6.dp)
                                .border(1.dp, Color(0x0AFFFFFF), RoundedCornerShape(30.dp))
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(EmeraldNeon)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("GATEWAY ONLINE", color = TextSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                )
            }
        ) { paddingValues ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(BgPrimary)
                    .padding(paddingValues)
            ) {
                // Background decorative soft glowing blur circles
                Box(modifier = Modifier.offset(x = (-100).dp, y = 50.dp).size(200.dp).blur(100.dp).clip(CircleShape).background(CyanNeon.copy(alpha = 0.08f)))
                Box(modifier = Modifier.align(Alignment.BottomEnd).offset(x = 100.dp, y = 100.dp).size(250.dp).blur(120.dp).clip(CircleShape).background(PurpleNeon.copy(alpha = 0.08f)))

                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(24.dp)
                ) {
                    
                    // --- 1. Network Discovery ---
                    item {
                        GlassCard {
                            Text("Network Discovery Scanner", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                            Spacer(modifier = Modifier.height(6.dp))
                            Text(
                                "Natively broadcast UDP packets to find secure ESP32 smart relay nodes on your subnet.",
                                color = TextSecondary,
                                fontSize = 11.sp,
                                lineHeight = 14.sp
                            )
                            Spacer(modifier = Modifier.height(16.dp))

                            Button(
                                onClick = {
                                    coroutineScope.launch {
                                        isScanning = true
                                        discoveredDevices.clear()
                                        addLog("info", "Starting native UDP broadcast subnet scan...")
                                        
                                        val found = udpGateway.discoverDevices { msg, details ->
                                            val type = if (msg.contains("Discovery")) "info" else "rx"
                                            addLog(type, msg, details)
                                        }
                                        
                                        discoveredDevices.addAll(found)
                                        isScanning = false
                                        addLog("success", "Scan complete. Discovered ${found.size} active hardware node(s).")
                                    }
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = CyanNeon),
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(8.dp),
                                enabled = !isScanning
                            ) {
                                if (isScanning) {
                                    CircularProgressIndicator(color = BgPrimary, modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                                    Spacer(modifier = Modifier.width(10.dp))
                                    Text("SCANNING SUBNET...", color = BgPrimary, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                } else {
                                    Text("SCAN SUBNET VIA UDP", color = BgPrimary, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                }
                            }

                            if (discoveredDevices.isNotEmpty()) {
                                Spacer(modifier = Modifier.height(16.dp))
                                Text("Discovered Nodes:", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                Spacer(modifier = Modifier.height(8.dp))
                                discoveredDevices.forEach { dev ->
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(Color(0x1A000000))
                                            .padding(8.dp),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Column {
                                            Text(dev.id, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                            Text("${dev.ip}:${dev.port} (UDP)", color = TextSecondary, fontSize = 10.sp)
                                        }
                                        Button(
                                            onClick = {
                                                friendlyName = "Room (${dev.id.substring(Math.max(0, dev.id.length - 6))})"
                                                devId = dev.id
                                                ipAddr = dev.ip
                                                portStr = dev.port.toString()
                                                protocolSelection = dev.protocol
                                                securityToken = "test_tok_5b08259c97eb798d9664"
                                                addLog("info", "Imported scan configurations for ${dev.id}.")
                                            },
                                            colors = ButtonDefaults.buttonColors(containerColor = BlueNeon),
                                            shape = RoundedCornerShape(6.dp),
                                            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 2.dp),
                                            modifier = Modifier.height(28.dp)
                                        ) {
                                            Text("IMPORT", color = Color.White, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // --- 2. Manual Add Controller Form ---
                    item {
                        GlassCard {
                            Text("Register Controller Node", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                            Spacer(modifier = Modifier.height(12.dp))

                            OutlinedTextField(
                                value = friendlyName,
                                onValueChange = { friendlyName = it },
                                label = { Text("Friendly Name") },
                                modifier = Modifier.fillMaxWidth(),
                                colors = formTextFieldColors()
                            )
                            Spacer(modifier = Modifier.height(10.dp))

                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                OutlinedTextField(
                                    value = devId,
                                    onValueChange = { devId = it },
                                    label = { Text("Device ID") },
                                    modifier = Modifier.weight(1f),
                                    colors = formTextFieldColors()
                                )
                                OutlinedTextField(
                                    value = ipAddr,
                                    onValueChange = { ipAddr = it },
                                    label = { Text("IP Address") },
                                    modifier = Modifier.weight(1f),
                                    colors = formTextFieldColors()
                                )
                            }
                            Spacer(modifier = Modifier.height(10.dp))

                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                OutlinedTextField(
                                    value = portStr,
                                    onValueChange = { portStr = it },
                                    label = { Text("Port") },
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                    modifier = Modifier.weight(1f),
                                    colors = formTextFieldColors()
                                )
                                Column(modifier = Modifier.weight(1f)) {
                                    Text("Protocol", color = TextSecondary, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        RadioButton(
                                            selected = protocolSelection == "UDP",
                                            onClick = { protocolSelection = "UDP" },
                                            colors = RadioButtonDefaults.colors(selectedColor = CyanNeon)
                                        )
                                        Text("UDP", color = Color.White, fontSize = 12.sp)
                                        Spacer(modifier = Modifier.width(6.dp))
                                        RadioButton(
                                            selected = protocolSelection == "WSS",
                                            onClick = { protocolSelection = "WSS" },
                                            colors = RadioButtonDefaults.colors(selectedColor = MagentaNeon)
                                        )
                                        Text("WSS", color = Color.White, fontSize = 12.sp)
                                    }
                                }
                            }
                            Spacer(modifier = Modifier.height(10.dp))

                            OutlinedTextField(
                                value = securityToken,
                                onValueChange = { securityToken = it },
                                label = { Text("NVS Local Security Token") },
                                visualTransformation = PasswordVisualTransformation(),
                                modifier = Modifier.fillMaxWidth(),
                                colors = formTextFieldColors()
                            )
                            Spacer(modifier = Modifier.height(16.dp))

                            Button(
                                onClick = {
                                    if (friendlyName.isNotBlank() && devId.isNotBlank() && ipAddr.isNotBlank() && portStr.isNotBlank() && securityToken.isNotBlank()) {
                                        devices.removeAll { it.id == devId }
                                        devices.add(
                                            Device(
                                                id = devId,
                                                name = friendlyName,
                                                ip = ipAddr,
                                                port = portStr.toIntOrNull() ?: 5555,
                                                protocol = protocolSelection,
                                                token = securityToken,
                                                state = 0,
                                                online = true
                                            )
                                        )
                                        addLog("success", "Registered secure hardware endpoint: $friendlyName ($ipAddr)")
                                        friendlyName = ""; devId = ""; ipAddr = ""; portStr = ""; securityToken = ""
                                    } else {
                                        addLog("error", "Failed to register: Form fields cannot be empty.")
                                    }
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .border(1.dp, Color(0x33FFFFFF), RoundedCornerShape(8.dp))
                                    .background(Color(0x05FFFFFF), RoundedCornerShape(8.dp)),
                                shape = RoundedCornerShape(8.dp)
                            ) {
                                Text("REGISTER SECURE CONTROLLER", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                            }
                        }
                    }

                    // --- 3. Registered Devices List ---
                    item {
                        Column {
                            Text("Secure Registered Devices", color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = 18.sp)
                            Spacer(modifier = Modifier.height(12.dp))
                            devices.forEach { dev ->
                                DeviceCard(
                                    device = dev,
                                    onToggle = { isChecked ->
                                        coroutineScope.launch {
                                            addLog("info", "Firing toggle command [${if (isChecked) "ON" else "OFF"}] to ${dev.name}...")
                                            if (dev.protocol == "UDP") {
                                                val opcode: Byte = if (isChecked) 0x01 else 0x02
                                                val resultState = udpGateway.executeCommand(
                                                    deviceId = dev.id,
                                                    ipAddress = dev.ip,
                                                    port = dev.port,
                                                    token = dev.token,
                                                    commandId = opcode,
                                                    relayId = 0
                                                ) { msg, details ->
                                                    val type = if (msg.contains("derived") || msg.contains("Derived")) "crypto"
                                                               else if (msg.contains("Sending") || msg.contains("Handshake Request")) "tx"
                                                               else if (msg.contains("response") || msg.contains("Received")) "rx"
                                                               else if (msg.contains("error")) "error"
                                                               else "info"
                                                    addLog(type, msg, details)
                                                }
                                                if (resultState != null) {
                                                    dev.state = resultState
                                                    dev.online = true
                                                    addLog("success", "Secure UDP toggle execution complete. Relay status is ${if (resultState == 1) "ON" else "OFF"}")
                                                } else {
                                                    dev.online = false
                                                    addLog("error", "Secure UDP Command Execution failed: Device timeout.")
                                                }
                                            } else {
                                                // Secure WSS Proxy link
                                                val actionStr = if (isChecked) "RELAY_ON" else "RELAY_OFF"
                                                val resultState = wssGateway.executeWssCommand(
                                                    ipAddress = dev.ip,
                                                    port = dev.port,
                                                    token = dev.token,
                                                    action = actionStr
                                                ) { msg, details ->
                                                    val type = if (msg.contains("Sending")) "tx"
                                                               else if (msg.contains("Received")) "rx"
                                                               else if (msg.contains("error")) "error"
                                                               else "info"
                                                    addLog(type, msg, details)
                                                }
                                                if (resultState != null) {
                                                    dev.state = resultState
                                                    dev.online = true
                                                    addLog("success", "WSS TLS Command executed. Relay status is ${if (resultState == 1) "ON" else "OFF"}")
                                                } else {
                                                    dev.online = false
                                                    addLog("error", "Secure WSS command pipeline failed: Remote host unreachable.")
                                                }
                                            }
                                        }
                                    },
                                    onDelete = {
                                        devices.remove(dev)
                                        addLog("info", "Removed device configuration: ${dev.id}")
                                    }
                                )
                                Spacer(modifier = Modifier.height(16.dp))
                            }
                        }
                    }

                    // --- 4. Cryptographic sniffer console ---
                    item {
                        GlassCard {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text("Cryptographic Sniffer", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                                Text(
                                    "CLEAR LOGS",
                                    color = TextMuted,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 11.sp,
                                    modifier = Modifier.clickable {
                                        logs.clear()
                                        logs.add(TerminalLog(getCurrentTime(), "info", "Console logs reset. Sniffer operational."))
                                    }
                                )
                            }
                            Spacer(modifier = Modifier.height(12.dp))

                            // Crypto Stats Counter Row
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(Color(0xFF02040C))
                                    .padding(12.dp),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.weight(1f)) {
                                    Text("SESSIONS", color = TextMuted, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                                    Text(activeSessionsCount.toString(), color = CyanNeon, fontSize = 14.sp, fontWeight = FontWeight.ExtraBold, fontFamily = FontFamily.Monospace)
                                }
                                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.weight(1f)) {
                                    Text("TX FRAMES", color = TextMuted, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                                    Text(txCounter.toString(), color = BlueNeon, fontSize = 14.sp, fontWeight = FontWeight.ExtraBold, fontFamily = FontFamily.Monospace)
                                }
                                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.weight(1f)) {
                                    Text("RX FRAMES", color = TextMuted, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                                    Text(rxCounter.toString(), color = PurpleNeon, fontSize = 14.sp, fontWeight = FontWeight.ExtraBold, fontFamily = FontFamily.Monospace)
                                }
                            }
                            Spacer(modifier = Modifier.height(12.dp))

                            // Terminal Stream
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(280.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(Color(0xFF02040C))
                                    .border(1.dp, Color(0x12FFFFFF), RoundedCornerShape(8.dp))
                                    .padding(12.dp)
                            ) {
                                LazyColumn(modifier = Modifier.fillMaxSize()) {
                                    items(logs) { log ->
                                        TerminalLineItem(log)
                                        Spacer(modifier = Modifier.height(8.dp))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    @Composable
    fun GlassCard(content: @Composable ColumnScope.() -> Unit) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(GlassBg)
                .border(1.dp, GlassBorder, RoundedCornerShape(16.dp))
                .padding(20.dp),
            content = content
        )
    }

    @Composable
    fun DeviceCard(device: Device, onToggle: (Boolean) -> Unit, onDelete: () -> Unit) {
        var isChecked by remember { mutableStateOf(device.state == 1) }
        val ledColor by animateColorAsState(
            targetValue = if (device.online) (if (isChecked) EmeraldNeon else TextMuted) else RoseNeon,
            label = "ledGlow"
        )

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(GlassBg)
                .border(1.dp, GlassBorder, RoundedCornerShape(16.dp))
                .padding(18.dp)
        ) {
            Column {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.Top
                ) {
                    Column {
                        Text(device.name, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        Text(device.id, color = TextMuted, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                    }
                    
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = "${device.protocol} SECURE",
                            color = if (device.protocol == "UDP") CyanNeon else MagentaNeon,
                            fontSize = 9.sp,
                            fontWeight = FontWeight.ExtraBold,
                            modifier = Modifier
                                .clip(RoundedCornerShape(12.dp))
                                .background(if (device.protocol == "UDP") CyanNeon.copy(alpha = 0.1f) else MagentaNeon.copy(alpha = 0.1f))
                                .padding(horizontal = 8.dp, vertical = 4.dp)
                                .border(1.dp, if (device.protocol == "UDP") CyanNeon.copy(alpha = 0.2f) else MagentaNeon.copy(alpha = 0.2f), RoundedCornerShape(12.dp))
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("✕", color = RoseNeon, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clickable { onDelete() })
                    }
                }
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = "📡 ${device.ip}:${device.port}",
                    color = TextSecondary,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace
                )
                Spacer(modifier = Modifier.height(16.dp))
                
                Divider(color = Color(0x0AFFFFFF), thickness = 1.dp)
                Spacer(modifier = Modifier.height(12.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(10.dp)
                                .clip(CircleShape)
                                .background(ledColor)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = if (device.online) (if (isChecked) "ACTIVE / ON" else "ACTIVE / OFF") else "OFFLINE",
                            color = if (device.online) EmeraldNeon else RoseNeon,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    Switch(
                        checked = isChecked,
                        onCheckedChange = {
                            isChecked = it
                            onToggle(it)
                        },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = EmeraldNeon,
                            checkedTrackColor = EmeraldNeon.copy(alpha = 0.2f),
                            uncheckedThumbColor = TextMuted,
                            uncheckedTrackColor = Color(0x1AFFFFFF)
                        ),
                        enabled = device.online
                    )
                }
            }
        }
    }

    @Composable
    fun TerminalLineItem(log: TerminalLog) {
        val color = when (log.type) {
            "tx" -> CyanNeon
            "rx" -> PurpleNeon
            "crypto" -> AmberNeon
            "success" -> EmeraldNeon
            "error" -> RoseNeon
            else -> TextSecondary
        }

        val typePrefix = when (log.type) {
            "tx" -> "⚡ [TX] "
            "rx" -> "📥 [RX] "
            "crypto" -> "🔑 [KEY] "
            "success" -> "✓ [OK] "
            "error" -> "✕ [ERR] "
            else -> "ℹ [SYS] "
        }

        Column(modifier = Modifier.fillMaxWidth()) {
            Text(
                text = "[${log.timestamp}] $typePrefix${log.message}",
                color = color,
                fontFamily = FontFamily.Monospace,
                fontSize = 11.sp,
                lineHeight = 14.sp
            )
            
            log.details?.let { details ->
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 12.dp, top = 4.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(Color(0x0AFFFFFF))
                        .padding(8.dp)
                ) {
                    details.forEach { (k, v) ->
                        Row {
                            Text("$k:", color = TextMuted, fontSize = 9.sp, fontFamily = FontFamily.Monospace, modifier = Modifier.width(90.dp))
                            Text(v, color = TextSecondary, fontSize = 9.sp, fontFamily = FontFamily.Monospace, modifier = Modifier.weight(1f))
                        }
                    }
                }
            }
        }
    }

    @Composable
    private fun formTextFieldColors() = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = CyanNeon,
        unfocusedBorderColor = Color(0x1FFFFFFF),
        focusedLabelColor = CyanNeon,
        unfocusedLabelColor = TextSecondary,
        focusedTextColor = Color.White,
        unfocusedTextColor = Color.White
    )

    private fun getCurrentTime(): String {
        return SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
    }
}
