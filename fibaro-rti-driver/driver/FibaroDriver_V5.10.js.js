// Fibaro Home Center Driver - Room-Based Version
// Version 4.5 - Try {} for scenes like devices use

// Global variables
var g_IPAddress = "";
var g_Port = 80;
var g_Username = "";
var g_Password = "";
var g_Authorization = "";
var g_HTTP = null;
var g_HTTPRefresh = null;  // Separate connection for long polling
var g_Connected = false;
var g_RefreshConnected = false;
var g_LastRefreshId = 0;
var g_RefreshTimer = null;
var g_LongPollActive = false;
var g_LongPollTimer = null;

// Device and scene tracking
var g_RoomDevices = {};
var g_RoomScenes = {};  // Scene tracking
var g_DeviceStates = {};

// Constants
var LONG_POLL_TIMEOUT = 30000; // 30 seconds

// Initialize
function Initialize() {
    System.Print("FIBARO: Driver v5.10 loaded\n");
    
    // Get configuration
    g_IPAddress = Config.Get("IPAddress");
    g_Port = parseInt(Config.Get("Port")) || 80;
    g_Username = Config.Get("Username");
    g_Password = Config.Get("Password");
    
    // Create authorization header
    var auth = g_Username + ":" + g_Password;
    g_Authorization = "Basic " + Crypto.Base64Encode(auth, auth.length);
    
    // Build device map
    BuildDeviceMap();
    
    // Connect
    Connect();
}

// Build device map from configuration - Updated for 20 lights and 20 scenes
function BuildDeviceMap() {
    debugPrint("Building device map...");
    
    // Clear existing
    g_RoomDevices = {};
    g_RoomScenes = {};
    
    var totalDevices = 0;
    var totalScenes = 0;
    
    // Check all 20 rooms
    for (var r = 1; r <= 20; r++) {
        try {
            var roomEnabled = Config.Get("Room" + r + "_Enable");
            if (roomEnabled == "1" || roomEnabled == "true") {
                debugPrint("Room " + r + " is enabled");
                
                // Check up to 20 lights per room
                for (var l = 1; l <= 20; l++) {
                    try {
                        var lightEnabled = Config.Get("Room" + r + "_Light" + l + "_Enable");
                        if (lightEnabled == "1" || lightEnabled == "true") {
                            var deviceId = Config.Get("Room" + r + "_Light" + l + "_FibaroID");
                            var deviceName = Config.Get("Room" + r + "_Light" + l + "_Name");
                            
                            if (deviceId && deviceId != "" && deviceId != "0") {
                                var key = "Room" + r + "_Light" + l;
                                g_RoomDevices[key] = {
                                    id: parseInt(deviceId),
                                    name: deviceName || ("Light " + l),
                                    room: r,
                                    light: l
                                };
                                debugPrint("Added device - " + key + " ID: " + deviceId + ", Name: " + deviceName);
                                totalDevices++;
                            }
                        }
                    } catch (e) {
                        // Light not configured, continue
                    }
                }
                
                // Check up to 20 scenes per room
                for (var s = 1; s <= 20; s++) {
                    try {
                        var sceneEnabled = Config.Get("Room" + r + "_Scene" + s + "_Enable");
                        if (sceneEnabled == "1" || sceneEnabled == "true") {
                            var sceneId = Config.Get("Room" + r + "_Scene" + s + "_FibaroID");
                            var sceneName = Config.Get("Room" + r + "_Scene" + s + "_Name");
                            
                            if (sceneId && sceneId != "" && sceneId != "0") {
                                var key = "Room" + r + "_Scene" + s;
                                g_RoomScenes[key] = {
                                    id: parseInt(sceneId),
                                    name: sceneName || ("Scene " + s),
                                    room: r,
                                    scene: s
                                };
                                debugPrint("Added scene - " + key + " ID: " + sceneId + ", Name: " + sceneName);
                                totalScenes++;
                            }
                        }
                    } catch (e) {
                        // Scene not configured, continue
                    }
                }
            }
        } catch (e) {
            // Room not configured, continue
        }
    }
    
    debugPrint("Total devices configured: " + totalDevices);
    debugPrint("Total scenes configured: " + totalScenes);
}

// Connect to Fibaro
function Connect() {
    debugPrint("Connecting to " + g_IPAddress + ":" + g_Port);
    
    if (g_HTTP) {
        g_HTTP.Close();
        g_HTTP = null;
    }
    
    // Create HTTP object
    g_HTTP = new HTTP(OnHTTPResponse);
    g_HTTP.OnConnectFunc = OnHTTPConnect;
    g_HTTP.OnDisconnectFunc = OnHTTPDisconnect;
    g_HTTP.OnConnectFailedFunc = OnHTTPConnectFailed;
    
    // Open connection
    g_HTTP.Open(g_IPAddress, g_Port);
    g_HTTP.AddRxHTTPFraming();
    
    SystemVars.Write("ConnectionStatus", "Connecting...");
}

// Connected
function OnHTTPConnect() {
    System.Print("FIBARO: Connected (main)\n");
    g_Connected = true;
    
    SystemVars.Write("ConnectionStatus", "Connected");
    SystemVars.Write("Connected", true);
    
    // Get initial state
    var hasDevices = false;
    for (var key in g_RoomDevices) {
        if (g_RoomDevices.hasOwnProperty(key)) {
            hasDevices = true;
            break;
        }
    }
    
    if (hasDevices) {
        if (g_RefreshTimer) {
            g_RefreshTimer.Stop();
            g_RefreshTimer = null;
        }
        g_RefreshTimer = new Timer();
        g_RefreshTimer.Start(GetInitialStates, 1000);
    }
}

// Get initial device states
function GetInitialStates() {
    if (!g_Connected) {
        return;
    }
    
    debugPrint("Getting initial device states");
    
    // Get state for each configured device
    for (var key in g_RoomDevices) {
        if (g_RoomDevices.hasOwnProperty(key)) {
            var device = g_RoomDevices[key];
            SendAPIRequest("GET", "/api/devices/" + device.id, null);
        }
    }
    
    // Connect refresh connection after getting initial states
    if (g_RefreshTimer) {
        g_RefreshTimer.Stop();
    }
    g_RefreshTimer = new Timer();
    g_RefreshTimer.Start(ConnectRefreshConnection, 2000);
}

// Connect separate connection for long polling
function ConnectRefreshConnection() {
    debugPrint("Creating refresh connection for long polling");
    
    if (g_HTTPRefresh) {
        g_HTTPRefresh.Close();
        g_HTTPRefresh = null;
    }
    
    // Create separate HTTP object for long polling
    g_HTTPRefresh = new HTTP(OnRefreshResponse);
    g_HTTPRefresh.OnConnectFunc = OnRefreshConnect;
    g_HTTPRefresh.OnDisconnectFunc = OnRefreshDisconnect;
    g_HTTPRefresh.OnConnectFailedFunc = OnRefreshConnectFailed;
    
    // Open connection
    g_HTTPRefresh.Open(g_IPAddress, g_Port);
    g_HTTPRefresh.AddRxHTTPFraming();
}

// Refresh connected
function OnRefreshConnect() {
    debugPrint("Refresh connection established");
    g_RefreshConnected = true;
    
    // Start long polling
    if (!g_LongPollActive) {
        StartLongPoll();
    }
}

// Start long polling for changes
function StartLongPoll() {
    if (!g_RefreshConnected || g_LongPollActive) {
        return;
    }
    
    g_LongPollActive = true;
    debugPrint("Starting long poll (last ID: " + g_LastRefreshId + ")");
    
    // Request state changes since last refresh
    var endpoint = "/api/refreshStates";
    if (g_LastRefreshId > 0) {
        endpoint += "?last=" + g_LastRefreshId;
    }
    
    SendAPIRequest("GET", endpoint, null, true);
    
    // Set timeout for long poll
    if (g_LongPollTimer) {
        g_LongPollTimer.Stop();
    }
    g_LongPollTimer = new Timer();
    g_LongPollTimer.Start(LongPollTimeout, LONG_POLL_TIMEOUT);
}

// Long poll timeout handler
function LongPollTimeout() {
    debugPrint("Long poll timeout - restarting");
    g_LongPollActive = false;
    
    // Restart long poll
    if (g_RefreshConnected) {
        StartLongPoll();
    }
}

// Send API request - USING V4.0 STABLE VERSION
function SendAPIRequest(method, endpoint, data, useRefreshConnection) {
    var connection = useRefreshConnection ? g_HTTPRefresh : g_HTTP;
    var isConnected = useRefreshConnection ? g_RefreshConnected : g_Connected;
    
    if (!isConnected || !connection) {
        debugPrint("Not connected - cannot send request");
        return;
    }
    
    var headers = "Host: " + g_IPAddress + "\r\n";
    headers += "Authorization: " + g_Authorization + "\r\n";
    headers += "Accept: application/json\r\n";
    headers += "Connection: keep-alive\r\n";
    
    if (data) {
        var jsonData = JSON.stringify(data);
        headers += "Content-Type: application/json\r\n";
        headers += "Content-Length: " + jsonData.length + "\r\n";
        headers += "\r\n";
        
        debugPrint("Sending " + method + " to: " + endpoint);
        connection.Write(method + " " + endpoint + " HTTP/1.1\r\n" + headers + jsonData);
    } else {
        headers += "\r\n";
        debugPrint("Sending " + method + " to: " + endpoint);
        connection.Write(method + " " + endpoint + " HTTP/1.1\r\n" + headers);
    }
}

// Main HTTP Response - USING V4.0 STABLE VERSION
function OnHTTPResponse(data) {
    debugPrint("Response received (main)");
    ProcessHTTPResponse(data, false);
}

// Refresh HTTP Response - USING V4.0 STABLE VERSION
function OnRefreshResponse(data) {
    debugPrint("Response received (refresh)");
    
    // Cancel timeout
    if (g_LongPollTimer) {
        g_LongPollTimer.Stop();
    }
    
    g_LongPollActive = false;
    
    ProcessHTTPResponse(data, true);
    
    // Restart long poll immediately for faster response
    if (g_RefreshConnected) {
        if (g_LongPollTimer) {
            g_LongPollTimer.Stop();
        }
        g_LongPollTimer = new Timer();
        g_LongPollTimer.Start(StartLongPoll, 50);
    }
}

// Process HTTP response - USING V4.0 STABLE VERSION
function ProcessHTTPResponse(data, isRefresh) {
    // Parse response
    var body = data;
    var statusLine = "";
    var headerEnd = data.indexOf("\r\n\r\n");
    
    if (headerEnd > -1) {
        statusLine = data.substr(0, data.indexOf("\r\n"));
        body = data.substr(headerEnd + 4);
        debugPrint("Status: " + statusLine);
    }
    
    // Check for success
    if (statusLine.indexOf("200 OK") > -1 || statusLine.indexOf("202 Accepted") > -1) {
        if (body.length > 0) {
            if (isRefresh) {
                ProcessRefreshResponse(body);
            } else {
                ProcessNormalResponse(body);
            }
        }
    } else {
        debugPrint("HTTP error: " + statusLine);
    }
}

// Process normal response - USING V4.0 STABLE VERSION
function ProcessNormalResponse(body) {
    try {
        var json = JSON.parse(body);
        
        // Device response - find which device this is
        if (json.id) {
            for (var key in g_RoomDevices) {
                if (g_RoomDevices.hasOwnProperty(key)) {
                    var device = g_RoomDevices[key];
                    if (device.id == json.id) {
                        UpdateDeviceState(key, json);
                        break;
                    }
                }
            }
        }
    } catch (e) {
        debugPrint("Error processing response: " + e);
    }
}

// Process refresh response (state changes) - USING V4.0 STABLE VERSION
function ProcessRefreshResponse(body) {
    try {
        var response = JSON.parse(body);
        
        if (response) {
            // Update last refresh ID
            if (response.last) {
                g_LastRefreshId = response.last;
                debugPrint("Updated last refresh ID: " + g_LastRefreshId);
            }
            
            // Process changes
            if (response.changes && response.changes.length > 0) {
                debugPrint("Processing " + response.changes.length + " changes");
                
                for (var i = 0; i < response.changes.length; i++) {
                    var change = response.changes[i];
                    ProcessStateChange(change);
                }
            }
        }
    } catch (e) {
        debugPrint("Error processing refresh: " + e);
    }
}

// Process a state change - USING V4.0 STABLE VERSION
function ProcessStateChange(change) {
    if (!change || !change.id) return;
    
    debugPrint("State change for device " + change.id);
    
    // Find which device this change is for
    for (var key in g_RoomDevices) {
        if (g_RoomDevices.hasOwnProperty(key)) {
            var device = g_RoomDevices[key];
            if (device.id == change.id) {
                // Update device state from change
                if (!g_DeviceStates[device.id]) {
                    g_DeviceStates[device.id] = {};
                }
                
                // Handle specific property updates
                if (change.value !== undefined) {
                    g_DeviceStates[device.id].value = change.value;
                    debugPrint("Device " + device.id + " value changed to: " + change.value);
                    
                    // For dimmers, the value IS the level (0-100)
                    if (typeof change.value === 'number') {
                        g_DeviceStates[device.id].level = change.value;
                        debugPrint("Device " + device.id + " level updated to: " + change.value);
                        
                        // Remember last "on" level for dimmers
                        if (change.value > 0) {
                            g_DeviceStates[device.id].lastOnLevel = change.value;
                        }
                    }
                }
                
                if (change.level !== undefined) {
                    g_DeviceStates[device.id].level = change.level;
                    debugPrint("Device " + device.id + " level changed to: " + change.level);
                    
                    // Remember last "on" level
                    if (change.level > 0) {
                        g_DeviceStates[device.id].lastOnLevel = change.level;
                    }
                }
                
                // Debug: Log complete state
                debugPrint("Device " + device.id + " state is now: value=" + 
                    g_DeviceStates[device.id].value + ", level=" + 
                    g_DeviceStates[device.id].level + ", lastOnLevel=" +
                    g_DeviceStates[device.id].lastOnLevel);
                
                // Update UI immediately
                UpdateDeviceStatus(key);
                break;
            }
        }
    }
}

// Update device state from full device info - USING V4.0 STABLE VERSION
function UpdateDeviceState(key, deviceInfo) {
    var device = g_RoomDevices[key];
    if (!device) return;
    
    // Extract value and level from properties
    var value = "false";
    var level = 0;
    
    if (deviceInfo.properties) {
        if (deviceInfo.properties.value !== undefined) {
            value = deviceInfo.properties.value;
        }
        if (deviceInfo.properties.level !== undefined) {
            level = deviceInfo.properties.level;
        } else if (typeof value === 'number') {
            // For dimmers without explicit level property, value IS the level
            level = value;
        }
    }
    
    // Store state
    g_DeviceStates[device.id] = {
        value: value,
        level: level
    };
    
    // Remember last "on" level for dimmers
    if (typeof value === 'number' && value > 0) {
        g_DeviceStates[device.id].lastOnLevel = value;
    } else if (level > 0) {
        g_DeviceStates[device.id].lastOnLevel = level;
    }
    
    // Update UI
    UpdateDeviceStatus(key);
}

// Update device status in system variables - USING V4.0 STABLE VERSION
function UpdateDeviceStatus(key) {
    var device = g_RoomDevices[key];
    if (!device) return;
    
    var state = g_DeviceStates[device.id];
    if (!state) return;
    
    // Determine on/off state and level
    var value = state.value;
    var level = state.level;
    
    var isOn = false;
    
    // For dimmers, if value is numeric, it IS the level
    if (typeof value === "number") {
        isOn = value > 0;
        level = value;  // Always use value as level for numeric values
    } else if (typeof value === "string") {
        isOn = (value === "true" || value === "1" || parseInt(value) > 0);
        // Try to parse numeric string as level
        var parsedValue = parseInt(value);
        if (!isNaN(parsedValue)) {
            level = parsedValue;
        } else if (level === undefined || level === null) {
            // Only default if no level exists
            level = isOn ? 100 : 0;
        }
    } else if (typeof value === "boolean") {
        isOn = value;
        if (level === undefined || level === null) {
            level = isOn ? 100 : 0;
        }
    }
    
    // Ensure level is a valid number
    level = parseInt(level) || 0;
    
    // Update system variables
    SystemVars.Write(key + "_Status", isOn ? "On" : "Off");
    SystemVars.Write(key + "_On", isOn);
    SystemVars.Write(key + "_Level", level);
    
    debugPrint("Device " + key + " state: " + (isOn ? "On" : "Off") + ", Level: " + level);
}

// Control functions - USING V4.0 STABLE VERSION WITH {} FOR COMMANDS
function controlDevice(key, action, level) {
    var device = g_RoomDevices[key];
    if (!device || !g_Connected) {
        debugPrint("Cannot control " + key + " - device not found or not connected");
        return;
    }
    
    switch (action) {
        case "on":
            debugPrint("Turning on " + key + " (ID: " + device.id + ")");
            SendAPIRequest("POST", "/api/devices/" + device.id + "/action/turnOn", {});
            
            // Optimistic update
            if (!g_DeviceStates[device.id]) {
                g_DeviceStates[device.id] = {};
            }
            
            // For dimmers, use lastOnLevel if available
            var lastLevel = g_DeviceStates[device.id].lastOnLevel;
            if (lastLevel && lastLevel > 0) {
                // Dimmer turning on - use last known level
                g_DeviceStates[device.id].value = lastLevel;
                g_DeviceStates[device.id].level = lastLevel;
            } else {
                // Non-dimmer or unknown last level - just mark as on
                g_DeviceStates[device.id].value = "true";
                // Don't change level - wait for actual response
            }
            
            UpdateDeviceStatus(key);
            break;
            
        case "off":
            debugPrint("Turning off " + key + " (ID: " + device.id + ")");
            SendAPIRequest("POST", "/api/devices/" + device.id + "/action/turnOff", {});
            
            // Optimistic update
            if (!g_DeviceStates[device.id]) {
                g_DeviceStates[device.id] = {};
            }
            
            // For dimmers, remember current level before turning off
            var currentLevel = g_DeviceStates[device.id].level;
            if (currentLevel && currentLevel > 0) {
                g_DeviceStates[device.id].lastOnLevel = currentLevel;
            }
            
            g_DeviceStates[device.id].value = 0;  // Use 0 for consistency with Fibaro
            g_DeviceStates[device.id].level = 0;
            
            UpdateDeviceStatus(key);
            break;
            
        case "toggle":
            var state = g_DeviceStates[device.id];
            if (state) {
                var isOn = (state.value === "true" || state.value === true || 
                           (typeof state.value === 'number' && state.value > 0));
                controlDevice(key, isOn ? "off" : "on");
            } else {
                // No state known, default to turn on
                controlDevice(key, "on");
            }
            break;
            
        case "setlevel":
            debugPrint("Setting " + key + " to level " + level);
            SendAPIRequest("POST", "/api/devices/" + device.id + "/action/setValue", {arg1: level});
            
            // Optimistic update - for dimmers, value and level are the same
            if (!g_DeviceStates[device.id]) {
                g_DeviceStates[device.id] = {};
            }
            
            g_DeviceStates[device.id].value = level;
            g_DeviceStates[device.id].level = level;
            
            // Remember last "on" level if not turning off
            if (level > 0) {
                g_DeviceStates[device.id].lastOnLevel = level;
            }
            
            UpdateDeviceStatus(key);
            break;
    }
}

// Fibaro Home Center Driver - Room-Based Version
// Version 4.6 - Fixed scene 400 Bad Request

// Scene Control Helper - WORKING VERSION CONFIRMED BY POSTMAN
function activateScene(key) {
    var scene = g_RoomScenes[key];
    if (!scene || !g_Connected) {
        debugPrint("Cannot activate " + key + " - scene not found or not connected");
        return;
    }
    
    debugPrint("Activating scene " + key + " (ID: " + scene.id + ")");
    
    // Use /execute endpoint with {} body - confirmed working in Postman
    SendAPIRequest("POST", "/api/scenes/" + scene.id + "/execute", {});
    
    // Update system variable
    SystemVars.Write(key + "_Status", "Activated");
    SystemVars.Write(key + "_Status", "Ready");
}

// Add this complete function to replace the one in your driver
// The rest of the driver remains the same

// Alternative scene endpoints for testing
function testSceneEndpoint(sceneId, method) {
    if (!g_Connected) {
        debugPrint("Not connected - cannot test scene");
        return;
    }
    
    debugPrint("Testing scene " + sceneId + " with method " + method);
    
    switch(method) {
        case 1:
            // Execute endpoint
            debugPrint("Test: POST /api/scenes/" + sceneId + "/execute");
            SendAPIRequest("POST", "/api/scenes/" + sceneId + "/execute", {});
            break;
        case 2:
            // Run action
            debugPrint("Test: POST /api/scenes/" + sceneId + "/action/run");
            SendAPIRequest("POST", "/api/scenes/" + sceneId + "/action/run", {});
            break;
        case 3:
            // Direct execute without action folder
            debugPrint("Test: GET /api/scenes/" + sceneId + "/execute");
            SendAPIRequest("GET", "/api/scenes/" + sceneId + "/execute", null);
            break;
        case 4:
            // Scene control endpoint
            debugPrint("Test: POST /api/sceneControl/execute/" + sceneId);
            SendAPIRequest("POST", "/api/sceneControl/execute/" + sceneId, {});
            break;
    }
}

// Test functions for scene 27
function TestScene27_Method1() { testSceneEndpoint(27, 1); }
function TestScene27_Method2() { testSceneEndpoint(27, 2); }
function TestScene27_Method3() { testSceneEndpoint(27, 3); }
function TestScene27_Method4() { testSceneEndpoint(27, 4); }

// Disconnect handlers - USING V4.0 STABLE VERSION
function OnHTTPDisconnect() {
    debugPrint("Disconnected (main)");
    g_Connected = false;
    SystemVars.Write("ConnectionStatus", "Disconnected");
    SystemVars.Write("Connected", false);
    
    // Close refresh connection too
    if (g_HTTPRefresh) {
        g_HTTPRefresh.Close();
        g_HTTPRefresh = null;
    }
    g_RefreshConnected = false;
    
    // Reconnect after delay
    if (g_RefreshTimer) {
        g_RefreshTimer.Stop();
    }
    g_RefreshTimer = new Timer();
    g_RefreshTimer.Start(Connect, 5000);
}

// Refresh disconnected
function OnRefreshDisconnect() {
    debugPrint("Refresh connection lost");
    g_RefreshConnected = false;
    g_LongPollActive = false;
    
    // Reconnect if main is still connected
    if (g_Connected) {
        if (g_LongPollTimer) {
            g_LongPollTimer.Stop();
        }
        g_LongPollTimer = new Timer();
        g_LongPollTimer.Start(ConnectRefreshConnection, 1000);
    }
}

function OnHTTPConnectFailed() {
    debugPrint("Connection failed (main)");
    g_Connected = false;
    SystemVars.Write("ConnectionStatus", "Connection Failed");
    SystemVars.Write("Connected", false);
    
    // Retry
    if (g_RefreshTimer) {
        g_RefreshTimer.Stop();
    }
    g_RefreshTimer = new Timer();
    g_RefreshTimer.Start(Connect, 10000);
}

// Refresh connection failed
function OnRefreshConnectFailed() {
    debugPrint("Refresh connection failed");
    g_RefreshConnected = false;
    g_LongPollActive = false;
    
    // Retry after delay if main connection is active
    if (g_Connected) {
        if (g_LongPollTimer) {
            g_LongPollTimer.Stop();
        }
        g_LongPollTimer = new Timer();
        g_LongPollTimer.Start(ConnectRefreshConnection, 3000);
    }
}

// System functions
function RefreshAll() {
    debugPrint("Refreshing all devices...");
    for (var key in g_RoomDevices) {
        if (g_RoomDevices.hasOwnProperty(key)) {
            var device = g_RoomDevices[key];
            SendAPIRequest("GET", "/api/devices/" + device.id, null);
        }
    }
}

// Debug helper
function debugPrint(msg) {
    // Try to get debug setting, default to true if not found
    var debugEnabled = true;
    try {
        var debugSetting = Config.Get("DebugPrint");
        debugEnabled = (debugSetting == "true");
    } catch (e) {
        // DebugPrint not in config, default to enabled
        debugEnabled = true;
    }
    
    if (debugEnabled) {
        System.Print("FIBARO: " + msg + "\n");
    }
}

// Room Control Functions - Generated for all rooms
// Supports 20 rooms with 20 lights and 20 scenes each

// Room 1 Light Functions
function Room1_Light1_On() { controlDevice("Room1_Light1", "on"); }
function Room1_Light1_Off() { controlDevice("Room1_Light1", "off"); }
function Room1_Light1_Toggle() { controlDevice("Room1_Light1", "toggle"); }
function Room1_Light1_SetLevel(level) { controlDevice("Room1_Light1", "setlevel", level); }

function Room1_Light2_On() { controlDevice("Room1_Light2", "on"); }
function Room1_Light2_Off() { controlDevice("Room1_Light2", "off"); }
function Room1_Light2_Toggle() { controlDevice("Room1_Light2", "toggle"); }
function Room1_Light2_SetLevel(level) { controlDevice("Room1_Light2", "setlevel", level); }

function Room1_Light3_On() { controlDevice("Room1_Light3", "on"); }
function Room1_Light3_Off() { controlDevice("Room1_Light3", "off"); }
function Room1_Light3_Toggle() { controlDevice("Room1_Light3", "toggle"); }
function Room1_Light3_SetLevel(level) { controlDevice("Room1_Light3", "setlevel", level); }

function Room1_Light4_On() { controlDevice("Room1_Light4", "on"); }
function Room1_Light4_Off() { controlDevice("Room1_Light4", "off"); }
function Room1_Light4_Toggle() { controlDevice("Room1_Light4", "toggle"); }
function Room1_Light4_SetLevel(level) { controlDevice("Room1_Light4", "setlevel", level); }

function Room1_Light5_On() { controlDevice("Room1_Light5", "on"); }
function Room1_Light5_Off() { controlDevice("Room1_Light5", "off"); }
function Room1_Light5_Toggle() { controlDevice("Room1_Light5", "toggle"); }
function Room1_Light5_SetLevel(level) { controlDevice("Room1_Light5", "setlevel", level); }

function Room1_Light6_On() { controlDevice("Room1_Light6", "on"); }
function Room1_Light6_Off() { controlDevice("Room1_Light6", "off"); }
function Room1_Light6_Toggle() { controlDevice("Room1_Light6", "toggle"); }
function Room1_Light6_SetLevel(level) { controlDevice("Room1_Light6", "setlevel", level); }

function Room1_Light7_On() { controlDevice("Room1_Light7", "on"); }
function Room1_Light7_Off() { controlDevice("Room1_Light7", "off"); }
function Room1_Light7_Toggle() { controlDevice("Room1_Light7", "toggle"); }
function Room1_Light7_SetLevel(level) { controlDevice("Room1_Light7", "setlevel", level); }

function Room1_Light8_On() { controlDevice("Room1_Light8", "on"); }
function Room1_Light8_Off() { controlDevice("Room1_Light8", "off"); }
function Room1_Light8_Toggle() { controlDevice("Room1_Light8", "toggle"); }
function Room1_Light8_SetLevel(level) { controlDevice("Room1_Light8", "setlevel", level); }

function Room1_Light9_On() { controlDevice("Room1_Light9", "on"); }
function Room1_Light9_Off() { controlDevice("Room1_Light9", "off"); }
function Room1_Light9_Toggle() { controlDevice("Room1_Light9", "toggle"); }
function Room1_Light9_SetLevel(level) { controlDevice("Room1_Light9", "setlevel", level); }

function Room1_Light10_On() { controlDevice("Room1_Light10", "on"); }
function Room1_Light10_Off() { controlDevice("Room1_Light10", "off"); }
function Room1_Light10_Toggle() { controlDevice("Room1_Light10", "toggle"); }
function Room1_Light10_SetLevel(level) { controlDevice("Room1_Light10", "setlevel", level); }

function Room1_Light11_On() { controlDevice("Room1_Light11", "on"); }
function Room1_Light11_Off() { controlDevice("Room1_Light11", "off"); }
function Room1_Light11_Toggle() { controlDevice("Room1_Light11", "toggle"); }
function Room1_Light11_SetLevel(level) { controlDevice("Room1_Light11", "setlevel", level); }

function Room1_Light12_On() { controlDevice("Room1_Light12", "on"); }
function Room1_Light12_Off() { controlDevice("Room1_Light12", "off"); }
function Room1_Light12_Toggle() { controlDevice("Room1_Light12", "toggle"); }
function Room1_Light12_SetLevel(level) { controlDevice("Room1_Light12", "setlevel", level); }

function Room1_Light13_On() { controlDevice("Room1_Light13", "on"); }
function Room1_Light13_Off() { controlDevice("Room1_Light13", "off"); }
function Room1_Light13_Toggle() { controlDevice("Room1_Light13", "toggle"); }
function Room1_Light13_SetLevel(level) { controlDevice("Room1_Light13", "setlevel", level); }

function Room1_Light14_On() { controlDevice("Room1_Light14", "on"); }
function Room1_Light14_Off() { controlDevice("Room1_Light14", "off"); }
function Room1_Light14_Toggle() { controlDevice("Room1_Light14", "toggle"); }
function Room1_Light14_SetLevel(level) { controlDevice("Room1_Light14", "setlevel", level); }

function Room1_Light15_On() { controlDevice("Room1_Light15", "on"); }
function Room1_Light15_Off() { controlDevice("Room1_Light15", "off"); }
function Room1_Light15_Toggle() { controlDevice("Room1_Light15", "toggle"); }
function Room1_Light15_SetLevel(level) { controlDevice("Room1_Light15", "setlevel", level); }

function Room1_Light16_On() { controlDevice("Room1_Light16", "on"); }
function Room1_Light16_Off() { controlDevice("Room1_Light16", "off"); }
function Room1_Light16_Toggle() { controlDevice("Room1_Light16", "toggle"); }
function Room1_Light16_SetLevel(level) { controlDevice("Room1_Light16", "setlevel", level); }

function Room1_Light17_On() { controlDevice("Room1_Light17", "on"); }
function Room1_Light17_Off() { controlDevice("Room1_Light17", "off"); }
function Room1_Light17_Toggle() { controlDevice("Room1_Light17", "toggle"); }
function Room1_Light17_SetLevel(level) { controlDevice("Room1_Light17", "setlevel", level); }

function Room1_Light18_On() { controlDevice("Room1_Light18", "on"); }
function Room1_Light18_Off() { controlDevice("Room1_Light18", "off"); }
function Room1_Light18_Toggle() { controlDevice("Room1_Light18", "toggle"); }
function Room1_Light18_SetLevel(level) { controlDevice("Room1_Light18", "setlevel", level); }

function Room1_Light19_On() { controlDevice("Room1_Light19", "on"); }
function Room1_Light19_Off() { controlDevice("Room1_Light19", "off"); }
function Room1_Light19_Toggle() { controlDevice("Room1_Light19", "toggle"); }
function Room1_Light19_SetLevel(level) { controlDevice("Room1_Light19", "setlevel", level); }

function Room1_Light20_On() { controlDevice("Room1_Light20", "on"); }
function Room1_Light20_Off() { controlDevice("Room1_Light20", "off"); }
function Room1_Light20_Toggle() { controlDevice("Room1_Light20", "toggle"); }
function Room1_Light20_SetLevel(level) { controlDevice("Room1_Light20", "setlevel", level); }

// Room 1 Scene Functions
function Room1_Scene1_Activate() { activateScene("Room1_Scene1"); }
function Room1_Scene2_Activate() { activateScene("Room1_Scene2"); }
function Room1_Scene3_Activate() { activateScene("Room1_Scene3"); }
function Room1_Scene4_Activate() { activateScene("Room1_Scene4"); }
function Room1_Scene5_Activate() { activateScene("Room1_Scene5"); }
function Room1_Scene6_Activate() { activateScene("Room1_Scene6"); }
function Room1_Scene7_Activate() { activateScene("Room1_Scene7"); }
function Room1_Scene8_Activate() { activateScene("Room1_Scene8"); }
function Room1_Scene9_Activate() { activateScene("Room1_Scene9"); }
function Room1_Scene10_Activate() { activateScene("Room1_Scene10"); }
function Room1_Scene11_Activate() { activateScene("Room1_Scene11"); }
function Room1_Scene12_Activate() { activateScene("Room1_Scene12"); }
function Room1_Scene13_Activate() { activateScene("Room1_Scene13"); }
function Room1_Scene14_Activate() { activateScene("Room1_Scene14"); }
function Room1_Scene15_Activate() { activateScene("Room1_Scene15"); }
function Room1_Scene16_Activate() { activateScene("Room1_Scene16"); }
function Room1_Scene17_Activate() { activateScene("Room1_Scene17"); }
function Room1_Scene18_Activate() { activateScene("Room1_Scene18"); }
function Room1_Scene19_Activate() { activateScene("Room1_Scene19"); }
function Room1_Scene20_Activate() { activateScene("Room1_Scene20"); }

// Room 2 Light Functions
function Room2_Light1_On() { controlDevice("Room2_Light1", "on"); }
function Room2_Light1_Off() { controlDevice("Room2_Light1", "off"); }
function Room2_Light1_Toggle() { controlDevice("Room2_Light1", "toggle"); }
function Room2_Light1_SetLevel(level) { controlDevice("Room2_Light1", "setlevel", level); }

function Room2_Light2_On() { controlDevice("Room2_Light2", "on"); }
function Room2_Light2_Off() { controlDevice("Room2_Light2", "off"); }
function Room2_Light2_Toggle() { controlDevice("Room2_Light2", "toggle"); }
function Room2_Light2_SetLevel(level) { controlDevice("Room2_Light2", "setlevel", level); }

function Room2_Light3_On() { controlDevice("Room2_Light3", "on"); }
function Room2_Light3_Off() { controlDevice("Room2_Light3", "off"); }
function Room2_Light3_Toggle() { controlDevice("Room2_Light3", "toggle"); }
function Room2_Light3_SetLevel(level) { controlDevice("Room2_Light3", "setlevel", level); }

function Room2_Light4_On() { controlDevice("Room2_Light4", "on"); }
function Room2_Light4_Off() { controlDevice("Room2_Light4", "off"); }
function Room2_Light4_Toggle() { controlDevice("Room2_Light4", "toggle"); }
function Room2_Light4_SetLevel(level) { controlDevice("Room2_Light4", "setlevel", level); }

function Room2_Light5_On() { controlDevice("Room2_Light5", "on"); }
function Room2_Light5_Off() { controlDevice("Room2_Light5", "off"); }
function Room2_Light5_Toggle() { controlDevice("Room2_Light5", "toggle"); }
function Room2_Light5_SetLevel(level) { controlDevice("Room2_Light5", "setlevel", level); }

function Room2_Light6_On() { controlDevice("Room2_Light6", "on"); }
function Room2_Light6_Off() { controlDevice("Room2_Light6", "off"); }
function Room2_Light6_Toggle() { controlDevice("Room2_Light6", "toggle"); }
function Room2_Light6_SetLevel(level) { controlDevice("Room2_Light6", "setlevel", level); }

function Room2_Light7_On() { controlDevice("Room2_Light7", "on"); }
function Room2_Light7_Off() { controlDevice("Room2_Light7", "off"); }
function Room2_Light7_Toggle() { controlDevice("Room2_Light7", "toggle"); }
function Room2_Light7_SetLevel(level) { controlDevice("Room2_Light7", "setlevel", level); }

function Room2_Light8_On() { controlDevice("Room2_Light8", "on"); }
function Room2_Light8_Off() { controlDevice("Room2_Light8", "off"); }
function Room2_Light8_Toggle() { controlDevice("Room2_Light8", "toggle"); }
function Room2_Light8_SetLevel(level) { controlDevice("Room2_Light8", "setlevel", level); }

function Room2_Light9_On() { controlDevice("Room2_Light9", "on"); }
function Room2_Light9_Off() { controlDevice("Room2_Light9", "off"); }
function Room2_Light9_Toggle() { controlDevice("Room2_Light9", "toggle"); }
function Room2_Light9_SetLevel(level) { controlDevice("Room2_Light9", "setlevel", level); }

function Room2_Light10_On() { controlDevice("Room2_Light10", "on"); }
function Room2_Light10_Off() { controlDevice("Room2_Light10", "off"); }
function Room2_Light10_Toggle() { controlDevice("Room2_Light10", "toggle"); }
function Room2_Light10_SetLevel(level) { controlDevice("Room2_Light10", "setlevel", level); }

function Room2_Light11_On() { controlDevice("Room2_Light11", "on"); }
function Room2_Light11_Off() { controlDevice("Room2_Light11", "off"); }
function Room2_Light11_Toggle() { controlDevice("Room2_Light11", "toggle"); }
function Room2_Light11_SetLevel(level) { controlDevice("Room2_Light11", "setlevel", level); }

function Room2_Light12_On() { controlDevice("Room2_Light12", "on"); }
function Room2_Light12_Off() { controlDevice("Room2_Light12", "off"); }
function Room2_Light12_Toggle() { controlDevice("Room2_Light12", "toggle"); }
function Room2_Light12_SetLevel(level) { controlDevice("Room2_Light12", "setlevel", level); }

function Room2_Light13_On() { controlDevice("Room2_Light13", "on"); }
function Room2_Light13_Off() { controlDevice("Room2_Light13", "off"); }
function Room2_Light13_Toggle() { controlDevice("Room2_Light13", "toggle"); }
function Room2_Light13_SetLevel(level) { controlDevice("Room2_Light13", "setlevel", level); }

function Room2_Light14_On() { controlDevice("Room2_Light14", "on"); }
function Room2_Light14_Off() { controlDevice("Room2_Light14", "off"); }
function Room2_Light14_Toggle() { controlDevice("Room2_Light14", "toggle"); }
function Room2_Light14_SetLevel(level) { controlDevice("Room2_Light14", "setlevel", level); }

function Room2_Light15_On() { controlDevice("Room2_Light15", "on"); }
function Room2_Light15_Off() { controlDevice("Room2_Light15", "off"); }
function Room2_Light15_Toggle() { controlDevice("Room2_Light15", "toggle"); }
function Room2_Light15_SetLevel(level) { controlDevice("Room2_Light15", "setlevel", level); }

function Room2_Light16_On() { controlDevice("Room2_Light16", "on"); }
function Room2_Light16_Off() { controlDevice("Room2_Light16", "off"); }
function Room2_Light16_Toggle() { controlDevice("Room2_Light16", "toggle"); }
function Room2_Light16_SetLevel(level) { controlDevice("Room2_Light16", "setlevel", level); }

function Room2_Light17_On() { controlDevice("Room2_Light17", "on"); }
function Room2_Light17_Off() { controlDevice("Room2_Light17", "off"); }
function Room2_Light17_Toggle() { controlDevice("Room2_Light17", "toggle"); }
function Room2_Light17_SetLevel(level) { controlDevice("Room2_Light17", "setlevel", level); }

function Room2_Light18_On() { controlDevice("Room2_Light18", "on"); }
function Room2_Light18_Off() { controlDevice("Room2_Light18", "off"); }
function Room2_Light18_Toggle() { controlDevice("Room2_Light18", "toggle"); }
function Room2_Light18_SetLevel(level) { controlDevice("Room2_Light18", "setlevel", level); }

function Room2_Light19_On() { controlDevice("Room2_Light19", "on"); }
function Room2_Light19_Off() { controlDevice("Room2_Light19", "off"); }
function Room2_Light19_Toggle() { controlDevice("Room2_Light19", "toggle"); }
function Room2_Light19_SetLevel(level) { controlDevice("Room2_Light19", "setlevel", level); }

function Room2_Light20_On() { controlDevice("Room2_Light20", "on"); }
function Room2_Light20_Off() { controlDevice("Room2_Light20", "off"); }
function Room2_Light20_Toggle() { controlDevice("Room2_Light20", "toggle"); }
function Room2_Light20_SetLevel(level) { controlDevice("Room2_Light20", "setlevel", level); }

// Room 2 Scene Functions
function Room2_Scene1_Activate() { activateScene("Room2_Scene1"); }
function Room2_Scene2_Activate() { activateScene("Room2_Scene2"); }
function Room2_Scene3_Activate() { activateScene("Room2_Scene3"); }
function Room2_Scene4_Activate() { activateScene("Room2_Scene4"); }
function Room2_Scene5_Activate() { activateScene("Room2_Scene5"); }
function Room2_Scene6_Activate() { activateScene("Room2_Scene6"); }
function Room2_Scene7_Activate() { activateScene("Room2_Scene7"); }
function Room2_Scene8_Activate() { activateScene("Room2_Scene8"); }
function Room2_Scene9_Activate() { activateScene("Room2_Scene9"); }
function Room2_Scene10_Activate() { activateScene("Room2_Scene10"); }
function Room2_Scene11_Activate() { activateScene("Room2_Scene11"); }
function Room2_Scene12_Activate() { activateScene("Room2_Scene12"); }
function Room2_Scene13_Activate() { activateScene("Room2_Scene13"); }
function Room2_Scene14_Activate() { activateScene("Room2_Scene14"); }
function Room2_Scene15_Activate() { activateScene("Room2_Scene15"); }
function Room2_Scene16_Activate() { activateScene("Room2_Scene16"); }
function Room2_Scene17_Activate() { activateScene("Room2_Scene17"); }
function Room2_Scene18_Activate() { activateScene("Room2_Scene18"); }
function Room2_Scene19_Activate() { activateScene("Room2_Scene19"); }
function Room2_Scene20_Activate() { activateScene("Room2_Scene20"); }

// Room 3 Light Functions
function Room3_Light1_On() { controlDevice("Room3_Light1", "on"); }
function Room3_Light1_Off() { controlDevice("Room3_Light1", "off"); }
function Room3_Light1_Toggle() { controlDevice("Room3_Light1", "toggle"); }
function Room3_Light1_SetLevel(level) { controlDevice("Room3_Light1", "setlevel", level); }

function Room3_Light2_On() { controlDevice("Room3_Light2", "on"); }
function Room3_Light2_Off() { controlDevice("Room3_Light2", "off"); }
function Room3_Light2_Toggle() { controlDevice("Room3_Light2", "toggle"); }
function Room3_Light2_SetLevel(level) { controlDevice("Room3_Light2", "setlevel", level); }

function Room3_Light3_On() { controlDevice("Room3_Light3", "on"); }
function Room3_Light3_Off() { controlDevice("Room3_Light3", "off"); }
function Room3_Light3_Toggle() { controlDevice("Room3_Light3", "toggle"); }
function Room3_Light3_SetLevel(level) { controlDevice("Room3_Light3", "setlevel", level); }

function Room3_Light4_On() { controlDevice("Room3_Light4", "on"); }
function Room3_Light4_Off() { controlDevice("Room3_Light4", "off"); }
function Room3_Light4_Toggle() { controlDevice("Room3_Light4", "toggle"); }
function Room3_Light4_SetLevel(level) { controlDevice("Room3_Light4", "setlevel", level); }

function Room3_Light5_On() { controlDevice("Room3_Light5", "on"); }
function Room3_Light5_Off() { controlDevice("Room3_Light5", "off"); }
function Room3_Light5_Toggle() { controlDevice("Room3_Light5", "toggle"); }
function Room3_Light5_SetLevel(level) { controlDevice("Room3_Light5", "setlevel", level); }

function Room3_Light6_On() { controlDevice("Room3_Light6", "on"); }
function Room3_Light6_Off() { controlDevice("Room3_Light6", "off"); }
function Room3_Light6_Toggle() { controlDevice("Room3_Light6", "toggle"); }
function Room3_Light6_SetLevel(level) { controlDevice("Room3_Light6", "setlevel", level); }

function Room3_Light7_On() { controlDevice("Room3_Light7", "on"); }
function Room3_Light7_Off() { controlDevice("Room3_Light7", "off"); }
function Room3_Light7_Toggle() { controlDevice("Room3_Light7", "toggle"); }
function Room3_Light7_SetLevel(level) { controlDevice("Room3_Light7", "setlevel", level); }

function Room3_Light8_On() { controlDevice("Room3_Light8", "on"); }
function Room3_Light8_Off() { controlDevice("Room3_Light8", "off"); }
function Room3_Light8_Toggle() { controlDevice("Room3_Light8", "toggle"); }
function Room3_Light8_SetLevel(level) { controlDevice("Room3_Light8", "setlevel", level); }

function Room3_Light9_On() { controlDevice("Room3_Light9", "on"); }
function Room3_Light9_Off() { controlDevice("Room3_Light9", "off"); }
function Room3_Light9_Toggle() { controlDevice("Room3_Light9", "toggle"); }
function Room3_Light9_SetLevel(level) { controlDevice("Room3_Light9", "setlevel", level); }

function Room3_Light10_On() { controlDevice("Room3_Light10", "on"); }
function Room3_Light10_Off() { controlDevice("Room3_Light10", "off"); }
function Room3_Light10_Toggle() { controlDevice("Room3_Light10", "toggle"); }
function Room3_Light10_SetLevel(level) { controlDevice("Room3_Light10", "setlevel", level); }

function Room3_Light11_On() { controlDevice("Room3_Light11", "on"); }
function Room3_Light11_Off() { controlDevice("Room3_Light11", "off"); }
function Room3_Light11_Toggle() { controlDevice("Room3_Light11", "toggle"); }
function Room3_Light11_SetLevel(level) { controlDevice("Room3_Light11", "setlevel", level); }

function Room3_Light12_On() { controlDevice("Room3_Light12", "on"); }
function Room3_Light12_Off() { controlDevice("Room3_Light12", "off"); }
function Room3_Light12_Toggle() { controlDevice("Room3_Light12", "toggle"); }
function Room3_Light12_SetLevel(level) { controlDevice("Room3_Light12", "setlevel", level); }

function Room3_Light13_On() { controlDevice("Room3_Light13", "on"); }
function Room3_Light13_Off() { controlDevice("Room3_Light13", "off"); }
function Room3_Light13_Toggle() { controlDevice("Room3_Light13", "toggle"); }
function Room3_Light13_SetLevel(level) { controlDevice("Room3_Light13", "setlevel", level); }

function Room3_Light14_On() { controlDevice("Room3_Light14", "on"); }
function Room3_Light14_Off() { controlDevice("Room3_Light14", "off"); }
function Room3_Light14_Toggle() { controlDevice("Room3_Light14", "toggle"); }
function Room3_Light14_SetLevel(level) { controlDevice("Room3_Light14", "setlevel", level); }

function Room3_Light15_On() { controlDevice("Room3_Light15", "on"); }
function Room3_Light15_Off() { controlDevice("Room3_Light15", "off"); }
function Room3_Light15_Toggle() { controlDevice("Room3_Light15", "toggle"); }
function Room3_Light15_SetLevel(level) { controlDevice("Room3_Light15", "setlevel", level); }

function Room3_Light16_On() { controlDevice("Room3_Light16", "on"); }
function Room3_Light16_Off() { controlDevice("Room3_Light16", "off"); }
function Room3_Light16_Toggle() { controlDevice("Room3_Light16", "toggle"); }
function Room3_Light16_SetLevel(level) { controlDevice("Room3_Light16", "setlevel", level); }

function Room3_Light17_On() { controlDevice("Room3_Light17", "on"); }
function Room3_Light17_Off() { controlDevice("Room3_Light17", "off"); }
function Room3_Light17_Toggle() { controlDevice("Room3_Light17", "toggle"); }
function Room3_Light17_SetLevel(level) { controlDevice("Room3_Light17", "setlevel", level); }

function Room3_Light18_On() { controlDevice("Room3_Light18", "on"); }
function Room3_Light18_Off() { controlDevice("Room3_Light18", "off"); }
function Room3_Light18_Toggle() { controlDevice("Room3_Light18", "toggle"); }
function Room3_Light18_SetLevel(level) { controlDevice("Room3_Light18", "setlevel", level); }

function Room3_Light19_On() { controlDevice("Room3_Light19", "on"); }
function Room3_Light19_Off() { controlDevice("Room3_Light19", "off"); }
function Room3_Light19_Toggle() { controlDevice("Room3_Light19", "toggle"); }
function Room3_Light19_SetLevel(level) { controlDevice("Room3_Light19", "setlevel", level); }

function Room3_Light20_On() { controlDevice("Room3_Light20", "on"); }
function Room3_Light20_Off() { controlDevice("Room3_Light20", "off"); }
function Room3_Light20_Toggle() { controlDevice("Room3_Light20", "toggle"); }
function Room3_Light20_SetLevel(level) { controlDevice("Room3_Light20", "setlevel", level); }

// Room 3 Scene Functions
function Room3_Scene1_Activate() { activateScene("Room3_Scene1"); }
function Room3_Scene2_Activate() { activateScene("Room3_Scene2"); }
function Room3_Scene3_Activate() { activateScene("Room3_Scene3"); }
function Room3_Scene4_Activate() { activateScene("Room3_Scene4"); }
function Room3_Scene5_Activate() { activateScene("Room3_Scene5"); }
function Room3_Scene6_Activate() { activateScene("Room3_Scene6"); }
function Room3_Scene7_Activate() { activateScene("Room3_Scene7"); }
function Room3_Scene8_Activate() { activateScene("Room3_Scene8"); }
function Room3_Scene9_Activate() { activateScene("Room3_Scene9"); }
function Room3_Scene10_Activate() { activateScene("Room3_Scene10"); }
function Room3_Scene11_Activate() { activateScene("Room3_Scene11"); }
function Room3_Scene12_Activate() { activateScene("Room3_Scene12"); }
function Room3_Scene13_Activate() { activateScene("Room3_Scene13"); }
function Room3_Scene14_Activate() { activateScene("Room3_Scene14"); }
function Room3_Scene15_Activate() { activateScene("Room3_Scene15"); }
function Room3_Scene16_Activate() { activateScene("Room3_Scene16"); }
function Room3_Scene17_Activate() { activateScene("Room3_Scene17"); }
function Room3_Scene18_Activate() { activateScene("Room3_Scene18"); }
function Room3_Scene19_Activate() { activateScene("Room3_Scene19"); }
function Room3_Scene20_Activate() { activateScene("Room3_Scene20"); }

// Room 4 Light Functions
function Room4_Light1_On() { controlDevice("Room4_Light1", "on"); }
function Room4_Light1_Off() { controlDevice("Room4_Light1", "off"); }
function Room4_Light1_Toggle() { controlDevice("Room4_Light1", "toggle"); }
function Room4_Light1_SetLevel(level) { controlDevice("Room4_Light1", "setlevel", level); }

function Room4_Light2_On() { controlDevice("Room4_Light2", "on"); }
function Room4_Light2_Off() { controlDevice("Room4_Light2", "off"); }
function Room4_Light2_Toggle() { controlDevice("Room4_Light2", "toggle"); }
function Room4_Light2_SetLevel(level) { controlDevice("Room4_Light2", "setlevel", level); }

function Room4_Light3_On() { controlDevice("Room4_Light3", "on"); }
function Room4_Light3_Off() { controlDevice("Room4_Light3", "off"); }
function Room4_Light3_Toggle() { controlDevice("Room4_Light3", "toggle"); }
function Room4_Light3_SetLevel(level) { controlDevice("Room4_Light3", "setlevel", level); }

function Room4_Light4_On() { controlDevice("Room4_Light4", "on"); }
function Room4_Light4_Off() { controlDevice("Room4_Light4", "off"); }
function Room4_Light4_Toggle() { controlDevice("Room4_Light4", "toggle"); }
function Room4_Light4_SetLevel(level) { controlDevice("Room4_Light4", "setlevel", level); }

function Room4_Light5_On() { controlDevice("Room4_Light5", "on"); }
function Room4_Light5_Off() { controlDevice("Room4_Light5", "off"); }
function Room4_Light5_Toggle() { controlDevice("Room4_Light5", "toggle"); }
function Room4_Light5_SetLevel(level) { controlDevice("Room4_Light5", "setlevel", level); }

function Room4_Light6_On() { controlDevice("Room4_Light6", "on"); }
function Room4_Light6_Off() { controlDevice("Room4_Light6", "off"); }
function Room4_Light6_Toggle() { controlDevice("Room4_Light6", "toggle"); }
function Room4_Light6_SetLevel(level) { controlDevice("Room4_Light6", "setlevel", level); }

function Room4_Light7_On() { controlDevice("Room4_Light7", "on"); }
function Room4_Light7_Off() { controlDevice("Room4_Light7", "off"); }
function Room4_Light7_Toggle() { controlDevice("Room4_Light7", "toggle"); }
function Room4_Light7_SetLevel(level) { controlDevice("Room4_Light7", "setlevel", level); }

function Room4_Light8_On() { controlDevice("Room4_Light8", "on"); }
function Room4_Light8_Off() { controlDevice("Room4_Light8", "off"); }
function Room4_Light8_Toggle() { controlDevice("Room4_Light8", "toggle"); }
function Room4_Light8_SetLevel(level) { controlDevice("Room4_Light8", "setlevel", level); }

function Room4_Light9_On() { controlDevice("Room4_Light9", "on"); }
function Room4_Light9_Off() { controlDevice("Room4_Light9", "off"); }
function Room4_Light9_Toggle() { controlDevice("Room4_Light9", "toggle"); }
function Room4_Light9_SetLevel(level) { controlDevice("Room4_Light9", "setlevel", level); }

function Room4_Light10_On() { controlDevice("Room4_Light10", "on"); }
function Room4_Light10_Off() { controlDevice("Room4_Light10", "off"); }
function Room4_Light10_Toggle() { controlDevice("Room4_Light10", "toggle"); }
function Room4_Light10_SetLevel(level) { controlDevice("Room4_Light10", "setlevel", level); }

function Room4_Light11_On() { controlDevice("Room4_Light11", "on"); }
function Room4_Light11_Off() { controlDevice("Room4_Light11", "off"); }
function Room4_Light11_Toggle() { controlDevice("Room4_Light11", "toggle"); }
function Room4_Light11_SetLevel(level) { controlDevice("Room4_Light11", "setlevel", level); }

function Room4_Light12_On() { controlDevice("Room4_Light12", "on"); }
function Room4_Light12_Off() { controlDevice("Room4_Light12", "off"); }
function Room4_Light12_Toggle() { controlDevice("Room4_Light12", "toggle"); }
function Room4_Light12_SetLevel(level) { controlDevice("Room4_Light12", "setlevel", level); }

function Room4_Light13_On() { controlDevice("Room4_Light13", "on"); }
function Room4_Light13_Off() { controlDevice("Room4_Light13", "off"); }
function Room4_Light13_Toggle() { controlDevice("Room4_Light13", "toggle"); }
function Room4_Light13_SetLevel(level) { controlDevice("Room4_Light13", "setlevel", level); }

function Room4_Light14_On() { controlDevice("Room4_Light14", "on"); }
function Room4_Light14_Off() { controlDevice("Room4_Light14", "off"); }
function Room4_Light14_Toggle() { controlDevice("Room4_Light14", "toggle"); }
function Room4_Light14_SetLevel(level) { controlDevice("Room4_Light14", "setlevel", level); }

function Room4_Light15_On() { controlDevice("Room4_Light15", "on"); }
function Room4_Light15_Off() { controlDevice("Room4_Light15", "off"); }
function Room4_Light15_Toggle() { controlDevice("Room4_Light15", "toggle"); }
function Room4_Light15_SetLevel(level) { controlDevice("Room4_Light15", "setlevel", level); }

function Room4_Light16_On() { controlDevice("Room4_Light16", "on"); }
function Room4_Light16_Off() { controlDevice("Room4_Light16", "off"); }
function Room4_Light16_Toggle() { controlDevice("Room4_Light16", "toggle"); }
function Room4_Light16_SetLevel(level) { controlDevice("Room4_Light16", "setlevel", level); }

function Room4_Light17_On() { controlDevice("Room4_Light17", "on"); }
function Room4_Light17_Off() { controlDevice("Room4_Light17", "off"); }
function Room4_Light17_Toggle() { controlDevice("Room4_Light17", "toggle"); }
function Room4_Light17_SetLevel(level) { controlDevice("Room4_Light17", "setlevel", level); }

function Room4_Light18_On() { controlDevice("Room4_Light18", "on"); }
function Room4_Light18_Off() { controlDevice("Room4_Light18", "off"); }
function Room4_Light18_Toggle() { controlDevice("Room4_Light18", "toggle"); }
function Room4_Light18_SetLevel(level) { controlDevice("Room4_Light18", "setlevel", level); }

function Room4_Light19_On() { controlDevice("Room4_Light19", "on"); }
function Room4_Light19_Off() { controlDevice("Room4_Light19", "off"); }
function Room4_Light19_Toggle() { controlDevice("Room4_Light19", "toggle"); }
function Room4_Light19_SetLevel(level) { controlDevice("Room4_Light19", "setlevel", level); }

function Room4_Light20_On() { controlDevice("Room4_Light20", "on"); }
function Room4_Light20_Off() { controlDevice("Room4_Light20", "off"); }
function Room4_Light20_Toggle() { controlDevice("Room4_Light20", "toggle"); }
function Room4_Light20_SetLevel(level) { controlDevice("Room4_Light20", "setlevel", level); }

// Room 4 Scene Functions
function Room4_Scene1_Activate() { activateScene("Room4_Scene1"); }
function Room4_Scene2_Activate() { activateScene("Room4_Scene2"); }
function Room4_Scene3_Activate() { activateScene("Room4_Scene3"); }
function Room4_Scene4_Activate() { activateScene("Room4_Scene4"); }
function Room4_Scene5_Activate() { activateScene("Room4_Scene5"); }
function Room4_Scene6_Activate() { activateScene("Room4_Scene6"); }
function Room4_Scene7_Activate() { activateScene("Room4_Scene7"); }
function Room4_Scene8_Activate() { activateScene("Room4_Scene8"); }
function Room4_Scene9_Activate() { activateScene("Room4_Scene9"); }
function Room4_Scene10_Activate() { activateScene("Room4_Scene10"); }
function Room4_Scene11_Activate() { activateScene("Room4_Scene11"); }
function Room4_Scene12_Activate() { activateScene("Room4_Scene12"); }
function Room4_Scene13_Activate() { activateScene("Room4_Scene13"); }
function Room4_Scene14_Activate() { activateScene("Room4_Scene14"); }
function Room4_Scene15_Activate() { activateScene("Room4_Scene15"); }
function Room4_Scene16_Activate() { activateScene("Room4_Scene16"); }
function Room4_Scene17_Activate() { activateScene("Room4_Scene17"); }
function Room4_Scene18_Activate() { activateScene("Room4_Scene18"); }
function Room4_Scene19_Activate() { activateScene("Room4_Scene19"); }
function Room4_Scene20_Activate() { activateScene("Room4_Scene20"); }

// Room 5 Light Functions
function Room5_Light1_On() { controlDevice("Room5_Light1", "on"); }
function Room5_Light1_Off() { controlDevice("Room5_Light1", "off"); }
function Room5_Light1_Toggle() { controlDevice("Room5_Light1", "toggle"); }
function Room5_Light1_SetLevel(level) { controlDevice("Room5_Light1", "setlevel", level); }

function Room5_Light2_On() { controlDevice("Room5_Light2", "on"); }
function Room5_Light2_Off() { controlDevice("Room5_Light2", "off"); }
function Room5_Light2_Toggle() { controlDevice("Room5_Light2", "toggle"); }
function Room5_Light2_SetLevel(level) { controlDevice("Room5_Light2", "setlevel", level); }

function Room5_Light3_On() { controlDevice("Room5_Light3", "on"); }
function Room5_Light3_Off() { controlDevice("Room5_Light3", "off"); }
function Room5_Light3_Toggle() { controlDevice("Room5_Light3", "toggle"); }
function Room5_Light3_SetLevel(level) { controlDevice("Room5_Light3", "setlevel", level); }

function Room5_Light4_On() { controlDevice("Room5_Light4", "on"); }
function Room5_Light4_Off() { controlDevice("Room5_Light4", "off"); }
function Room5_Light4_Toggle() { controlDevice("Room5_Light4", "toggle"); }
function Room5_Light4_SetLevel(level) { controlDevice("Room5_Light4", "setlevel", level); }

function Room5_Light5_On() { controlDevice("Room5_Light5", "on"); }
function Room5_Light5_Off() { controlDevice("Room5_Light5", "off"); }
function Room5_Light5_Toggle() { controlDevice("Room5_Light5", "toggle"); }
function Room5_Light5_SetLevel(level) { controlDevice("Room5_Light5", "setlevel", level); }

function Room5_Light6_On() { controlDevice("Room5_Light6", "on"); }
function Room5_Light6_Off() { controlDevice("Room5_Light6", "off"); }
function Room5_Light6_Toggle() { controlDevice("Room5_Light6", "toggle"); }
function Room5_Light6_SetLevel(level) { controlDevice("Room5_Light6", "setlevel", level); }

function Room5_Light7_On() { controlDevice("Room5_Light7", "on"); }
function Room5_Light7_Off() { controlDevice("Room5_Light7", "off"); }
function Room5_Light7_Toggle() { controlDevice("Room5_Light7", "toggle"); }
function Room5_Light7_SetLevel(level) { controlDevice("Room5_Light7", "setlevel", level); }

function Room5_Light8_On() { controlDevice("Room5_Light8", "on"); }
function Room5_Light8_Off() { controlDevice("Room5_Light8", "off"); }
function Room5_Light8_Toggle() { controlDevice("Room5_Light8", "toggle"); }
function Room5_Light8_SetLevel(level) { controlDevice("Room5_Light8", "setlevel", level); }

function Room5_Light9_On() { controlDevice("Room5_Light9", "on"); }
function Room5_Light9_Off() { controlDevice("Room5_Light9", "off"); }
function Room5_Light9_Toggle() { controlDevice("Room5_Light9", "toggle"); }
function Room5_Light9_SetLevel(level) { controlDevice("Room5_Light9", "setlevel", level); }

function Room5_Light10_On() { controlDevice("Room5_Light10", "on"); }
function Room5_Light10_Off() { controlDevice("Room5_Light10", "off"); }
function Room5_Light10_Toggle() { controlDevice("Room5_Light10", "toggle"); }
function Room5_Light10_SetLevel(level) { controlDevice("Room5_Light10", "setlevel", level); }

function Room5_Light11_On() { controlDevice("Room5_Light11", "on"); }
function Room5_Light11_Off() { controlDevice("Room5_Light11", "off"); }
function Room5_Light11_Toggle() { controlDevice("Room5_Light11", "toggle"); }
function Room5_Light11_SetLevel(level) { controlDevice("Room5_Light11", "setlevel", level); }

function Room5_Light12_On() { controlDevice("Room5_Light12", "on"); }
function Room5_Light12_Off() { controlDevice("Room5_Light12", "off"); }
function Room5_Light12_Toggle() { controlDevice("Room5_Light12", "toggle"); }
function Room5_Light12_SetLevel(level) { controlDevice("Room5_Light12", "setlevel", level); }

function Room5_Light13_On() { controlDevice("Room5_Light13", "on"); }
function Room5_Light13_Off() { controlDevice("Room5_Light13", "off"); }
function Room5_Light13_Toggle() { controlDevice("Room5_Light13", "toggle"); }
function Room5_Light13_SetLevel(level) { controlDevice("Room5_Light13", "setlevel", level); }

function Room5_Light14_On() { controlDevice("Room5_Light14", "on"); }
function Room5_Light14_Off() { controlDevice("Room5_Light14", "off"); }
function Room5_Light14_Toggle() { controlDevice("Room5_Light14", "toggle"); }
function Room5_Light14_SetLevel(level) { controlDevice("Room5_Light14", "setlevel", level); }

function Room5_Light15_On() { controlDevice("Room5_Light15", "on"); }
function Room5_Light15_Off() { controlDevice("Room5_Light15", "off"); }
function Room5_Light15_Toggle() { controlDevice("Room5_Light15", "toggle"); }
function Room5_Light15_SetLevel(level) { controlDevice("Room5_Light15", "setlevel", level); }

function Room5_Light16_On() { controlDevice("Room5_Light16", "on"); }
function Room5_Light16_Off() { controlDevice("Room5_Light16", "off"); }
function Room5_Light16_Toggle() { controlDevice("Room5_Light16", "toggle"); }
function Room5_Light16_SetLevel(level) { controlDevice("Room5_Light16", "setlevel", level); }

function Room5_Light17_On() { controlDevice("Room5_Light17", "on"); }
function Room5_Light17_Off() { controlDevice("Room5_Light17", "off"); }
function Room5_Light17_Toggle() { controlDevice("Room5_Light17", "toggle"); }
function Room5_Light17_SetLevel(level) { controlDevice("Room5_Light17", "setlevel", level); }

function Room5_Light18_On() { controlDevice("Room5_Light18", "on"); }
function Room5_Light18_Off() { controlDevice("Room5_Light18", "off"); }
function Room5_Light18_Toggle() { controlDevice("Room5_Light18", "toggle"); }
function Room5_Light18_SetLevel(level) { controlDevice("Room5_Light18", "setlevel", level); }

function Room5_Light19_On() { controlDevice("Room5_Light19", "on"); }
function Room5_Light19_Off() { controlDevice("Room5_Light19", "off"); }
function Room5_Light19_Toggle() { controlDevice("Room5_Light19", "toggle"); }
function Room5_Light19_SetLevel(level) { controlDevice("Room5_Light19", "setlevel", level); }

function Room5_Light20_On() { controlDevice("Room5_Light20", "on"); }
function Room5_Light20_Off() { controlDevice("Room5_Light20", "off"); }
function Room5_Light20_Toggle() { controlDevice("Room5_Light20", "toggle"); }
function Room5_Light20_SetLevel(level) { controlDevice("Room5_Light20", "setlevel", level); }

// Room 5 Scene Functions
function Room5_Scene1_Activate() { activateScene("Room5_Scene1"); }
function Room5_Scene2_Activate() { activateScene("Room5_Scene2"); }
function Room5_Scene3_Activate() { activateScene("Room5_Scene3"); }
function Room5_Scene4_Activate() { activateScene("Room5_Scene4"); }
function Room5_Scene5_Activate() { activateScene("Room5_Scene5"); }
function Room5_Scene6_Activate() { activateScene("Room5_Scene6"); }
function Room5_Scene7_Activate() { activateScene("Room5_Scene7"); }
function Room5_Scene8_Activate() { activateScene("Room5_Scene8"); }
function Room5_Scene9_Activate() { activateScene("Room5_Scene9"); }
function Room5_Scene10_Activate() { activateScene("Room5_Scene10"); }
function Room5_Scene11_Activate() { activateScene("Room5_Scene11"); }
function Room5_Scene12_Activate() { activateScene("Room5_Scene12"); }
function Room5_Scene13_Activate() { activateScene("Room5_Scene13"); }
function Room5_Scene14_Activate() { activateScene("Room5_Scene14"); }
function Room5_Scene15_Activate() { activateScene("Room5_Scene15"); }
function Room5_Scene16_Activate() { activateScene("Room5_Scene16"); }
function Room5_Scene17_Activate() { activateScene("Room5_Scene17"); }
function Room5_Scene18_Activate() { activateScene("Room5_Scene18"); }
function Room5_Scene19_Activate() { activateScene("Room5_Scene19"); }
function Room5_Scene20_Activate() { activateScene("Room5_Scene20"); }

// Room 6 Light Functions
function Room6_Light1_On() { controlDevice("Room6_Light1", "on"); }
function Room6_Light1_Off() { controlDevice("Room6_Light1", "off"); }
function Room6_Light1_Toggle() { controlDevice("Room6_Light1", "toggle"); }
function Room6_Light1_SetLevel(level) { controlDevice("Room6_Light1", "setlevel", level); }

function Room6_Light2_On() { controlDevice("Room6_Light2", "on"); }
function Room6_Light2_Off() { controlDevice("Room6_Light2", "off"); }
function Room6_Light2_Toggle() { controlDevice("Room6_Light2", "toggle"); }
function Room6_Light2_SetLevel(level) { controlDevice("Room6_Light2", "setlevel", level); }

function Room6_Light3_On() { controlDevice("Room6_Light3", "on"); }
function Room6_Light3_Off() { controlDevice("Room6_Light3", "off"); }
function Room6_Light3_Toggle() { controlDevice("Room6_Light3", "toggle"); }
function Room6_Light3_SetLevel(level) { controlDevice("Room6_Light3", "setlevel", level); }

function Room6_Light4_On() { controlDevice("Room6_Light4", "on"); }
function Room6_Light4_Off() { controlDevice("Room6_Light4", "off"); }
function Room6_Light4_Toggle() { controlDevice("Room6_Light4", "toggle"); }
function Room6_Light4_SetLevel(level) { controlDevice("Room6_Light4", "setlevel", level); }

function Room6_Light5_On() { controlDevice("Room6_Light5", "on"); }
function Room6_Light5_Off() { controlDevice("Room6_Light5", "off"); }
function Room6_Light5_Toggle() { controlDevice("Room6_Light5", "toggle"); }
function Room6_Light5_SetLevel(level) { controlDevice("Room6_Light5", "setlevel", level); }

function Room6_Light6_On() { controlDevice("Room6_Light6", "on"); }
function Room6_Light6_Off() { controlDevice("Room6_Light6", "off"); }
function Room6_Light6_Toggle() { controlDevice("Room6_Light6", "toggle"); }
function Room6_Light6_SetLevel(level) { controlDevice("Room6_Light6", "setlevel", level); }

function Room6_Light7_On() { controlDevice("Room6_Light7", "on"); }
function Room6_Light7_Off() { controlDevice("Room6_Light7", "off"); }
function Room6_Light7_Toggle() { controlDevice("Room6_Light7", "toggle"); }
function Room6_Light7_SetLevel(level) { controlDevice("Room6_Light7", "setlevel", level); }

function Room6_Light8_On() { controlDevice("Room6_Light8", "on"); }
function Room6_Light8_Off() { controlDevice("Room6_Light8", "off"); }
function Room6_Light8_Toggle() { controlDevice("Room6_Light8", "toggle"); }
function Room6_Light8_SetLevel(level) { controlDevice("Room6_Light8", "setlevel", level); }

function Room6_Light9_On() { controlDevice("Room6_Light9", "on"); }
function Room6_Light9_Off() { controlDevice("Room6_Light9", "off"); }
function Room6_Light9_Toggle() { controlDevice("Room6_Light9", "toggle"); }
function Room6_Light9_SetLevel(level) { controlDevice("Room6_Light9", "setlevel", level); }

function Room6_Light10_On() { controlDevice("Room6_Light10", "on"); }
function Room6_Light10_Off() { controlDevice("Room6_Light10", "off"); }
function Room6_Light10_Toggle() { controlDevice("Room6_Light10", "toggle"); }
function Room6_Light10_SetLevel(level) { controlDevice("Room6_Light10", "setlevel", level); }

function Room6_Light11_On() { controlDevice("Room6_Light11", "on"); }
function Room6_Light11_Off() { controlDevice("Room6_Light11", "off"); }
function Room6_Light11_Toggle() { controlDevice("Room6_Light11", "toggle"); }
function Room6_Light11_SetLevel(level) { controlDevice("Room6_Light11", "setlevel", level); }

function Room6_Light12_On() { controlDevice("Room6_Light12", "on"); }
function Room6_Light12_Off() { controlDevice("Room6_Light12", "off"); }
function Room6_Light12_Toggle() { controlDevice("Room6_Light12", "toggle"); }
function Room6_Light12_SetLevel(level) { controlDevice("Room6_Light12", "setlevel", level); }

function Room6_Light13_On() { controlDevice("Room6_Light13", "on"); }
function Room6_Light13_Off() { controlDevice("Room6_Light13", "off"); }
function Room6_Light13_Toggle() { controlDevice("Room6_Light13", "toggle"); }
function Room6_Light13_SetLevel(level) { controlDevice("Room6_Light13", "setlevel", level); }

function Room6_Light14_On() { controlDevice("Room6_Light14", "on"); }
function Room6_Light14_Off() { controlDevice("Room6_Light14", "off"); }
function Room6_Light14_Toggle() { controlDevice("Room6_Light14", "toggle"); }
function Room6_Light14_SetLevel(level) { controlDevice("Room6_Light14", "setlevel", level); }

function Room6_Light15_On() { controlDevice("Room6_Light15", "on"); }
function Room6_Light15_Off() { controlDevice("Room6_Light15", "off"); }
function Room6_Light15_Toggle() { controlDevice("Room6_Light15", "toggle"); }
function Room6_Light15_SetLevel(level) { controlDevice("Room6_Light15", "setlevel", level); }

function Room6_Light16_On() { controlDevice("Room6_Light16", "on"); }
function Room6_Light16_Off() { controlDevice("Room6_Light16", "off"); }
function Room6_Light16_Toggle() { controlDevice("Room6_Light16", "toggle"); }
function Room6_Light16_SetLevel(level) { controlDevice("Room6_Light16", "setlevel", level); }

function Room6_Light17_On() { controlDevice("Room6_Light17", "on"); }
function Room6_Light17_Off() { controlDevice("Room6_Light17", "off"); }
function Room6_Light17_Toggle() { controlDevice("Room6_Light17", "toggle"); }
function Room6_Light17_SetLevel(level) { controlDevice("Room6_Light17", "setlevel", level); }

function Room6_Light18_On() { controlDevice("Room6_Light18", "on"); }
function Room6_Light18_Off() { controlDevice("Room6_Light18", "off"); }
function Room6_Light18_Toggle() { controlDevice("Room6_Light18", "toggle"); }
function Room6_Light18_SetLevel(level) { controlDevice("Room6_Light18", "setlevel", level); }

function Room6_Light19_On() { controlDevice("Room6_Light19", "on"); }
function Room6_Light19_Off() { controlDevice("Room6_Light19", "off"); }
function Room6_Light19_Toggle() { controlDevice("Room6_Light19", "toggle"); }
function Room6_Light19_SetLevel(level) { controlDevice("Room6_Light19", "setlevel", level); }

function Room6_Light20_On() { controlDevice("Room6_Light20", "on"); }
function Room6_Light20_Off() { controlDevice("Room6_Light20", "off"); }
function Room6_Light20_Toggle() { controlDevice("Room6_Light20", "toggle"); }
function Room6_Light20_SetLevel(level) { controlDevice("Room6_Light20", "setlevel", level); }

// Room 6 Scene Functions
function Room6_Scene1_Activate() { activateScene("Room6_Scene1"); }
function Room6_Scene2_Activate() { activateScene("Room6_Scene2"); }
function Room6_Scene3_Activate() { activateScene("Room6_Scene3"); }
function Room6_Scene4_Activate() { activateScene("Room6_Scene4"); }
function Room6_Scene5_Activate() { activateScene("Room6_Scene5"); }
function Room6_Scene6_Activate() { activateScene("Room6_Scene6"); }
function Room6_Scene7_Activate() { activateScene("Room6_Scene7"); }
function Room6_Scene8_Activate() { activateScene("Room6_Scene8"); }
function Room6_Scene9_Activate() { activateScene("Room6_Scene9"); }
function Room6_Scene10_Activate() { activateScene("Room6_Scene10"); }
function Room6_Scene11_Activate() { activateScene("Room6_Scene11"); }
function Room6_Scene12_Activate() { activateScene("Room6_Scene12"); }
function Room6_Scene13_Activate() { activateScene("Room6_Scene13"); }
function Room6_Scene14_Activate() { activateScene("Room6_Scene14"); }
function Room6_Scene15_Activate() { activateScene("Room6_Scene15"); }
function Room6_Scene16_Activate() { activateScene("Room6_Scene16"); }
function Room6_Scene17_Activate() { activateScene("Room6_Scene17"); }
function Room6_Scene18_Activate() { activateScene("Room6_Scene18"); }
function Room6_Scene19_Activate() { activateScene("Room6_Scene19"); }
function Room6_Scene20_Activate() { activateScene("Room6_Scene20"); }

// Room 7 Light Functions
function Room7_Light1_On() { controlDevice("Room7_Light1", "on"); }
function Room7_Light1_Off() { controlDevice("Room7_Light1", "off"); }
function Room7_Light1_Toggle() { controlDevice("Room7_Light1", "toggle"); }
function Room7_Light1_SetLevel(level) { controlDevice("Room7_Light1", "setlevel", level); }

function Room7_Light2_On() { controlDevice("Room7_Light2", "on"); }
function Room7_Light2_Off() { controlDevice("Room7_Light2", "off"); }
function Room7_Light2_Toggle() { controlDevice("Room7_Light2", "toggle"); }
function Room7_Light2_SetLevel(level) { controlDevice("Room7_Light2", "setlevel", level); }

function Room7_Light3_On() { controlDevice("Room7_Light3", "on"); }
function Room7_Light3_Off() { controlDevice("Room7_Light3", "off"); }
function Room7_Light3_Toggle() { controlDevice("Room7_Light3", "toggle"); }
function Room7_Light3_SetLevel(level) { controlDevice("Room7_Light3", "setlevel", level); }

function Room7_Light4_On() { controlDevice("Room7_Light4", "on"); }
function Room7_Light4_Off() { controlDevice("Room7_Light4", "off"); }
function Room7_Light4_Toggle() { controlDevice("Room7_Light4", "toggle"); }
function Room7_Light4_SetLevel(level) { controlDevice("Room7_Light4", "setlevel", level); }

function Room7_Light5_On() { controlDevice("Room7_Light5", "on"); }
function Room7_Light5_Off() { controlDevice("Room7_Light5", "off"); }
function Room7_Light5_Toggle() { controlDevice("Room7_Light5", "toggle"); }
function Room7_Light5_SetLevel(level) { controlDevice("Room7_Light5", "setlevel", level); }

function Room7_Light6_On() { controlDevice("Room7_Light6", "on"); }
function Room7_Light6_Off() { controlDevice("Room7_Light6", "off"); }
function Room7_Light6_Toggle() { controlDevice("Room7_Light6", "toggle"); }
function Room7_Light6_SetLevel(level) { controlDevice("Room7_Light6", "setlevel", level); }

function Room7_Light7_On() { controlDevice("Room7_Light7", "on"); }
function Room7_Light7_Off() { controlDevice("Room7_Light7", "off"); }
function Room7_Light7_Toggle() { controlDevice("Room7_Light7", "toggle"); }
function Room7_Light7_SetLevel(level) { controlDevice("Room7_Light7", "setlevel", level); }

function Room7_Light8_On() { controlDevice("Room7_Light8", "on"); }
function Room7_Light8_Off() { controlDevice("Room7_Light8", "off"); }
function Room7_Light8_Toggle() { controlDevice("Room7_Light8", "toggle"); }
function Room7_Light8_SetLevel(level) { controlDevice("Room7_Light8", "setlevel", level); }

function Room7_Light9_On() { controlDevice("Room7_Light9", "on"); }
function Room7_Light9_Off() { controlDevice("Room7_Light9", "off"); }
function Room7_Light9_Toggle() { controlDevice("Room7_Light9", "toggle"); }
function Room7_Light9_SetLevel(level) { controlDevice("Room7_Light9", "setlevel", level); }

function Room7_Light10_On() { controlDevice("Room7_Light10", "on"); }
function Room7_Light10_Off() { controlDevice("Room7_Light10", "off"); }
function Room7_Light10_Toggle() { controlDevice("Room7_Light10", "toggle"); }
function Room7_Light10_SetLevel(level) { controlDevice("Room7_Light10", "setlevel", level); }

function Room7_Light11_On() { controlDevice("Room7_Light11", "on"); }
function Room7_Light11_Off() { controlDevice("Room7_Light11", "off"); }
function Room7_Light11_Toggle() { controlDevice("Room7_Light11", "toggle"); }
function Room7_Light11_SetLevel(level) { controlDevice("Room7_Light11", "setlevel", level); }

function Room7_Light12_On() { controlDevice("Room7_Light12", "on"); }
function Room7_Light12_Off() { controlDevice("Room7_Light12", "off"); }
function Room7_Light12_Toggle() { controlDevice("Room7_Light12", "toggle"); }
function Room7_Light12_SetLevel(level) { controlDevice("Room7_Light12", "setlevel", level); }

function Room7_Light13_On() { controlDevice("Room7_Light13", "on"); }
function Room7_Light13_Off() { controlDevice("Room7_Light13", "off"); }
function Room7_Light13_Toggle() { controlDevice("Room7_Light13", "toggle"); }
function Room7_Light13_SetLevel(level) { controlDevice("Room7_Light13", "setlevel", level); }

function Room7_Light14_On() { controlDevice("Room7_Light14", "on"); }
function Room7_Light14_Off() { controlDevice("Room7_Light14", "off"); }
function Room7_Light14_Toggle() { controlDevice("Room7_Light14", "toggle"); }
function Room7_Light14_SetLevel(level) { controlDevice("Room7_Light14", "setlevel", level); }

function Room7_Light15_On() { controlDevice("Room7_Light15", "on"); }
function Room7_Light15_Off() { controlDevice("Room7_Light15", "off"); }
function Room7_Light15_Toggle() { controlDevice("Room7_Light15", "toggle"); }
function Room7_Light15_SetLevel(level) { controlDevice("Room7_Light15", "setlevel", level); }

function Room7_Light16_On() { controlDevice("Room7_Light16", "on"); }
function Room7_Light16_Off() { controlDevice("Room7_Light16", "off"); }
function Room7_Light16_Toggle() { controlDevice("Room7_Light16", "toggle"); }
function Room7_Light16_SetLevel(level) { controlDevice("Room7_Light16", "setlevel", level); }

function Room7_Light17_On() { controlDevice("Room7_Light17", "on"); }
function Room7_Light17_Off() { controlDevice("Room7_Light17", "off"); }
function Room7_Light17_Toggle() { controlDevice("Room7_Light17", "toggle"); }
function Room7_Light17_SetLevel(level) { controlDevice("Room7_Light17", "setlevel", level); }

function Room7_Light18_On() { controlDevice("Room7_Light18", "on"); }
function Room7_Light18_Off() { controlDevice("Room7_Light18", "off"); }
function Room7_Light18_Toggle() { controlDevice("Room7_Light18", "toggle"); }
function Room7_Light18_SetLevel(level) { controlDevice("Room7_Light18", "setlevel", level); }

function Room7_Light19_On() { controlDevice("Room7_Light19", "on"); }
function Room7_Light19_Off() { controlDevice("Room7_Light19", "off"); }
function Room7_Light19_Toggle() { controlDevice("Room7_Light19", "toggle"); }
function Room7_Light19_SetLevel(level) { controlDevice("Room7_Light19", "setlevel", level); }

function Room7_Light20_On() { controlDevice("Room7_Light20", "on"); }
function Room7_Light20_Off() { controlDevice("Room7_Light20", "off"); }
function Room7_Light20_Toggle() { controlDevice("Room7_Light20", "toggle"); }
function Room7_Light20_SetLevel(level) { controlDevice("Room7_Light20", "setlevel", level); }

// Room 7 Scene Functions
function Room7_Scene1_Activate() { activateScene("Room7_Scene1"); }
function Room7_Scene2_Activate() { activateScene("Room7_Scene2"); }
function Room7_Scene3_Activate() { activateScene("Room7_Scene3"); }
function Room7_Scene4_Activate() { activateScene("Room7_Scene4"); }
function Room7_Scene5_Activate() { activateScene("Room7_Scene5"); }
function Room7_Scene6_Activate() { activateScene("Room7_Scene6"); }
function Room7_Scene7_Activate() { activateScene("Room7_Scene7"); }
function Room7_Scene8_Activate() { activateScene("Room7_Scene8"); }
function Room7_Scene9_Activate() { activateScene("Room7_Scene9"); }
function Room7_Scene10_Activate() { activateScene("Room7_Scene10"); }
function Room7_Scene11_Activate() { activateScene("Room7_Scene11"); }
function Room7_Scene12_Activate() { activateScene("Room7_Scene12"); }
function Room7_Scene13_Activate() { activateScene("Room7_Scene13"); }
function Room7_Scene14_Activate() { activateScene("Room7_Scene14"); }
function Room7_Scene15_Activate() { activateScene("Room7_Scene15"); }
function Room7_Scene16_Activate() { activateScene("Room7_Scene16"); }
function Room7_Scene17_Activate() { activateScene("Room7_Scene17"); }
function Room7_Scene18_Activate() { activateScene("Room7_Scene18"); }
function Room7_Scene19_Activate() { activateScene("Room7_Scene19"); }
function Room7_Scene20_Activate() { activateScene("Room7_Scene20"); }

// Room 8 Light Functions
function Room8_Light1_On() { controlDevice("Room8_Light1", "on"); }
function Room8_Light1_Off() { controlDevice("Room8_Light1", "off"); }
function Room8_Light1_Toggle() { controlDevice("Room8_Light1", "toggle"); }
function Room8_Light1_SetLevel(level) { controlDevice("Room8_Light1", "setlevel", level); }

function Room8_Light2_On() { controlDevice("Room8_Light2", "on"); }
function Room8_Light2_Off() { controlDevice("Room8_Light2", "off"); }
function Room8_Light2_Toggle() { controlDevice("Room8_Light2", "toggle"); }
function Room8_Light2_SetLevel(level) { controlDevice("Room8_Light2", "setlevel", level); }

function Room8_Light3_On() { controlDevice("Room8_Light3", "on"); }
function Room8_Light3_Off() { controlDevice("Room8_Light3", "off"); }
function Room8_Light3_Toggle() { controlDevice("Room8_Light3", "toggle"); }
function Room8_Light3_SetLevel(level) { controlDevice("Room8_Light3", "setlevel", level); }

function Room8_Light4_On() { controlDevice("Room8_Light4", "on"); }
function Room8_Light4_Off() { controlDevice("Room8_Light4", "off"); }
function Room8_Light4_Toggle() { controlDevice("Room8_Light4", "toggle"); }
function Room8_Light4_SetLevel(level) { controlDevice("Room8_Light4", "setlevel", level); }

function Room8_Light5_On() { controlDevice("Room8_Light5", "on"); }
function Room8_Light5_Off() { controlDevice("Room8_Light5", "off"); }
function Room8_Light5_Toggle() { controlDevice("Room8_Light5", "toggle"); }
function Room8_Light5_SetLevel(level) { controlDevice("Room8_Light5", "setlevel", level); }

function Room8_Light6_On() { controlDevice("Room8_Light6", "on"); }
function Room8_Light6_Off() { controlDevice("Room8_Light6", "off"); }
function Room8_Light6_Toggle() { controlDevice("Room8_Light6", "toggle"); }
function Room8_Light6_SetLevel(level) { controlDevice("Room8_Light6", "setlevel", level); }

function Room8_Light7_On() { controlDevice("Room8_Light7", "on"); }
function Room8_Light7_Off() { controlDevice("Room8_Light7", "off"); }
function Room8_Light7_Toggle() { controlDevice("Room8_Light7", "toggle"); }
function Room8_Light7_SetLevel(level) { controlDevice("Room8_Light7", "setlevel", level); }

function Room8_Light8_On() { controlDevice("Room8_Light8", "on"); }
function Room8_Light8_Off() { controlDevice("Room8_Light8", "off"); }
function Room8_Light8_Toggle() { controlDevice("Room8_Light8", "toggle"); }
function Room8_Light8_SetLevel(level) { controlDevice("Room8_Light8", "setlevel", level); }

function Room8_Light9_On() { controlDevice("Room8_Light9", "on"); }
function Room8_Light9_Off() { controlDevice("Room8_Light9", "off"); }
function Room8_Light9_Toggle() { controlDevice("Room8_Light9", "toggle"); }
function Room8_Light9_SetLevel(level) { controlDevice("Room8_Light9", "setlevel", level); }

function Room8_Light10_On() { controlDevice("Room8_Light10", "on"); }
function Room8_Light10_Off() { controlDevice("Room8_Light10", "off"); }
function Room8_Light10_Toggle() { controlDevice("Room8_Light10", "toggle"); }
function Room8_Light10_SetLevel(level) { controlDevice("Room8_Light10", "setlevel", level); }

function Room8_Light11_On() { controlDevice("Room8_Light11", "on"); }
function Room8_Light11_Off() { controlDevice("Room8_Light11", "off"); }
function Room8_Light11_Toggle() { controlDevice("Room8_Light11", "toggle"); }
function Room8_Light11_SetLevel(level) { controlDevice("Room8_Light11", "setlevel", level); }

function Room8_Light12_On() { controlDevice("Room8_Light12", "on"); }
function Room8_Light12_Off() { controlDevice("Room8_Light12", "off"); }
function Room8_Light12_Toggle() { controlDevice("Room8_Light12", "toggle"); }
function Room8_Light12_SetLevel(level) { controlDevice("Room8_Light12", "setlevel", level); }

function Room8_Light13_On() { controlDevice("Room8_Light13", "on"); }
function Room8_Light13_Off() { controlDevice("Room8_Light13", "off"); }
function Room8_Light13_Toggle() { controlDevice("Room8_Light13", "toggle"); }
function Room8_Light13_SetLevel(level) { controlDevice("Room8_Light13", "setlevel", level); }

function Room8_Light14_On() { controlDevice("Room8_Light14", "on"); }
function Room8_Light14_Off() { controlDevice("Room8_Light14", "off"); }
function Room8_Light14_Toggle() { controlDevice("Room8_Light14", "toggle"); }
function Room8_Light14_SetLevel(level) { controlDevice("Room8_Light14", "setlevel", level); }

function Room8_Light15_On() { controlDevice("Room8_Light15", "on"); }
function Room8_Light15_Off() { controlDevice("Room8_Light15", "off"); }
function Room8_Light15_Toggle() { controlDevice("Room8_Light15", "toggle"); }
function Room8_Light15_SetLevel(level) { controlDevice("Room8_Light15", "setlevel", level); }

function Room8_Light16_On() { controlDevice("Room8_Light16", "on"); }
function Room8_Light16_Off() { controlDevice("Room8_Light16", "off"); }
function Room8_Light16_Toggle() { controlDevice("Room8_Light16", "toggle"); }
function Room8_Light16_SetLevel(level) { controlDevice("Room8_Light16", "setlevel", level); }

function Room8_Light17_On() { controlDevice("Room8_Light17", "on"); }
function Room8_Light17_Off() { controlDevice("Room8_Light17", "off"); }
function Room8_Light17_Toggle() { controlDevice("Room8_Light17", "toggle"); }
function Room8_Light17_SetLevel(level) { controlDevice("Room8_Light17", "setlevel", level); }

function Room8_Light18_On() { controlDevice("Room8_Light18", "on"); }
function Room8_Light18_Off() { controlDevice("Room8_Light18", "off"); }
function Room8_Light18_Toggle() { controlDevice("Room8_Light18", "toggle"); }
function Room8_Light18_SetLevel(level) { controlDevice("Room8_Light18", "setlevel", level); }

function Room8_Light19_On() { controlDevice("Room8_Light19", "on"); }
function Room8_Light19_Off() { controlDevice("Room8_Light19", "off"); }
function Room8_Light19_Toggle() { controlDevice("Room8_Light19", "toggle"); }
function Room8_Light19_SetLevel(level) { controlDevice("Room8_Light19", "setlevel", level); }

function Room8_Light20_On() { controlDevice("Room8_Light20", "on"); }
function Room8_Light20_Off() { controlDevice("Room8_Light20", "off"); }
function Room8_Light20_Toggle() { controlDevice("Room8_Light20", "toggle"); }
function Room8_Light20_SetLevel(level) { controlDevice("Room8_Light20", "setlevel", level); }

// Room 8 Scene Functions
function Room8_Scene1_Activate() { activateScene("Room8_Scene1"); }
function Room8_Scene2_Activate() { activateScene("Room8_Scene2"); }
function Room8_Scene3_Activate() { activateScene("Room8_Scene3"); }
function Room8_Scene4_Activate() { activateScene("Room8_Scene4"); }
function Room8_Scene5_Activate() { activateScene("Room8_Scene5"); }
function Room8_Scene6_Activate() { activateScene("Room8_Scene6"); }
function Room8_Scene7_Activate() { activateScene("Room8_Scene7"); }
function Room8_Scene8_Activate() { activateScene("Room8_Scene8"); }
function Room8_Scene9_Activate() { activateScene("Room8_Scene9"); }
function Room8_Scene10_Activate() { activateScene("Room8_Scene10"); }
function Room8_Scene11_Activate() { activateScene("Room8_Scene11"); }
function Room8_Scene12_Activate() { activateScene("Room8_Scene12"); }
function Room8_Scene13_Activate() { activateScene("Room8_Scene13"); }
function Room8_Scene14_Activate() { activateScene("Room8_Scene14"); }
function Room8_Scene15_Activate() { activateScene("Room8_Scene15"); }
function Room8_Scene16_Activate() { activateScene("Room8_Scene16"); }
function Room8_Scene17_Activate() { activateScene("Room8_Scene17"); }
function Room8_Scene18_Activate() { activateScene("Room8_Scene18"); }
function Room8_Scene19_Activate() { activateScene("Room8_Scene19"); }
function Room8_Scene20_Activate() { activateScene("Room8_Scene20"); }

// Room 9 Light Functions
function Room9_Light1_On() { controlDevice("Room9_Light1", "on"); }
function Room9_Light1_Off() { controlDevice("Room9_Light1", "off"); }
function Room9_Light1_Toggle() { controlDevice("Room9_Light1", "toggle"); }
function Room9_Light1_SetLevel(level) { controlDevice("Room9_Light1", "setlevel", level); }

function Room9_Light2_On() { controlDevice("Room9_Light2", "on"); }
function Room9_Light2_Off() { controlDevice("Room9_Light2", "off"); }
function Room9_Light2_Toggle() { controlDevice("Room9_Light2", "toggle"); }
function Room9_Light2_SetLevel(level) { controlDevice("Room9_Light2", "setlevel", level); }

function Room9_Light3_On() { controlDevice("Room9_Light3", "on"); }
function Room9_Light3_Off() { controlDevice("Room9_Light3", "off"); }
function Room9_Light3_Toggle() { controlDevice("Room9_Light3", "toggle"); }
function Room9_Light3_SetLevel(level) { controlDevice("Room9_Light3", "setlevel", level); }

function Room9_Light4_On() { controlDevice("Room9_Light4", "on"); }
function Room9_Light4_Off() { controlDevice("Room9_Light4", "off"); }
function Room9_Light4_Toggle() { controlDevice("Room9_Light4", "toggle"); }
function Room9_Light4_SetLevel(level) { controlDevice("Room9_Light4", "setlevel", level); }

function Room9_Light5_On() { controlDevice("Room9_Light5", "on"); }
function Room9_Light5_Off() { controlDevice("Room9_Light5", "off"); }
function Room9_Light5_Toggle() { controlDevice("Room9_Light5", "toggle"); }
function Room9_Light5_SetLevel(level) { controlDevice("Room9_Light5", "setlevel", level); }

function Room9_Light6_On() { controlDevice("Room9_Light6", "on"); }
function Room9_Light6_Off() { controlDevice("Room9_Light6", "off"); }
function Room9_Light6_Toggle() { controlDevice("Room9_Light6", "toggle"); }
function Room9_Light6_SetLevel(level) { controlDevice("Room9_Light6", "setlevel", level); }

function Room9_Light7_On() { controlDevice("Room9_Light7", "on"); }
function Room9_Light7_Off() { controlDevice("Room9_Light7", "off"); }
function Room9_Light7_Toggle() { controlDevice("Room9_Light7", "toggle"); }
function Room9_Light7_SetLevel(level) { controlDevice("Room9_Light7", "setlevel", level); }

function Room9_Light8_On() { controlDevice("Room9_Light8", "on"); }
function Room9_Light8_Off() { controlDevice("Room9_Light8", "off"); }
function Room9_Light8_Toggle() { controlDevice("Room9_Light8", "toggle"); }
function Room9_Light8_SetLevel(level) { controlDevice("Room9_Light8", "setlevel", level); }

function Room9_Light9_On() { controlDevice("Room9_Light9", "on"); }
function Room9_Light9_Off() { controlDevice("Room9_Light9", "off"); }
function Room9_Light9_Toggle() { controlDevice("Room9_Light9", "toggle"); }
function Room9_Light9_SetLevel(level) { controlDevice("Room9_Light9", "setlevel", level); }

function Room9_Light10_On() { controlDevice("Room9_Light10", "on"); }
function Room9_Light10_Off() { controlDevice("Room9_Light10", "off"); }
function Room9_Light10_Toggle() { controlDevice("Room9_Light10", "toggle"); }
function Room9_Light10_SetLevel(level) { controlDevice("Room9_Light10", "setlevel", level); }

function Room9_Light11_On() { controlDevice("Room9_Light11", "on"); }
function Room9_Light11_Off() { controlDevice("Room9_Light11", "off"); }
function Room9_Light11_Toggle() { controlDevice("Room9_Light11", "toggle"); }
function Room9_Light11_SetLevel(level) { controlDevice("Room9_Light11", "setlevel", level); }

function Room9_Light12_On() { controlDevice("Room9_Light12", "on"); }
function Room9_Light12_Off() { controlDevice("Room9_Light12", "off"); }
function Room9_Light12_Toggle() { controlDevice("Room9_Light12", "toggle"); }
function Room9_Light12_SetLevel(level) { controlDevice("Room9_Light12", "setlevel", level); }

function Room9_Light13_On() { controlDevice("Room9_Light13", "on"); }
function Room9_Light13_Off() { controlDevice("Room9_Light13", "off"); }
function Room9_Light13_Toggle() { controlDevice("Room9_Light13", "toggle"); }
function Room9_Light13_SetLevel(level) { controlDevice("Room9_Light13", "setlevel", level); }

function Room9_Light14_On() { controlDevice("Room9_Light14", "on"); }
function Room9_Light14_Off() { controlDevice("Room9_Light14", "off"); }
function Room9_Light14_Toggle() { controlDevice("Room9_Light14", "toggle"); }
function Room9_Light14_SetLevel(level) { controlDevice("Room9_Light14", "setlevel", level); }

function Room9_Light15_On() { controlDevice("Room9_Light15", "on"); }
function Room9_Light15_Off() { controlDevice("Room9_Light15", "off"); }
function Room9_Light15_Toggle() { controlDevice("Room9_Light15", "toggle"); }
function Room9_Light15_SetLevel(level) { controlDevice("Room9_Light15", "setlevel", level); }

function Room9_Light16_On() { controlDevice("Room9_Light16", "on"); }
function Room9_Light16_Off() { controlDevice("Room9_Light16", "off"); }
function Room9_Light16_Toggle() { controlDevice("Room9_Light16", "toggle"); }
function Room9_Light16_SetLevel(level) { controlDevice("Room9_Light16", "setlevel", level); }

function Room9_Light17_On() { controlDevice("Room9_Light17", "on"); }
function Room9_Light17_Off() { controlDevice("Room9_Light17", "off"); }
function Room9_Light17_Toggle() { controlDevice("Room9_Light17", "toggle"); }
function Room9_Light17_SetLevel(level) { controlDevice("Room9_Light17", "setlevel", level); }

function Room9_Light18_On() { controlDevice("Room9_Light18", "on"); }
function Room9_Light18_Off() { controlDevice("Room9_Light18", "off"); }
function Room9_Light18_Toggle() { controlDevice("Room9_Light18", "toggle"); }
function Room9_Light18_SetLevel(level) { controlDevice("Room9_Light18", "setlevel", level); }

function Room9_Light19_On() { controlDevice("Room9_Light19", "on"); }
function Room9_Light19_Off() { controlDevice("Room9_Light19", "off"); }
function Room9_Light19_Toggle() { controlDevice("Room9_Light19", "toggle"); }
function Room9_Light19_SetLevel(level) { controlDevice("Room9_Light19", "setlevel", level); }

function Room9_Light20_On() { controlDevice("Room9_Light20", "on"); }
function Room9_Light20_Off() { controlDevice("Room9_Light20", "off"); }
function Room9_Light20_Toggle() { controlDevice("Room9_Light20", "toggle"); }
function Room9_Light20_SetLevel(level) { controlDevice("Room9_Light20", "setlevel", level); }

// Room 9 Scene Functions
function Room9_Scene1_Activate() { activateScene("Room9_Scene1"); }
function Room9_Scene2_Activate() { activateScene("Room9_Scene2"); }
function Room9_Scene3_Activate() { activateScene("Room9_Scene3"); }
function Room9_Scene4_Activate() { activateScene("Room9_Scene4"); }
function Room9_Scene5_Activate() { activateScene("Room9_Scene5"); }
function Room9_Scene6_Activate() { activateScene("Room9_Scene6"); }
function Room9_Scene7_Activate() { activateScene("Room9_Scene7"); }
function Room9_Scene8_Activate() { activateScene("Room9_Scene8"); }
function Room9_Scene9_Activate() { activateScene("Room9_Scene9"); }
function Room9_Scene10_Activate() { activateScene("Room9_Scene10"); }
function Room9_Scene11_Activate() { activateScene("Room9_Scene11"); }
function Room9_Scene12_Activate() { activateScene("Room9_Scene12"); }
function Room9_Scene13_Activate() { activateScene("Room9_Scene13"); }
function Room9_Scene14_Activate() { activateScene("Room9_Scene14"); }
function Room9_Scene15_Activate() { activateScene("Room9_Scene15"); }
function Room9_Scene16_Activate() { activateScene("Room9_Scene16"); }
function Room9_Scene17_Activate() { activateScene("Room9_Scene17"); }
function Room9_Scene18_Activate() { activateScene("Room9_Scene18"); }
function Room9_Scene19_Activate() { activateScene("Room9_Scene19"); }
function Room9_Scene20_Activate() { activateScene("Room9_Scene20"); }

// Room 10 Light Functions
function Room10_Light1_On() { controlDevice("Room10_Light1", "on"); }
function Room10_Light1_Off() { controlDevice("Room10_Light1", "off"); }
function Room10_Light1_Toggle() { controlDevice("Room10_Light1", "toggle"); }
function Room10_Light1_SetLevel(level) { controlDevice("Room10_Light1", "setlevel", level); }

function Room10_Light2_On() { controlDevice("Room10_Light2", "on"); }
function Room10_Light2_Off() { controlDevice("Room10_Light2", "off"); }
function Room10_Light2_Toggle() { controlDevice("Room10_Light2", "toggle"); }
function Room10_Light2_SetLevel(level) { controlDevice("Room10_Light2", "setlevel", level); }

function Room10_Light3_On() { controlDevice("Room10_Light3", "on"); }
function Room10_Light3_Off() { controlDevice("Room10_Light3", "off"); }
function Room10_Light3_Toggle() { controlDevice("Room10_Light3", "toggle"); }
function Room10_Light3_SetLevel(level) { controlDevice("Room10_Light3", "setlevel", level); }

function Room10_Light4_On() { controlDevice("Room10_Light4", "on"); }
function Room10_Light4_Off() { controlDevice("Room10_Light4", "off"); }
function Room10_Light4_Toggle() { controlDevice("Room10_Light4", "toggle"); }
function Room10_Light4_SetLevel(level) { controlDevice("Room10_Light4", "setlevel", level); }

function Room10_Light5_On() { controlDevice("Room10_Light5", "on"); }
function Room10_Light5_Off() { controlDevice("Room10_Light5", "off"); }
function Room10_Light5_Toggle() { controlDevice("Room10_Light5", "toggle"); }
function Room10_Light5_SetLevel(level) { controlDevice("Room10_Light5", "setlevel", level); }

function Room10_Light6_On() { controlDevice("Room10_Light6", "on"); }
function Room10_Light6_Off() { controlDevice("Room10_Light6", "off"); }
function Room10_Light6_Toggle() { controlDevice("Room10_Light6", "toggle"); }
function Room10_Light6_SetLevel(level) { controlDevice("Room10_Light6", "setlevel", level); }

function Room10_Light7_On() { controlDevice("Room10_Light7", "on"); }
function Room10_Light7_Off() { controlDevice("Room10_Light7", "off"); }
function Room10_Light7_Toggle() { controlDevice("Room10_Light7", "toggle"); }
function Room10_Light7_SetLevel(level) { controlDevice("Room10_Light7", "setlevel", level); }

function Room10_Light8_On() { controlDevice("Room10_Light8", "on"); }
function Room10_Light8_Off() { controlDevice("Room10_Light8", "off"); }
function Room10_Light8_Toggle() { controlDevice("Room10_Light8", "toggle"); }
function Room10_Light8_SetLevel(level) { controlDevice("Room10_Light8", "setlevel", level); }

function Room10_Light9_On() { controlDevice("Room10_Light9", "on"); }
function Room10_Light9_Off() { controlDevice("Room10_Light9", "off"); }
function Room10_Light9_Toggle() { controlDevice("Room10_Light9", "toggle"); }
function Room10_Light9_SetLevel(level) { controlDevice("Room10_Light9", "setlevel", level); }

function Room10_Light10_On() { controlDevice("Room10_Light10", "on"); }
function Room10_Light10_Off() { controlDevice("Room10_Light10", "off"); }
function Room10_Light10_Toggle() { controlDevice("Room10_Light10", "toggle"); }
function Room10_Light10_SetLevel(level) { controlDevice("Room10_Light10", "setlevel", level); }

function Room10_Light11_On() { controlDevice("Room10_Light11", "on"); }
function Room10_Light11_Off() { controlDevice("Room10_Light11", "off"); }
function Room10_Light11_Toggle() { controlDevice("Room10_Light11", "toggle"); }
function Room10_Light11_SetLevel(level) { controlDevice("Room10_Light11", "setlevel", level); }

function Room10_Light12_On() { controlDevice("Room10_Light12", "on"); }
function Room10_Light12_Off() { controlDevice("Room10_Light12", "off"); }
function Room10_Light12_Toggle() { controlDevice("Room10_Light12", "toggle"); }
function Room10_Light12_SetLevel(level) { controlDevice("Room10_Light12", "setlevel", level); }

function Room10_Light13_On() { controlDevice("Room10_Light13", "on"); }
function Room10_Light13_Off() { controlDevice("Room10_Light13", "off"); }
function Room10_Light13_Toggle() { controlDevice("Room10_Light13", "toggle"); }
function Room10_Light13_SetLevel(level) { controlDevice("Room10_Light13", "setlevel", level); }

function Room10_Light14_On() { controlDevice("Room10_Light14", "on"); }
function Room10_Light14_Off() { controlDevice("Room10_Light14", "off"); }
function Room10_Light14_Toggle() { controlDevice("Room10_Light14", "toggle"); }
function Room10_Light14_SetLevel(level) { controlDevice("Room10_Light14", "setlevel", level); }

function Room10_Light15_On() { controlDevice("Room10_Light15", "on"); }
function Room10_Light15_Off() { controlDevice("Room10_Light15", "off"); }
function Room10_Light15_Toggle() { controlDevice("Room10_Light15", "toggle"); }
function Room10_Light15_SetLevel(level) { controlDevice("Room10_Light15", "setlevel", level); }

function Room10_Light16_On() { controlDevice("Room10_Light16", "on"); }
function Room10_Light16_Off() { controlDevice("Room10_Light16", "off"); }
function Room10_Light16_Toggle() { controlDevice("Room10_Light16", "toggle"); }
function Room10_Light16_SetLevel(level) { controlDevice("Room10_Light16", "setlevel", level); }

function Room10_Light17_On() { controlDevice("Room10_Light17", "on"); }
function Room10_Light17_Off() { controlDevice("Room10_Light17", "off"); }
function Room10_Light17_Toggle() { controlDevice("Room10_Light17", "toggle"); }
function Room10_Light17_SetLevel(level) { controlDevice("Room10_Light17", "setlevel", level); }

function Room10_Light18_On() { controlDevice("Room10_Light18", "on"); }
function Room10_Light18_Off() { controlDevice("Room10_Light18", "off"); }
function Room10_Light18_Toggle() { controlDevice("Room10_Light18", "toggle"); }
function Room10_Light18_SetLevel(level) { controlDevice("Room10_Light18", "setlevel", level); }

function Room10_Light19_On() { controlDevice("Room10_Light19", "on"); }
function Room10_Light19_Off() { controlDevice("Room10_Light19", "off"); }
function Room10_Light19_Toggle() { controlDevice("Room10_Light19", "toggle"); }
function Room10_Light19_SetLevel(level) { controlDevice("Room10_Light19", "setlevel", level); }

function Room10_Light20_On() { controlDevice("Room10_Light20", "on"); }
function Room10_Light20_Off() { controlDevice("Room10_Light20", "off"); }
function Room10_Light20_Toggle() { controlDevice("Room10_Light20", "toggle"); }
function Room10_Light20_SetLevel(level) { controlDevice("Room10_Light20", "setlevel", level); }

// Room 10 Scene Functions
function Room10_Scene1_Activate() { activateScene("Room10_Scene1"); }
function Room10_Scene2_Activate() { activateScene("Room10_Scene2"); }
function Room10_Scene3_Activate() { activateScene("Room10_Scene3"); }
function Room10_Scene4_Activate() { activateScene("Room10_Scene4"); }
function Room10_Scene5_Activate() { activateScene("Room10_Scene5"); }
function Room10_Scene6_Activate() { activateScene("Room10_Scene6"); }
function Room10_Scene7_Activate() { activateScene("Room10_Scene7"); }
function Room10_Scene8_Activate() { activateScene("Room10_Scene8"); }
function Room10_Scene9_Activate() { activateScene("Room10_Scene9"); }
function Room10_Scene10_Activate() { activateScene("Room10_Scene10"); }
function Room10_Scene11_Activate() { activateScene("Room10_Scene11"); }
function Room10_Scene12_Activate() { activateScene("Room10_Scene12"); }
function Room10_Scene13_Activate() { activateScene("Room10_Scene13"); }
function Room10_Scene14_Activate() { activateScene("Room10_Scene14"); }
function Room10_Scene15_Activate() { activateScene("Room10_Scene15"); }
function Room10_Scene16_Activate() { activateScene("Room10_Scene16"); }
function Room10_Scene17_Activate() { activateScene("Room10_Scene17"); }
function Room10_Scene18_Activate() { activateScene("Room10_Scene18"); }
function Room10_Scene19_Activate() { activateScene("Room10_Scene19"); }
function Room10_Scene20_Activate() { activateScene("Room10_Scene20"); }

// Room 11 Light Functions
function Room11_Light1_On() { controlDevice("Room11_Light1", "on"); }
function Room11_Light1_Off() { controlDevice("Room11_Light1", "off"); }
function Room11_Light1_Toggle() { controlDevice("Room11_Light1", "toggle"); }
function Room11_Light1_SetLevel(level) { controlDevice("Room11_Light1", "setlevel", level); }

function Room11_Light2_On() { controlDevice("Room11_Light2", "on"); }
function Room11_Light2_Off() { controlDevice("Room11_Light2", "off"); }
function Room11_Light2_Toggle() { controlDevice("Room11_Light2", "toggle"); }
function Room11_Light2_SetLevel(level) { controlDevice("Room11_Light2", "setlevel", level); }

function Room11_Light3_On() { controlDevice("Room11_Light3", "on"); }
function Room11_Light3_Off() { controlDevice("Room11_Light3", "off"); }
function Room11_Light3_Toggle() { controlDevice("Room11_Light3", "toggle"); }
function Room11_Light3_SetLevel(level) { controlDevice("Room11_Light3", "setlevel", level); }

function Room11_Light4_On() { controlDevice("Room11_Light4", "on"); }
function Room11_Light4_Off() { controlDevice("Room11_Light4", "off"); }
function Room11_Light4_Toggle() { controlDevice("Room11_Light4", "toggle"); }
function Room11_Light4_SetLevel(level) { controlDevice("Room11_Light4", "setlevel", level); }

function Room11_Light5_On() { controlDevice("Room11_Light5", "on"); }
function Room11_Light5_Off() { controlDevice("Room11_Light5", "off"); }
function Room11_Light5_Toggle() { controlDevice("Room11_Light5", "toggle"); }
function Room11_Light5_SetLevel(level) { controlDevice("Room11_Light5", "setlevel", level); }

function Room11_Light6_On() { controlDevice("Room11_Light6", "on"); }
function Room11_Light6_Off() { controlDevice("Room11_Light6", "off"); }
function Room11_Light6_Toggle() { controlDevice("Room11_Light6", "toggle"); }
function Room11_Light6_SetLevel(level) { controlDevice("Room11_Light6", "setlevel", level); }

function Room11_Light7_On() { controlDevice("Room11_Light7", "on"); }
function Room11_Light7_Off() { controlDevice("Room11_Light7", "off"); }
function Room11_Light7_Toggle() { controlDevice("Room11_Light7", "toggle"); }
function Room11_Light7_SetLevel(level) { controlDevice("Room11_Light7", "setlevel", level); }

function Room11_Light8_On() { controlDevice("Room11_Light8", "on"); }
function Room11_Light8_Off() { controlDevice("Room11_Light8", "off"); }
function Room11_Light8_Toggle() { controlDevice("Room11_Light8", "toggle"); }
function Room11_Light8_SetLevel(level) { controlDevice("Room11_Light8", "setlevel", level); }

function Room11_Light9_On() { controlDevice("Room11_Light9", "on"); }
function Room11_Light9_Off() { controlDevice("Room11_Light9", "off"); }
function Room11_Light9_Toggle() { controlDevice("Room11_Light9", "toggle"); }
function Room11_Light9_SetLevel(level) { controlDevice("Room11_Light9", "setlevel", level); }

function Room11_Light10_On() { controlDevice("Room11_Light10", "on"); }
function Room11_Light10_Off() { controlDevice("Room11_Light10", "off"); }
function Room11_Light10_Toggle() { controlDevice("Room11_Light10", "toggle"); }
function Room11_Light10_SetLevel(level) { controlDevice("Room11_Light10", "setlevel", level); }

function Room11_Light11_On() { controlDevice("Room11_Light11", "on"); }
function Room11_Light11_Off() { controlDevice("Room11_Light11", "off"); }
function Room11_Light11_Toggle() { controlDevice("Room11_Light11", "toggle"); }
function Room11_Light11_SetLevel(level) { controlDevice("Room11_Light11", "setlevel", level); }

function Room11_Light12_On() { controlDevice("Room11_Light12", "on"); }
function Room11_Light12_Off() { controlDevice("Room11_Light12", "off"); }
function Room11_Light12_Toggle() { controlDevice("Room11_Light12", "toggle"); }
function Room11_Light12_SetLevel(level) { controlDevice("Room11_Light12", "setlevel", level); }

function Room11_Light13_On() { controlDevice("Room11_Light13", "on"); }
function Room11_Light13_Off() { controlDevice("Room11_Light13", "off"); }
function Room11_Light13_Toggle() { controlDevice("Room11_Light13", "toggle"); }
function Room11_Light13_SetLevel(level) { controlDevice("Room11_Light13", "setlevel", level); }

function Room11_Light14_On() { controlDevice("Room11_Light14", "on"); }
function Room11_Light14_Off() { controlDevice("Room11_Light14", "off"); }
function Room11_Light14_Toggle() { controlDevice("Room11_Light14", "toggle"); }
function Room11_Light14_SetLevel(level) { controlDevice("Room11_Light14", "setlevel", level); }

function Room11_Light15_On() { controlDevice("Room11_Light15", "on"); }
function Room11_Light15_Off() { controlDevice("Room11_Light15", "off"); }
function Room11_Light15_Toggle() { controlDevice("Room11_Light15", "toggle"); }
function Room11_Light15_SetLevel(level) { controlDevice("Room11_Light15", "setlevel", level); }

function Room11_Light16_On() { controlDevice("Room11_Light16", "on"); }
function Room11_Light16_Off() { controlDevice("Room11_Light16", "off"); }
function Room11_Light16_Toggle() { controlDevice("Room11_Light16", "toggle"); }
function Room11_Light16_SetLevel(level) { controlDevice("Room11_Light16", "setlevel", level); }

function Room11_Light17_On() { controlDevice("Room11_Light17", "on"); }
function Room11_Light17_Off() { controlDevice("Room11_Light17", "off"); }
function Room11_Light17_Toggle() { controlDevice("Room11_Light17", "toggle"); }
function Room11_Light17_SetLevel(level) { controlDevice("Room11_Light17", "setlevel", level); }

function Room11_Light18_On() { controlDevice("Room11_Light18", "on"); }
function Room11_Light18_Off() { controlDevice("Room11_Light18", "off"); }
function Room11_Light18_Toggle() { controlDevice("Room11_Light18", "toggle"); }
function Room11_Light18_SetLevel(level) { controlDevice("Room11_Light18", "setlevel", level); }

function Room11_Light19_On() { controlDevice("Room11_Light19", "on"); }
function Room11_Light19_Off() { controlDevice("Room11_Light19", "off"); }
function Room11_Light19_Toggle() { controlDevice("Room11_Light19", "toggle"); }
function Room11_Light19_SetLevel(level) { controlDevice("Room11_Light19", "setlevel", level); }

function Room11_Light20_On() { controlDevice("Room11_Light20", "on"); }
function Room11_Light20_Off() { controlDevice("Room11_Light20", "off"); }
function Room11_Light20_Toggle() { controlDevice("Room11_Light20", "toggle"); }
function Room11_Light20_SetLevel(level) { controlDevice("Room11_Light20", "setlevel", level); }

// Room 11 Scene Functions
function Room11_Scene1_Activate() { activateScene("Room11_Scene1"); }
function Room11_Scene2_Activate() { activateScene("Room11_Scene2"); }
function Room11_Scene3_Activate() { activateScene("Room11_Scene3"); }
function Room11_Scene4_Activate() { activateScene("Room11_Scene4"); }
function Room11_Scene5_Activate() { activateScene("Room11_Scene5"); }
function Room11_Scene6_Activate() { activateScene("Room11_Scene6"); }
function Room11_Scene7_Activate() { activateScene("Room11_Scene7"); }
function Room11_Scene8_Activate() { activateScene("Room11_Scene8"); }
function Room11_Scene9_Activate() { activateScene("Room11_Scene9"); }
function Room11_Scene10_Activate() { activateScene("Room11_Scene10"); }
function Room11_Scene11_Activate() { activateScene("Room11_Scene11"); }
function Room11_Scene12_Activate() { activateScene("Room11_Scene12"); }
function Room11_Scene13_Activate() { activateScene("Room11_Scene13"); }
function Room11_Scene14_Activate() { activateScene("Room11_Scene14"); }
function Room11_Scene15_Activate() { activateScene("Room11_Scene15"); }
function Room11_Scene16_Activate() { activateScene("Room11_Scene16"); }
function Room11_Scene17_Activate() { activateScene("Room11_Scene17"); }
function Room11_Scene18_Activate() { activateScene("Room11_Scene18"); }
function Room11_Scene19_Activate() { activateScene("Room11_Scene19"); }
function Room11_Scene20_Activate() { activateScene("Room11_Scene20"); }

// Room 12 Light Functions
function Room12_Light1_On() { controlDevice("Room12_Light1", "on"); }
function Room12_Light1_Off() { controlDevice("Room12_Light1", "off"); }
function Room12_Light1_Toggle() { controlDevice("Room12_Light1", "toggle"); }
function Room12_Light1_SetLevel(level) { controlDevice("Room12_Light1", "setlevel", level); }

function Room12_Light2_On() { controlDevice("Room12_Light2", "on"); }
function Room12_Light2_Off() { controlDevice("Room12_Light2", "off"); }
function Room12_Light2_Toggle() { controlDevice("Room12_Light2", "toggle"); }
function Room12_Light2_SetLevel(level) { controlDevice("Room12_Light2", "setlevel", level); }

function Room12_Light3_On() { controlDevice("Room12_Light3", "on"); }
function Room12_Light3_Off() { controlDevice("Room12_Light3", "off"); }
function Room12_Light3_Toggle() { controlDevice("Room12_Light3", "toggle"); }
function Room12_Light3_SetLevel(level) { controlDevice("Room12_Light3", "setlevel", level); }

function Room12_Light4_On() { controlDevice("Room12_Light4", "on"); }
function Room12_Light4_Off() { controlDevice("Room12_Light4", "off"); }
function Room12_Light4_Toggle() { controlDevice("Room12_Light4", "toggle"); }
function Room12_Light4_SetLevel(level) { controlDevice("Room12_Light4", "setlevel", level); }

function Room12_Light5_On() { controlDevice("Room12_Light5", "on"); }
function Room12_Light5_Off() { controlDevice("Room12_Light5", "off"); }
function Room12_Light5_Toggle() { controlDevice("Room12_Light5", "toggle"); }
function Room12_Light5_SetLevel(level) { controlDevice("Room12_Light5", "setlevel", level); }

function Room12_Light6_On() { controlDevice("Room12_Light6", "on"); }
function Room12_Light6_Off() { controlDevice("Room12_Light6", "off"); }
function Room12_Light6_Toggle() { controlDevice("Room12_Light6", "toggle"); }
function Room12_Light6_SetLevel(level) { controlDevice("Room12_Light6", "setlevel", level); }

function Room12_Light7_On() { controlDevice("Room12_Light7", "on"); }
function Room12_Light7_Off() { controlDevice("Room12_Light7", "off"); }
function Room12_Light7_Toggle() { controlDevice("Room12_Light7", "toggle"); }
function Room12_Light7_SetLevel(level) { controlDevice("Room12_Light7", "setlevel", level); }

function Room12_Light8_On() { controlDevice("Room12_Light8", "on"); }
function Room12_Light8_Off() { controlDevice("Room12_Light8", "off"); }
function Room12_Light8_Toggle() { controlDevice("Room12_Light8", "toggle"); }
function Room12_Light8_SetLevel(level) { controlDevice("Room12_Light8", "setlevel", level); }

function Room12_Light9_On() { controlDevice("Room12_Light9", "on"); }
function Room12_Light9_Off() { controlDevice("Room12_Light9", "off"); }
function Room12_Light9_Toggle() { controlDevice("Room12_Light9", "toggle"); }
function Room12_Light9_SetLevel(level) { controlDevice("Room12_Light9", "setlevel", level); }

function Room12_Light10_On() { controlDevice("Room12_Light10", "on"); }
function Room12_Light10_Off() { controlDevice("Room12_Light10", "off"); }
function Room12_Light10_Toggle() { controlDevice("Room12_Light10", "toggle"); }
function Room12_Light10_SetLevel(level) { controlDevice("Room12_Light10", "setlevel", level); }

function Room12_Light11_On() { controlDevice("Room12_Light11", "on"); }
function Room12_Light11_Off() { controlDevice("Room12_Light11", "off"); }
function Room12_Light11_Toggle() { controlDevice("Room12_Light11", "toggle"); }
function Room12_Light11_SetLevel(level) { controlDevice("Room12_Light11", "setlevel", level); }

function Room12_Light12_On() { controlDevice("Room12_Light12", "on"); }
function Room12_Light12_Off() { controlDevice("Room12_Light12", "off"); }
function Room12_Light12_Toggle() { controlDevice("Room12_Light12", "toggle"); }
function Room12_Light12_SetLevel(level) { controlDevice("Room12_Light12", "setlevel", level); }

function Room12_Light13_On() { controlDevice("Room12_Light13", "on"); }
function Room12_Light13_Off() { controlDevice("Room12_Light13", "off"); }
function Room12_Light13_Toggle() { controlDevice("Room12_Light13", "toggle"); }
function Room12_Light13_SetLevel(level) { controlDevice("Room12_Light13", "setlevel", level); }

function Room12_Light14_On() { controlDevice("Room12_Light14", "on"); }
function Room12_Light14_Off() { controlDevice("Room12_Light14", "off"); }
function Room12_Light14_Toggle() { controlDevice("Room12_Light14", "toggle"); }
function Room12_Light14_SetLevel(level) { controlDevice("Room12_Light14", "setlevel", level); }

function Room12_Light15_On() { controlDevice("Room12_Light15", "on"); }
function Room12_Light15_Off() { controlDevice("Room12_Light15", "off"); }
function Room12_Light15_Toggle() { controlDevice("Room12_Light15", "toggle"); }
function Room12_Light15_SetLevel(level) { controlDevice("Room12_Light15", "setlevel", level); }

function Room12_Light16_On() { controlDevice("Room12_Light16", "on"); }
function Room12_Light16_Off() { controlDevice("Room12_Light16", "off"); }
function Room12_Light16_Toggle() { controlDevice("Room12_Light16", "toggle"); }
function Room12_Light16_SetLevel(level) { controlDevice("Room12_Light16", "setlevel", level); }

function Room12_Light17_On() { controlDevice("Room12_Light17", "on"); }
function Room12_Light17_Off() { controlDevice("Room12_Light17", "off"); }
function Room12_Light17_Toggle() { controlDevice("Room12_Light17", "toggle"); }
function Room12_Light17_SetLevel(level) { controlDevice("Room12_Light17", "setlevel", level); }

function Room12_Light18_On() { controlDevice("Room12_Light18", "on"); }
function Room12_Light18_Off() { controlDevice("Room12_Light18", "off"); }
function Room12_Light18_Toggle() { controlDevice("Room12_Light18", "toggle"); }
function Room12_Light18_SetLevel(level) { controlDevice("Room12_Light18", "setlevel", level); }

function Room12_Light19_On() { controlDevice("Room12_Light19", "on"); }
function Room12_Light19_Off() { controlDevice("Room12_Light19", "off"); }
function Room12_Light19_Toggle() { controlDevice("Room12_Light19", "toggle"); }
function Room12_Light19_SetLevel(level) { controlDevice("Room12_Light19", "setlevel", level); }

function Room12_Light20_On() { controlDevice("Room12_Light20", "on"); }
function Room12_Light20_Off() { controlDevice("Room12_Light20", "off"); }
function Room12_Light20_Toggle() { controlDevice("Room12_Light20", "toggle"); }
function Room12_Light20_SetLevel(level) { controlDevice("Room12_Light20", "setlevel", level); }

// Room 12 Scene Functions
function Room12_Scene1_Activate() { activateScene("Room12_Scene1"); }
function Room12_Scene2_Activate() { activateScene("Room12_Scene2"); }
function Room12_Scene3_Activate() { activateScene("Room12_Scene3"); }
function Room12_Scene4_Activate() { activateScene("Room12_Scene4"); }
function Room12_Scene5_Activate() { activateScene("Room12_Scene5"); }
function Room12_Scene6_Activate() { activateScene("Room12_Scene6"); }
function Room12_Scene7_Activate() { activateScene("Room12_Scene7"); }
function Room12_Scene8_Activate() { activateScene("Room12_Scene8"); }
function Room12_Scene9_Activate() { activateScene("Room12_Scene9"); }
function Room12_Scene10_Activate() { activateScene("Room12_Scene10"); }
function Room12_Scene11_Activate() { activateScene("Room12_Scene11"); }
function Room12_Scene12_Activate() { activateScene("Room12_Scene12"); }
function Room12_Scene13_Activate() { activateScene("Room12_Scene13"); }
function Room12_Scene14_Activate() { activateScene("Room12_Scene14"); }
function Room12_Scene15_Activate() { activateScene("Room12_Scene15"); }
function Room12_Scene16_Activate() { activateScene("Room12_Scene16"); }
function Room12_Scene17_Activate() { activateScene("Room12_Scene17"); }
function Room12_Scene18_Activate() { activateScene("Room12_Scene18"); }
function Room12_Scene19_Activate() { activateScene("Room12_Scene19"); }
function Room12_Scene20_Activate() { activateScene("Room12_Scene20"); }

// Room 13 Light Functions
function Room13_Light1_On() { controlDevice("Room13_Light1", "on"); }
function Room13_Light1_Off() { controlDevice("Room13_Light1", "off"); }
function Room13_Light1_Toggle() { controlDevice("Room13_Light1", "toggle"); }
function Room13_Light1_SetLevel(level) { controlDevice("Room13_Light1", "setlevel", level); }

function Room13_Light2_On() { controlDevice("Room13_Light2", "on"); }
function Room13_Light2_Off() { controlDevice("Room13_Light2", "off"); }
function Room13_Light2_Toggle() { controlDevice("Room13_Light2", "toggle"); }
function Room13_Light2_SetLevel(level) { controlDevice("Room13_Light2", "setlevel", level); }

function Room13_Light3_On() { controlDevice("Room13_Light3", "on"); }
function Room13_Light3_Off() { controlDevice("Room13_Light3", "off"); }
function Room13_Light3_Toggle() { controlDevice("Room13_Light3", "toggle"); }
function Room13_Light3_SetLevel(level) { controlDevice("Room13_Light3", "setlevel", level); }

function Room13_Light4_On() { controlDevice("Room13_Light4", "on"); }
function Room13_Light4_Off() { controlDevice("Room13_Light4", "off"); }
function Room13_Light4_Toggle() { controlDevice("Room13_Light4", "toggle"); }
function Room13_Light4_SetLevel(level) { controlDevice("Room13_Light4", "setlevel", level); }

function Room13_Light5_On() { controlDevice("Room13_Light5", "on"); }
function Room13_Light5_Off() { controlDevice("Room13_Light5", "off"); }
function Room13_Light5_Toggle() { controlDevice("Room13_Light5", "toggle"); }
function Room13_Light5_SetLevel(level) { controlDevice("Room13_Light5", "setlevel", level); }

function Room13_Light6_On() { controlDevice("Room13_Light6", "on"); }
function Room13_Light6_Off() { controlDevice("Room13_Light6", "off"); }
function Room13_Light6_Toggle() { controlDevice("Room13_Light6", "toggle"); }
function Room13_Light6_SetLevel(level) { controlDevice("Room13_Light6", "setlevel", level); }

function Room13_Light7_On() { controlDevice("Room13_Light7", "on"); }
function Room13_Light7_Off() { controlDevice("Room13_Light7", "off"); }
function Room13_Light7_Toggle() { controlDevice("Room13_Light7", "toggle"); }
function Room13_Light7_SetLevel(level) { controlDevice("Room13_Light7", "setlevel", level); }

function Room13_Light8_On() { controlDevice("Room13_Light8", "on"); }
function Room13_Light8_Off() { controlDevice("Room13_Light8", "off"); }
function Room13_Light8_Toggle() { controlDevice("Room13_Light8", "toggle"); }
function Room13_Light8_SetLevel(level) { controlDevice("Room13_Light8", "setlevel", level); }

function Room13_Light9_On() { controlDevice("Room13_Light9", "on"); }
function Room13_Light9_Off() { controlDevice("Room13_Light9", "off"); }
function Room13_Light9_Toggle() { controlDevice("Room13_Light9", "toggle"); }
function Room13_Light9_SetLevel(level) { controlDevice("Room13_Light9", "setlevel", level); }

function Room13_Light10_On() { controlDevice("Room13_Light10", "on"); }
function Room13_Light10_Off() { controlDevice("Room13_Light10", "off"); }
function Room13_Light10_Toggle() { controlDevice("Room13_Light10", "toggle"); }
function Room13_Light10_SetLevel(level) { controlDevice("Room13_Light10", "setlevel", level); }

function Room13_Light11_On() { controlDevice("Room13_Light11", "on"); }
function Room13_Light11_Off() { controlDevice("Room13_Light11", "off"); }
function Room13_Light11_Toggle() { controlDevice("Room13_Light11", "toggle"); }
function Room13_Light11_SetLevel(level) { controlDevice("Room13_Light11", "setlevel", level); }

function Room13_Light12_On() { controlDevice("Room13_Light12", "on"); }
function Room13_Light12_Off() { controlDevice("Room13_Light12", "off"); }
function Room13_Light12_Toggle() { controlDevice("Room13_Light12", "toggle"); }
function Room13_Light12_SetLevel(level) { controlDevice("Room13_Light12", "setlevel", level); }

function Room13_Light13_On() { controlDevice("Room13_Light13", "on"); }
function Room13_Light13_Off() { controlDevice("Room13_Light13", "off"); }
function Room13_Light13_Toggle() { controlDevice("Room13_Light13", "toggle"); }
function Room13_Light13_SetLevel(level) { controlDevice("Room13_Light13", "setlevel", level); }

function Room13_Light14_On() { controlDevice("Room13_Light14", "on"); }
function Room13_Light14_Off() { controlDevice("Room13_Light14", "off"); }
function Room13_Light14_Toggle() { controlDevice("Room13_Light14", "toggle"); }
function Room13_Light14_SetLevel(level) { controlDevice("Room13_Light14", "setlevel", level); }

function Room13_Light15_On() { controlDevice("Room13_Light15", "on"); }
function Room13_Light15_Off() { controlDevice("Room13_Light15", "off"); }
function Room13_Light15_Toggle() { controlDevice("Room13_Light15", "toggle"); }
function Room13_Light15_SetLevel(level) { controlDevice("Room13_Light15", "setlevel", level); }

function Room13_Light16_On() { controlDevice("Room13_Light16", "on"); }
function Room13_Light16_Off() { controlDevice("Room13_Light16", "off"); }
function Room13_Light16_Toggle() { controlDevice("Room13_Light16", "toggle"); }
function Room13_Light16_SetLevel(level) { controlDevice("Room13_Light16", "setlevel", level); }

function Room13_Light17_On() { controlDevice("Room13_Light17", "on"); }
function Room13_Light17_Off() { controlDevice("Room13_Light17", "off"); }
function Room13_Light17_Toggle() { controlDevice("Room13_Light17", "toggle"); }
function Room13_Light17_SetLevel(level) { controlDevice("Room13_Light17", "setlevel", level); }

function Room13_Light18_On() { controlDevice("Room13_Light18", "on"); }
function Room13_Light18_Off() { controlDevice("Room13_Light18", "off"); }
function Room13_Light18_Toggle() { controlDevice("Room13_Light18", "toggle"); }
function Room13_Light18_SetLevel(level) { controlDevice("Room13_Light18", "setlevel", level); }

function Room13_Light19_On() { controlDevice("Room13_Light19", "on"); }
function Room13_Light19_Off() { controlDevice("Room13_Light19", "off"); }
function Room13_Light19_Toggle() { controlDevice("Room13_Light19", "toggle"); }
function Room13_Light19_SetLevel(level) { controlDevice("Room13_Light19", "setlevel", level); }

function Room13_Light20_On() { controlDevice("Room13_Light20", "on"); }
function Room13_Light20_Off() { controlDevice("Room13_Light20", "off"); }
function Room13_Light20_Toggle() { controlDevice("Room13_Light20", "toggle"); }
function Room13_Light20_SetLevel(level) { controlDevice("Room13_Light20", "setlevel", level); }

// Room 13 Scene Functions
function Room13_Scene1_Activate() { activateScene("Room13_Scene1"); }
function Room13_Scene2_Activate() { activateScene("Room13_Scene2"); }
function Room13_Scene3_Activate() { activateScene("Room13_Scene3"); }
function Room13_Scene4_Activate() { activateScene("Room13_Scene4"); }
function Room13_Scene5_Activate() { activateScene("Room13_Scene5"); }
function Room13_Scene6_Activate() { activateScene("Room13_Scene6"); }
function Room13_Scene7_Activate() { activateScene("Room13_Scene7"); }
function Room13_Scene8_Activate() { activateScene("Room13_Scene8"); }
function Room13_Scene9_Activate() { activateScene("Room13_Scene9"); }
function Room13_Scene10_Activate() { activateScene("Room13_Scene10"); }
function Room13_Scene11_Activate() { activateScene("Room13_Scene11"); }
function Room13_Scene12_Activate() { activateScene("Room13_Scene12"); }
function Room13_Scene13_Activate() { activateScene("Room13_Scene13"); }
function Room13_Scene14_Activate() { activateScene("Room13_Scene14"); }
function Room13_Scene15_Activate() { activateScene("Room13_Scene15"); }
function Room13_Scene16_Activate() { activateScene("Room13_Scene16"); }
function Room13_Scene17_Activate() { activateScene("Room13_Scene17"); }
function Room13_Scene18_Activate() { activateScene("Room13_Scene18"); }
function Room13_Scene19_Activate() { activateScene("Room13_Scene19"); }
function Room13_Scene20_Activate() { activateScene("Room13_Scene20"); }

// Room 14 Light Functions
function Room14_Light1_On() { controlDevice("Room14_Light1", "on"); }
function Room14_Light1_Off() { controlDevice("Room14_Light1", "off"); }
function Room14_Light1_Toggle() { controlDevice("Room14_Light1", "toggle"); }
function Room14_Light1_SetLevel(level) { controlDevice("Room14_Light1", "setlevel", level); }

function Room14_Light2_On() { controlDevice("Room14_Light2", "on"); }
function Room14_Light2_Off() { controlDevice("Room14_Light2", "off"); }
function Room14_Light2_Toggle() { controlDevice("Room14_Light2", "toggle"); }
function Room14_Light2_SetLevel(level) { controlDevice("Room14_Light2", "setlevel", level); }

function Room14_Light3_On() { controlDevice("Room14_Light3", "on"); }
function Room14_Light3_Off() { controlDevice("Room14_Light3", "off"); }
function Room14_Light3_Toggle() { controlDevice("Room14_Light3", "toggle"); }
function Room14_Light3_SetLevel(level) { controlDevice("Room14_Light3", "setlevel", level); }

function Room14_Light4_On() { controlDevice("Room14_Light4", "on"); }
function Room14_Light4_Off() { controlDevice("Room14_Light4", "off"); }
function Room14_Light4_Toggle() { controlDevice("Room14_Light4", "toggle"); }
function Room14_Light4_SetLevel(level) { controlDevice("Room14_Light4", "setlevel", level); }

function Room14_Light5_On() { controlDevice("Room14_Light5", "on"); }
function Room14_Light5_Off() { controlDevice("Room14_Light5", "off"); }
function Room14_Light5_Toggle() { controlDevice("Room14_Light5", "toggle"); }
function Room14_Light5_SetLevel(level) { controlDevice("Room14_Light5", "setlevel", level); }

function Room14_Light6_On() { controlDevice("Room14_Light6", "on"); }
function Room14_Light6_Off() { controlDevice("Room14_Light6", "off"); }
function Room14_Light6_Toggle() { controlDevice("Room14_Light6", "toggle"); }
function Room14_Light6_SetLevel(level) { controlDevice("Room14_Light6", "setlevel", level); }

function Room14_Light7_On() { controlDevice("Room14_Light7", "on"); }
function Room14_Light7_Off() { controlDevice("Room14_Light7", "off"); }
function Room14_Light7_Toggle() { controlDevice("Room14_Light7", "toggle"); }
function Room14_Light7_SetLevel(level) { controlDevice("Room14_Light7", "setlevel", level); }

function Room14_Light8_On() { controlDevice("Room14_Light8", "on"); }
function Room14_Light8_Off() { controlDevice("Room14_Light8", "off"); }
function Room14_Light8_Toggle() { controlDevice("Room14_Light8", "toggle"); }
function Room14_Light8_SetLevel(level) { controlDevice("Room14_Light8", "setlevel", level); }

function Room14_Light9_On() { controlDevice("Room14_Light9", "on"); }
function Room14_Light9_Off() { controlDevice("Room14_Light9", "off"); }
function Room14_Light9_Toggle() { controlDevice("Room14_Light9", "toggle"); }
function Room14_Light9_SetLevel(level) { controlDevice("Room14_Light9", "setlevel", level); }

function Room14_Light10_On() { controlDevice("Room14_Light10", "on"); }
function Room14_Light10_Off() { controlDevice("Room14_Light10", "off"); }
function Room14_Light10_Toggle() { controlDevice("Room14_Light10", "toggle"); }
function Room14_Light10_SetLevel(level) { controlDevice("Room14_Light10", "setlevel", level); }

function Room14_Light11_On() { controlDevice("Room14_Light11", "on"); }
function Room14_Light11_Off() { controlDevice("Room14_Light11", "off"); }
function Room14_Light11_Toggle() { controlDevice("Room14_Light11", "toggle"); }
function Room14_Light11_SetLevel(level) { controlDevice("Room14_Light11", "setlevel", level); }

function Room14_Light12_On() { controlDevice("Room14_Light12", "on"); }
function Room14_Light12_Off() { controlDevice("Room14_Light12", "off"); }
function Room14_Light12_Toggle() { controlDevice("Room14_Light12", "toggle"); }
function Room14_Light12_SetLevel(level) { controlDevice("Room14_Light12", "setlevel", level); }

function Room14_Light13_On() { controlDevice("Room14_Light13", "on"); }
function Room14_Light13_Off() { controlDevice("Room14_Light13", "off"); }
function Room14_Light13_Toggle() { controlDevice("Room14_Light13", "toggle"); }
function Room14_Light13_SetLevel(level) { controlDevice("Room14_Light13", "setlevel", level); }

function Room14_Light14_On() { controlDevice("Room14_Light14", "on"); }
function Room14_Light14_Off() { controlDevice("Room14_Light14", "off"); }
function Room14_Light14_Toggle() { controlDevice("Room14_Light14", "toggle"); }
function Room14_Light14_SetLevel(level) { controlDevice("Room14_Light14", "setlevel", level); }

function Room14_Light15_On() { controlDevice("Room14_Light15", "on"); }
function Room14_Light15_Off() { controlDevice("Room14_Light15", "off"); }
function Room14_Light15_Toggle() { controlDevice("Room14_Light15", "toggle"); }
function Room14_Light15_SetLevel(level) { controlDevice("Room14_Light15", "setlevel", level); }

function Room14_Light16_On() { controlDevice("Room14_Light16", "on"); }
function Room14_Light16_Off() { controlDevice("Room14_Light16", "off"); }
function Room14_Light16_Toggle() { controlDevice("Room14_Light16", "toggle"); }
function Room14_Light16_SetLevel(level) { controlDevice("Room14_Light16", "setlevel", level); }

function Room14_Light17_On() { controlDevice("Room14_Light17", "on"); }
function Room14_Light17_Off() { controlDevice("Room14_Light17", "off"); }
function Room14_Light17_Toggle() { controlDevice("Room14_Light17", "toggle"); }
function Room14_Light17_SetLevel(level) { controlDevice("Room14_Light17", "setlevel", level); }

function Room14_Light18_On() { controlDevice("Room14_Light18", "on"); }
function Room14_Light18_Off() { controlDevice("Room14_Light18", "off"); }
function Room14_Light18_Toggle() { controlDevice("Room14_Light18", "toggle"); }
function Room14_Light18_SetLevel(level) { controlDevice("Room14_Light18", "setlevel", level); }

function Room14_Light19_On() { controlDevice("Room14_Light19", "on"); }
function Room14_Light19_Off() { controlDevice("Room14_Light19", "off"); }
function Room14_Light19_Toggle() { controlDevice("Room14_Light19", "toggle"); }
function Room14_Light19_SetLevel(level) { controlDevice("Room14_Light19", "setlevel", level); }

function Room14_Light20_On() { controlDevice("Room14_Light20", "on"); }
function Room14_Light20_Off() { controlDevice("Room14_Light20", "off"); }
function Room14_Light20_Toggle() { controlDevice("Room14_Light20", "toggle"); }
function Room14_Light20_SetLevel(level) { controlDevice("Room14_Light20", "setlevel", level); }

// Room 14 Scene Functions
function Room14_Scene1_Activate() { activateScene("Room14_Scene1"); }
function Room14_Scene2_Activate() { activateScene("Room14_Scene2"); }
function Room14_Scene3_Activate() { activateScene("Room14_Scene3"); }
function Room14_Scene4_Activate() { activateScene("Room14_Scene4"); }
function Room14_Scene5_Activate() { activateScene("Room14_Scene5"); }
function Room14_Scene6_Activate() { activateScene("Room14_Scene6"); }
function Room14_Scene7_Activate() { activateScene("Room14_Scene7"); }
function Room14_Scene8_Activate() { activateScene("Room14_Scene8"); }
function Room14_Scene9_Activate() { activateScene("Room14_Scene9"); }
function Room14_Scene10_Activate() { activateScene("Room14_Scene10"); }
function Room14_Scene11_Activate() { activateScene("Room14_Scene11"); }
function Room14_Scene12_Activate() { activateScene("Room14_Scene12"); }
function Room14_Scene13_Activate() { activateScene("Room14_Scene13"); }
function Room14_Scene14_Activate() { activateScene("Room14_Scene14"); }
function Room14_Scene15_Activate() { activateScene("Room14_Scene15"); }
function Room14_Scene16_Activate() { activateScene("Room14_Scene16"); }
function Room14_Scene17_Activate() { activateScene("Room14_Scene17"); }
function Room14_Scene18_Activate() { activateScene("Room14_Scene18"); }
function Room14_Scene19_Activate() { activateScene("Room14_Scene19"); }
function Room14_Scene20_Activate() { activateScene("Room14_Scene20"); }

// Room 15 Light Functions
function Room15_Light1_On() { controlDevice("Room15_Light1", "on"); }
function Room15_Light1_Off() { controlDevice("Room15_Light1", "off"); }
function Room15_Light1_Toggle() { controlDevice("Room15_Light1", "toggle"); }
function Room15_Light1_SetLevel(level) { controlDevice("Room15_Light1", "setlevel", level); }

function Room15_Light2_On() { controlDevice("Room15_Light2", "on"); }
function Room15_Light2_Off() { controlDevice("Room15_Light2", "off"); }
function Room15_Light2_Toggle() { controlDevice("Room15_Light2", "toggle"); }
function Room15_Light2_SetLevel(level) { controlDevice("Room15_Light2", "setlevel", level); }

function Room15_Light3_On() { controlDevice("Room15_Light3", "on"); }
function Room15_Light3_Off() { controlDevice("Room15_Light3", "off"); }
function Room15_Light3_Toggle() { controlDevice("Room15_Light3", "toggle"); }
function Room15_Light3_SetLevel(level) { controlDevice("Room15_Light3", "setlevel", level); }

function Room15_Light4_On() { controlDevice("Room15_Light4", "on"); }
function Room15_Light4_Off() { controlDevice("Room15_Light4", "off"); }
function Room15_Light4_Toggle() { controlDevice("Room15_Light4", "toggle"); }
function Room15_Light4_SetLevel(level) { controlDevice("Room15_Light4", "setlevel", level); }

function Room15_Light5_On() { controlDevice("Room15_Light5", "on"); }
function Room15_Light5_Off() { controlDevice("Room15_Light5", "off"); }
function Room15_Light5_Toggle() { controlDevice("Room15_Light5", "toggle"); }
function Room15_Light5_SetLevel(level) { controlDevice("Room15_Light5", "setlevel", level); }

function Room15_Light6_On() { controlDevice("Room15_Light6", "on"); }
function Room15_Light6_Off() { controlDevice("Room15_Light6", "off"); }
function Room15_Light6_Toggle() { controlDevice("Room15_Light6", "toggle"); }
function Room15_Light6_SetLevel(level) { controlDevice("Room15_Light6", "setlevel", level); }

function Room15_Light7_On() { controlDevice("Room15_Light7", "on"); }
function Room15_Light7_Off() { controlDevice("Room15_Light7", "off"); }
function Room15_Light7_Toggle() { controlDevice("Room15_Light7", "toggle"); }
function Room15_Light7_SetLevel(level) { controlDevice("Room15_Light7", "setlevel", level); }

function Room15_Light8_On() { controlDevice("Room15_Light8", "on"); }
function Room15_Light8_Off() { controlDevice("Room15_Light8", "off"); }
function Room15_Light8_Toggle() { controlDevice("Room15_Light8", "toggle"); }
function Room15_Light8_SetLevel(level) { controlDevice("Room15_Light8", "setlevel", level); }

function Room15_Light9_On() { controlDevice("Room15_Light9", "on"); }
function Room15_Light9_Off() { controlDevice("Room15_Light9", "off"); }
function Room15_Light9_Toggle() { controlDevice("Room15_Light9", "toggle"); }
function Room15_Light9_SetLevel(level) { controlDevice("Room15_Light9", "setlevel", level); }

function Room15_Light10_On() { controlDevice("Room15_Light10", "on"); }
function Room15_Light10_Off() { controlDevice("Room15_Light10", "off"); }
function Room15_Light10_Toggle() { controlDevice("Room15_Light10", "toggle"); }
function Room15_Light10_SetLevel(level) { controlDevice("Room15_Light10", "setlevel", level); }

function Room15_Light11_On() { controlDevice("Room15_Light11", "on"); }
function Room15_Light11_Off() { controlDevice("Room15_Light11", "off"); }
function Room15_Light11_Toggle() { controlDevice("Room15_Light11", "toggle"); }
function Room15_Light11_SetLevel(level) { controlDevice("Room15_Light11", "setlevel", level); }

function Room15_Light12_On() { controlDevice("Room15_Light12", "on"); }
function Room15_Light12_Off() { controlDevice("Room15_Light12", "off"); }
function Room15_Light12_Toggle() { controlDevice("Room15_Light12", "toggle"); }
function Room15_Light12_SetLevel(level) { controlDevice("Room15_Light12", "setlevel", level); }

function Room15_Light13_On() { controlDevice("Room15_Light13", "on"); }
function Room15_Light13_Off() { controlDevice("Room15_Light13", "off"); }
function Room15_Light13_Toggle() { controlDevice("Room15_Light13", "toggle"); }
function Room15_Light13_SetLevel(level) { controlDevice("Room15_Light13", "setlevel", level); }

function Room15_Light14_On() { controlDevice("Room15_Light14", "on"); }
function Room15_Light14_Off() { controlDevice("Room15_Light14", "off"); }
function Room15_Light14_Toggle() { controlDevice("Room15_Light14", "toggle"); }
function Room15_Light14_SetLevel(level) { controlDevice("Room15_Light14", "setlevel", level); }

function Room15_Light15_On() { controlDevice("Room15_Light15", "on"); }
function Room15_Light15_Off() { controlDevice("Room15_Light15", "off"); }
function Room15_Light15_Toggle() { controlDevice("Room15_Light15", "toggle"); }
function Room15_Light15_SetLevel(level) { controlDevice("Room15_Light15", "setlevel", level); }

function Room15_Light16_On() { controlDevice("Room15_Light16", "on"); }
function Room15_Light16_Off() { controlDevice("Room15_Light16", "off"); }
function Room15_Light16_Toggle() { controlDevice("Room15_Light16", "toggle"); }
function Room15_Light16_SetLevel(level) { controlDevice("Room15_Light16", "setlevel", level); }

function Room15_Light17_On() { controlDevice("Room15_Light17", "on"); }
function Room15_Light17_Off() { controlDevice("Room15_Light17", "off"); }
function Room15_Light17_Toggle() { controlDevice("Room15_Light17", "toggle"); }
function Room15_Light17_SetLevel(level) { controlDevice("Room15_Light17", "setlevel", level); }

function Room15_Light18_On() { controlDevice("Room15_Light18", "on"); }
function Room15_Light18_Off() { controlDevice("Room15_Light18", "off"); }
function Room15_Light18_Toggle() { controlDevice("Room15_Light18", "toggle"); }
function Room15_Light18_SetLevel(level) { controlDevice("Room15_Light18", "setlevel", level); }

function Room15_Light19_On() { controlDevice("Room15_Light19", "on"); }
function Room15_Light19_Off() { controlDevice("Room15_Light19", "off"); }
function Room15_Light19_Toggle() { controlDevice("Room15_Light19", "toggle"); }
function Room15_Light19_SetLevel(level) { controlDevice("Room15_Light19", "setlevel", level); }

function Room15_Light20_On() { controlDevice("Room15_Light20", "on"); }
function Room15_Light20_Off() { controlDevice("Room15_Light20", "off"); }
function Room15_Light20_Toggle() { controlDevice("Room15_Light20", "toggle"); }
function Room15_Light20_SetLevel(level) { controlDevice("Room15_Light20", "setlevel", level); }

// Room 15 Scene Functions
function Room15_Scene1_Activate() { activateScene("Room15_Scene1"); }
function Room15_Scene2_Activate() { activateScene("Room15_Scene2"); }
function Room15_Scene3_Activate() { activateScene("Room15_Scene3"); }
function Room15_Scene4_Activate() { activateScene("Room15_Scene4"); }
function Room15_Scene5_Activate() { activateScene("Room15_Scene5"); }
function Room15_Scene6_Activate() { activateScene("Room15_Scene6"); }
function Room15_Scene7_Activate() { activateScene("Room15_Scene7"); }
function Room15_Scene8_Activate() { activateScene("Room15_Scene8"); }
function Room15_Scene9_Activate() { activateScene("Room15_Scene9"); }
function Room15_Scene10_Activate() { activateScene("Room15_Scene10"); }
function Room15_Scene11_Activate() { activateScene("Room15_Scene11"); }
function Room15_Scene12_Activate() { activateScene("Room15_Scene12"); }
function Room15_Scene13_Activate() { activateScene("Room15_Scene13"); }
function Room15_Scene14_Activate() { activateScene("Room15_Scene14"); }
function Room15_Scene15_Activate() { activateScene("Room15_Scene15"); }
function Room15_Scene16_Activate() { activateScene("Room15_Scene16"); }
function Room15_Scene17_Activate() { activateScene("Room15_Scene17"); }
function Room15_Scene18_Activate() { activateScene("Room15_Scene18"); }
function Room15_Scene19_Activate() { activateScene("Room15_Scene19"); }
function Room15_Scene20_Activate() { activateScene("Room15_Scene20"); }

// Room 16 Light Functions
function Room16_Light1_On() { controlDevice("Room16_Light1", "on"); }
function Room16_Light1_Off() { controlDevice("Room16_Light1", "off"); }
function Room16_Light1_Toggle() { controlDevice("Room16_Light1", "toggle"); }
function Room16_Light1_SetLevel(level) { controlDevice("Room16_Light1", "setlevel", level); }

function Room16_Light2_On() { controlDevice("Room16_Light2", "on"); }
function Room16_Light2_Off() { controlDevice("Room16_Light2", "off"); }
function Room16_Light2_Toggle() { controlDevice("Room16_Light2", "toggle"); }
function Room16_Light2_SetLevel(level) { controlDevice("Room16_Light2", "setlevel", level); }

function Room16_Light3_On() { controlDevice("Room16_Light3", "on"); }
function Room16_Light3_Off() { controlDevice("Room16_Light3", "off"); }
function Room16_Light3_Toggle() { controlDevice("Room16_Light3", "toggle"); }
function Room16_Light3_SetLevel(level) { controlDevice("Room16_Light3", "setlevel", level); }

function Room16_Light4_On() { controlDevice("Room16_Light4", "on"); }
function Room16_Light4_Off() { controlDevice("Room16_Light4", "off"); }
function Room16_Light4_Toggle() { controlDevice("Room16_Light4", "toggle"); }
function Room16_Light4_SetLevel(level) { controlDevice("Room16_Light4", "setlevel", level); }

function Room16_Light5_On() { controlDevice("Room16_Light5", "on"); }
function Room16_Light5_Off() { controlDevice("Room16_Light5", "off"); }
function Room16_Light5_Toggle() { controlDevice("Room16_Light5", "toggle"); }
function Room16_Light5_SetLevel(level) { controlDevice("Room16_Light5", "setlevel", level); }

function Room16_Light6_On() { controlDevice("Room16_Light6", "on"); }
function Room16_Light6_Off() { controlDevice("Room16_Light6", "off"); }
function Room16_Light6_Toggle() { controlDevice("Room16_Light6", "toggle"); }
function Room16_Light6_SetLevel(level) { controlDevice("Room16_Light6", "setlevel", level); }

function Room16_Light7_On() { controlDevice("Room16_Light7", "on"); }
function Room16_Light7_Off() { controlDevice("Room16_Light7", "off"); }
function Room16_Light7_Toggle() { controlDevice("Room16_Light7", "toggle"); }
function Room16_Light7_SetLevel(level) { controlDevice("Room16_Light7", "setlevel", level); }

function Room16_Light8_On() { controlDevice("Room16_Light8", "on"); }
function Room16_Light8_Off() { controlDevice("Room16_Light8", "off"); }
function Room16_Light8_Toggle() { controlDevice("Room16_Light8", "toggle"); }
function Room16_Light8_SetLevel(level) { controlDevice("Room16_Light8", "setlevel", level); }

function Room16_Light9_On() { controlDevice("Room16_Light9", "on"); }
function Room16_Light9_Off() { controlDevice("Room16_Light9", "off"); }
function Room16_Light9_Toggle() { controlDevice("Room16_Light9", "toggle"); }
function Room16_Light9_SetLevel(level) { controlDevice("Room16_Light9", "setlevel", level); }

function Room16_Light10_On() { controlDevice("Room16_Light10", "on"); }
function Room16_Light10_Off() { controlDevice("Room16_Light10", "off"); }
function Room16_Light10_Toggle() { controlDevice("Room16_Light10", "toggle"); }
function Room16_Light10_SetLevel(level) { controlDevice("Room16_Light10", "setlevel", level); }

function Room16_Light11_On() { controlDevice("Room16_Light11", "on"); }
function Room16_Light11_Off() { controlDevice("Room16_Light11", "off"); }
function Room16_Light11_Toggle() { controlDevice("Room16_Light11", "toggle"); }
function Room16_Light11_SetLevel(level) { controlDevice("Room16_Light11", "setlevel", level); }

function Room16_Light12_On() { controlDevice("Room16_Light12", "on"); }
function Room16_Light12_Off() { controlDevice("Room16_Light12", "off"); }
function Room16_Light12_Toggle() { controlDevice("Room16_Light12", "toggle"); }
function Room16_Light12_SetLevel(level) { controlDevice("Room16_Light12", "setlevel", level); }

function Room16_Light13_On() { controlDevice("Room16_Light13", "on"); }
function Room16_Light13_Off() { controlDevice("Room16_Light13", "off"); }
function Room16_Light13_Toggle() { controlDevice("Room16_Light13", "toggle"); }
function Room16_Light13_SetLevel(level) { controlDevice("Room16_Light13", "setlevel", level); }

function Room16_Light14_On() { controlDevice("Room16_Light14", "on"); }
function Room16_Light14_Off() { controlDevice("Room16_Light14", "off"); }
function Room16_Light14_Toggle() { controlDevice("Room16_Light14", "toggle"); }
function Room16_Light14_SetLevel(level) { controlDevice("Room16_Light14", "setlevel", level); }

function Room16_Light15_On() { controlDevice("Room16_Light15", "on"); }
function Room16_Light15_Off() { controlDevice("Room16_Light15", "off"); }
function Room16_Light15_Toggle() { controlDevice("Room16_Light15", "toggle"); }
function Room16_Light15_SetLevel(level) { controlDevice("Room16_Light15", "setlevel", level); }

function Room16_Light16_On() { controlDevice("Room16_Light16", "on"); }
function Room16_Light16_Off() { controlDevice("Room16_Light16", "off"); }
function Room16_Light16_Toggle() { controlDevice("Room16_Light16", "toggle"); }
function Room16_Light16_SetLevel(level) { controlDevice("Room16_Light16", "setlevel", level); }

function Room16_Light17_On() { controlDevice("Room16_Light17", "on"); }
function Room16_Light17_Off() { controlDevice("Room16_Light17", "off"); }
function Room16_Light17_Toggle() { controlDevice("Room16_Light17", "toggle"); }
function Room16_Light17_SetLevel(level) { controlDevice("Room16_Light17", "setlevel", level); }

function Room16_Light18_On() { controlDevice("Room16_Light18", "on"); }
function Room16_Light18_Off() { controlDevice("Room16_Light18", "off"); }
function Room16_Light18_Toggle() { controlDevice("Room16_Light18", "toggle"); }
function Room16_Light18_SetLevel(level) { controlDevice("Room16_Light18", "setlevel", level); }

function Room16_Light19_On() { controlDevice("Room16_Light19", "on"); }
function Room16_Light19_Off() { controlDevice("Room16_Light19", "off"); }
function Room16_Light19_Toggle() { controlDevice("Room16_Light19", "toggle"); }
function Room16_Light19_SetLevel(level) { controlDevice("Room16_Light19", "setlevel", level); }

function Room16_Light20_On() { controlDevice("Room16_Light20", "on"); }
function Room16_Light20_Off() { controlDevice("Room16_Light20", "off"); }
function Room16_Light20_Toggle() { controlDevice("Room16_Light20", "toggle"); }
function Room16_Light20_SetLevel(level) { controlDevice("Room16_Light20", "setlevel", level); }

// Room 16 Scene Functions
function Room16_Scene1_Activate() { activateScene("Room16_Scene1"); }
function Room16_Scene2_Activate() { activateScene("Room16_Scene2"); }
function Room16_Scene3_Activate() { activateScene("Room16_Scene3"); }
function Room16_Scene4_Activate() { activateScene("Room16_Scene4"); }
function Room16_Scene5_Activate() { activateScene("Room16_Scene5"); }
function Room16_Scene6_Activate() { activateScene("Room16_Scene6"); }
function Room16_Scene7_Activate() { activateScene("Room16_Scene7"); }
function Room16_Scene8_Activate() { activateScene("Room16_Scene8"); }
function Room16_Scene9_Activate() { activateScene("Room16_Scene9"); }
function Room16_Scene10_Activate() { activateScene("Room16_Scene10"); }
function Room16_Scene11_Activate() { activateScene("Room16_Scene11"); }
function Room16_Scene12_Activate() { activateScene("Room16_Scene12"); }
function Room16_Scene13_Activate() { activateScene("Room16_Scene13"); }
function Room16_Scene14_Activate() { activateScene("Room16_Scene14"); }
function Room16_Scene15_Activate() { activateScene("Room16_Scene15"); }
function Room16_Scene16_Activate() { activateScene("Room16_Scene16"); }
function Room16_Scene17_Activate() { activateScene("Room16_Scene17"); }
function Room16_Scene18_Activate() { activateScene("Room16_Scene18"); }
function Room16_Scene19_Activate() { activateScene("Room16_Scene19"); }
function Room16_Scene20_Activate() { activateScene("Room16_Scene20"); }

// Room 17 Light Functions
function Room17_Light1_On() { controlDevice("Room17_Light1", "on"); }
function Room17_Light1_Off() { controlDevice("Room17_Light1", "off"); }
function Room17_Light1_Toggle() { controlDevice("Room17_Light1", "toggle"); }
function Room17_Light1_SetLevel(level) { controlDevice("Room17_Light1", "setlevel", level); }

function Room17_Light2_On() { controlDevice("Room17_Light2", "on"); }
function Room17_Light2_Off() { controlDevice("Room17_Light2", "off"); }
function Room17_Light2_Toggle() { controlDevice("Room17_Light2", "toggle"); }
function Room17_Light2_SetLevel(level) { controlDevice("Room17_Light2", "setlevel", level); }

function Room17_Light3_On() { controlDevice("Room17_Light3", "on"); }
function Room17_Light3_Off() { controlDevice("Room17_Light3", "off"); }
function Room17_Light3_Toggle() { controlDevice("Room17_Light3", "toggle"); }
function Room17_Light3_SetLevel(level) { controlDevice("Room17_Light3", "setlevel", level); }

function Room17_Light4_On() { controlDevice("Room17_Light4", "on"); }
function Room17_Light4_Off() { controlDevice("Room17_Light4", "off"); }
function Room17_Light4_Toggle() { controlDevice("Room17_Light4", "toggle"); }
function Room17_Light4_SetLevel(level) { controlDevice("Room17_Light4", "setlevel", level); }

function Room17_Light5_On() { controlDevice("Room17_Light5", "on"); }
function Room17_Light5_Off() { controlDevice("Room17_Light5", "off"); }
function Room17_Light5_Toggle() { controlDevice("Room17_Light5", "toggle"); }
function Room17_Light5_SetLevel(level) { controlDevice("Room17_Light5", "setlevel", level); }

function Room17_Light6_On() { controlDevice("Room17_Light6", "on"); }
function Room17_Light6_Off() { controlDevice("Room17_Light6", "off"); }
function Room17_Light6_Toggle() { controlDevice("Room17_Light6", "toggle"); }
function Room17_Light6_SetLevel(level) { controlDevice("Room17_Light6", "setlevel", level); }

function Room17_Light7_On() { controlDevice("Room17_Light7", "on"); }
function Room17_Light7_Off() { controlDevice("Room17_Light7", "off"); }
function Room17_Light7_Toggle() { controlDevice("Room17_Light7", "toggle"); }
function Room17_Light7_SetLevel(level) { controlDevice("Room17_Light7", "setlevel", level); }

function Room17_Light8_On() { controlDevice("Room17_Light8", "on"); }
function Room17_Light8_Off() { controlDevice("Room17_Light8", "off"); }
function Room17_Light8_Toggle() { controlDevice("Room17_Light8", "toggle"); }
function Room17_Light8_SetLevel(level) { controlDevice("Room17_Light8", "setlevel", level); }

function Room17_Light9_On() { controlDevice("Room17_Light9", "on"); }
function Room17_Light9_Off() { controlDevice("Room17_Light9", "off"); }
function Room17_Light9_Toggle() { controlDevice("Room17_Light9", "toggle"); }
function Room17_Light9_SetLevel(level) { controlDevice("Room17_Light9", "setlevel", level); }

function Room17_Light10_On() { controlDevice("Room17_Light10", "on"); }
function Room17_Light10_Off() { controlDevice("Room17_Light10", "off"); }
function Room17_Light10_Toggle() { controlDevice("Room17_Light10", "toggle"); }
function Room17_Light10_SetLevel(level) { controlDevice("Room17_Light10", "setlevel", level); }

function Room17_Light11_On() { controlDevice("Room17_Light11", "on"); }
function Room17_Light11_Off() { controlDevice("Room17_Light11", "off"); }
function Room17_Light11_Toggle() { controlDevice("Room17_Light11", "toggle"); }
function Room17_Light11_SetLevel(level) { controlDevice("Room17_Light11", "setlevel", level); }

function Room17_Light12_On() { controlDevice("Room17_Light12", "on"); }
function Room17_Light12_Off() { controlDevice("Room17_Light12", "off"); }
function Room17_Light12_Toggle() { controlDevice("Room17_Light12", "toggle"); }
function Room17_Light12_SetLevel(level) { controlDevice("Room17_Light12", "setlevel", level); }

function Room17_Light13_On() { controlDevice("Room17_Light13", "on"); }
function Room17_Light13_Off() { controlDevice("Room17_Light13", "off"); }
function Room17_Light13_Toggle() { controlDevice("Room17_Light13", "toggle"); }
function Room17_Light13_SetLevel(level) { controlDevice("Room17_Light13", "setlevel", level); }

function Room17_Light14_On() { controlDevice("Room17_Light14", "on"); }
function Room17_Light14_Off() { controlDevice("Room17_Light14", "off"); }
function Room17_Light14_Toggle() { controlDevice("Room17_Light14", "toggle"); }
function Room17_Light14_SetLevel(level) { controlDevice("Room17_Light14", "setlevel", level); }

function Room17_Light15_On() { controlDevice("Room17_Light15", "on"); }
function Room17_Light15_Off() { controlDevice("Room17_Light15", "off"); }
function Room17_Light15_Toggle() { controlDevice("Room17_Light15", "toggle"); }
function Room17_Light15_SetLevel(level) { controlDevice("Room17_Light15", "setlevel", level); }

function Room17_Light16_On() { controlDevice("Room17_Light16", "on"); }
function Room17_Light16_Off() { controlDevice("Room17_Light16", "off"); }
function Room17_Light16_Toggle() { controlDevice("Room17_Light16", "toggle"); }
function Room17_Light16_SetLevel(level) { controlDevice("Room17_Light16", "setlevel", level); }

function Room17_Light17_On() { controlDevice("Room17_Light17", "on"); }
function Room17_Light17_Off() { controlDevice("Room17_Light17", "off"); }
function Room17_Light17_Toggle() { controlDevice("Room17_Light17", "toggle"); }
function Room17_Light17_SetLevel(level) { controlDevice("Room17_Light17", "setlevel", level); }

function Room17_Light18_On() { controlDevice("Room17_Light18", "on"); }
function Room17_Light18_Off() { controlDevice("Room17_Light18", "off"); }
function Room17_Light18_Toggle() { controlDevice("Room17_Light18", "toggle"); }
function Room17_Light18_SetLevel(level) { controlDevice("Room17_Light18", "setlevel", level); }

function Room17_Light19_On() { controlDevice("Room17_Light19", "on"); }
function Room17_Light19_Off() { controlDevice("Room17_Light19", "off"); }
function Room17_Light19_Toggle() { controlDevice("Room17_Light19", "toggle"); }
function Room17_Light19_SetLevel(level) { controlDevice("Room17_Light19", "setlevel", level); }

function Room17_Light20_On() { controlDevice("Room17_Light20", "on"); }
function Room17_Light20_Off() { controlDevice("Room17_Light20", "off"); }
function Room17_Light20_Toggle() { controlDevice("Room17_Light20", "toggle"); }
function Room17_Light20_SetLevel(level) { controlDevice("Room17_Light20", "setlevel", level); }

// Room 17 Scene Functions
function Room17_Scene1_Activate() { activateScene("Room17_Scene1"); }
function Room17_Scene2_Activate() { activateScene("Room17_Scene2"); }
function Room17_Scene3_Activate() { activateScene("Room17_Scene3"); }
function Room17_Scene4_Activate() { activateScene("Room17_Scene4"); }
function Room17_Scene5_Activate() { activateScene("Room17_Scene5"); }
function Room17_Scene6_Activate() { activateScene("Room17_Scene6"); }
function Room17_Scene7_Activate() { activateScene("Room17_Scene7"); }
function Room17_Scene8_Activate() { activateScene("Room17_Scene8"); }
function Room17_Scene9_Activate() { activateScene("Room17_Scene9"); }
function Room17_Scene10_Activate() { activateScene("Room17_Scene10"); }
function Room17_Scene11_Activate() { activateScene("Room17_Scene11"); }
function Room17_Scene12_Activate() { activateScene("Room17_Scene12"); }
function Room17_Scene13_Activate() { activateScene("Room17_Scene13"); }
function Room17_Scene14_Activate() { activateScene("Room17_Scene14"); }
function Room17_Scene15_Activate() { activateScene("Room17_Scene15"); }
function Room17_Scene16_Activate() { activateScene("Room17_Scene16"); }
function Room17_Scene17_Activate() { activateScene("Room17_Scene17"); }
function Room17_Scene18_Activate() { activateScene("Room17_Scene18"); }
function Room17_Scene19_Activate() { activateScene("Room17_Scene19"); }
function Room17_Scene20_Activate() { activateScene("Room17_Scene20"); }

// Room 18 Light Functions
function Room18_Light1_On() { controlDevice("Room18_Light1", "on"); }
function Room18_Light1_Off() { controlDevice("Room18_Light1", "off"); }
function Room18_Light1_Toggle() { controlDevice("Room18_Light1", "toggle"); }
function Room18_Light1_SetLevel(level) { controlDevice("Room18_Light1", "setlevel", level); }

function Room18_Light2_On() { controlDevice("Room18_Light2", "on"); }
function Room18_Light2_Off() { controlDevice("Room18_Light2", "off"); }
function Room18_Light2_Toggle() { controlDevice("Room18_Light2", "toggle"); }
function Room18_Light2_SetLevel(level) { controlDevice("Room18_Light2", "setlevel", level); }

function Room18_Light3_On() { controlDevice("Room18_Light3", "on"); }
function Room18_Light3_Off() { controlDevice("Room18_Light3", "off"); }
function Room18_Light3_Toggle() { controlDevice("Room18_Light3", "toggle"); }
function Room18_Light3_SetLevel(level) { controlDevice("Room18_Light3", "setlevel", level); }

function Room18_Light4_On() { controlDevice("Room18_Light4", "on"); }
function Room18_Light4_Off() { controlDevice("Room18_Light4", "off"); }
function Room18_Light4_Toggle() { controlDevice("Room18_Light4", "toggle"); }
function Room18_Light4_SetLevel(level) { controlDevice("Room18_Light4", "setlevel", level); }

function Room18_Light5_On() { controlDevice("Room18_Light5", "on"); }
function Room18_Light5_Off() { controlDevice("Room18_Light5", "off"); }
function Room18_Light5_Toggle() { controlDevice("Room18_Light5", "toggle"); }
function Room18_Light5_SetLevel(level) { controlDevice("Room18_Light5", "setlevel", level); }

function Room18_Light6_On() { controlDevice("Room18_Light6", "on"); }
function Room18_Light6_Off() { controlDevice("Room18_Light6", "off"); }
function Room18_Light6_Toggle() { controlDevice("Room18_Light6", "toggle"); }
function Room18_Light6_SetLevel(level) { controlDevice("Room18_Light6", "setlevel", level); }

function Room18_Light7_On() { controlDevice("Room18_Light7", "on"); }
function Room18_Light7_Off() { controlDevice("Room18_Light7", "off"); }
function Room18_Light7_Toggle() { controlDevice("Room18_Light7", "toggle"); }
function Room18_Light7_SetLevel(level) { controlDevice("Room18_Light7", "setlevel", level); }

function Room18_Light8_On() { controlDevice("Room18_Light8", "on"); }
function Room18_Light8_Off() { controlDevice("Room18_Light8", "off"); }
function Room18_Light8_Toggle() { controlDevice("Room18_Light8", "toggle"); }
function Room18_Light8_SetLevel(level) { controlDevice("Room18_Light8", "setlevel", level); }

function Room18_Light9_On() { controlDevice("Room18_Light9", "on"); }
function Room18_Light9_Off() { controlDevice("Room18_Light9", "off"); }
function Room18_Light9_Toggle() { controlDevice("Room18_Light9", "toggle"); }
function Room18_Light9_SetLevel(level) { controlDevice("Room18_Light9", "setlevel", level); }

function Room18_Light10_On() { controlDevice("Room18_Light10", "on"); }
function Room18_Light10_Off() { controlDevice("Room18_Light10", "off"); }
function Room18_Light10_Toggle() { controlDevice("Room18_Light10", "toggle"); }
function Room18_Light10_SetLevel(level) { controlDevice("Room18_Light10", "setlevel", level); }

function Room18_Light11_On() { controlDevice("Room18_Light11", "on"); }
function Room18_Light11_Off() { controlDevice("Room18_Light11", "off"); }
function Room18_Light11_Toggle() { controlDevice("Room18_Light11", "toggle"); }
function Room18_Light11_SetLevel(level) { controlDevice("Room18_Light11", "setlevel", level); }

function Room18_Light12_On() { controlDevice("Room18_Light12", "on"); }
function Room18_Light12_Off() { controlDevice("Room18_Light12", "off"); }
function Room18_Light12_Toggle() { controlDevice("Room18_Light12", "toggle"); }
function Room18_Light12_SetLevel(level) { controlDevice("Room18_Light12", "setlevel", level); }

function Room18_Light13_On() { controlDevice("Room18_Light13", "on"); }
function Room18_Light13_Off() { controlDevice("Room18_Light13", "off"); }
function Room18_Light13_Toggle() { controlDevice("Room18_Light13", "toggle"); }
function Room18_Light13_SetLevel(level) { controlDevice("Room18_Light13", "setlevel", level); }

function Room18_Light14_On() { controlDevice("Room18_Light14", "on"); }
function Room18_Light14_Off() { controlDevice("Room18_Light14", "off"); }
function Room18_Light14_Toggle() { controlDevice("Room18_Light14", "toggle"); }
function Room18_Light14_SetLevel(level) { controlDevice("Room18_Light14", "setlevel", level); }

function Room18_Light15_On() { controlDevice("Room18_Light15", "on"); }
function Room18_Light15_Off() { controlDevice("Room18_Light15", "off"); }
function Room18_Light15_Toggle() { controlDevice("Room18_Light15", "toggle"); }
function Room18_Light15_SetLevel(level) { controlDevice("Room18_Light15", "setlevel", level); }

function Room18_Light16_On() { controlDevice("Room18_Light16", "on"); }
function Room18_Light16_Off() { controlDevice("Room18_Light16", "off"); }
function Room18_Light16_Toggle() { controlDevice("Room18_Light16", "toggle"); }
function Room18_Light16_SetLevel(level) { controlDevice("Room18_Light16", "setlevel", level); }

function Room18_Light17_On() { controlDevice("Room18_Light17", "on"); }
function Room18_Light17_Off() { controlDevice("Room18_Light17", "off"); }
function Room18_Light17_Toggle() { controlDevice("Room18_Light17", "toggle"); }
function Room18_Light17_SetLevel(level) { controlDevice("Room18_Light17", "setlevel", level); }

function Room18_Light18_On() { controlDevice("Room18_Light18", "on"); }
function Room18_Light18_Off() { controlDevice("Room18_Light18", "off"); }
function Room18_Light18_Toggle() { controlDevice("Room18_Light18", "toggle"); }
function Room18_Light18_SetLevel(level) { controlDevice("Room18_Light18", "setlevel", level); }

function Room18_Light19_On() { controlDevice("Room18_Light19", "on"); }
function Room18_Light19_Off() { controlDevice("Room18_Light19", "off"); }
function Room18_Light19_Toggle() { controlDevice("Room18_Light19", "toggle"); }
function Room18_Light19_SetLevel(level) { controlDevice("Room18_Light19", "setlevel", level); }

function Room18_Light20_On() { controlDevice("Room18_Light20", "on"); }
function Room18_Light20_Off() { controlDevice("Room18_Light20", "off"); }
function Room18_Light20_Toggle() { controlDevice("Room18_Light20", "toggle"); }
function Room18_Light20_SetLevel(level) { controlDevice("Room18_Light20", "setlevel", level); }

// Room 18 Scene Functions
function Room18_Scene1_Activate() { activateScene("Room18_Scene1"); }
function Room18_Scene2_Activate() { activateScene("Room18_Scene2"); }
function Room18_Scene3_Activate() { activateScene("Room18_Scene3"); }
function Room18_Scene4_Activate() { activateScene("Room18_Scene4"); }
function Room18_Scene5_Activate() { activateScene("Room18_Scene5"); }
function Room18_Scene6_Activate() { activateScene("Room18_Scene6"); }
function Room18_Scene7_Activate() { activateScene("Room18_Scene7"); }
function Room18_Scene8_Activate() { activateScene("Room18_Scene8"); }
function Room18_Scene9_Activate() { activateScene("Room18_Scene9"); }
function Room18_Scene10_Activate() { activateScene("Room18_Scene10"); }
function Room18_Scene11_Activate() { activateScene("Room18_Scene11"); }
function Room18_Scene12_Activate() { activateScene("Room18_Scene12"); }
function Room18_Scene13_Activate() { activateScene("Room18_Scene13"); }
function Room18_Scene14_Activate() { activateScene("Room18_Scene14"); }
function Room18_Scene15_Activate() { activateScene("Room18_Scene15"); }
function Room18_Scene16_Activate() { activateScene("Room18_Scene16"); }
function Room18_Scene17_Activate() { activateScene("Room18_Scene17"); }
function Room18_Scene18_Activate() { activateScene("Room18_Scene18"); }
function Room18_Scene19_Activate() { activateScene("Room18_Scene19"); }
function Room18_Scene20_Activate() { activateScene("Room18_Scene20"); }

// Room 19 Light Functions
function Room19_Light1_On() { controlDevice("Room19_Light1", "on"); }
function Room19_Light1_Off() { controlDevice("Room19_Light1", "off"); }
function Room19_Light1_Toggle() { controlDevice("Room19_Light1", "toggle"); }
function Room19_Light1_SetLevel(level) { controlDevice("Room19_Light1", "setlevel", level); }

function Room19_Light2_On() { controlDevice("Room19_Light2", "on"); }
function Room19_Light2_Off() { controlDevice("Room19_Light2", "off"); }
function Room19_Light2_Toggle() { controlDevice("Room19_Light2", "toggle"); }
function Room19_Light2_SetLevel(level) { controlDevice("Room19_Light2", "setlevel", level); }

function Room19_Light3_On() { controlDevice("Room19_Light3", "on"); }
function Room19_Light3_Off() { controlDevice("Room19_Light3", "off"); }
function Room19_Light3_Toggle() { controlDevice("Room19_Light3", "toggle"); }
function Room19_Light3_SetLevel(level) { controlDevice("Room19_Light3", "setlevel", level); }

function Room19_Light4_On() { controlDevice("Room19_Light4", "on"); }
function Room19_Light4_Off() { controlDevice("Room19_Light4", "off"); }
function Room19_Light4_Toggle() { controlDevice("Room19_Light4", "toggle"); }
function Room19_Light4_SetLevel(level) { controlDevice("Room19_Light4", "setlevel", level); }

function Room19_Light5_On() { controlDevice("Room19_Light5", "on"); }
function Room19_Light5_Off() { controlDevice("Room19_Light5", "off"); }
function Room19_Light5_Toggle() { controlDevice("Room19_Light5", "toggle"); }
function Room19_Light5_SetLevel(level) { controlDevice("Room19_Light5", "setlevel", level); }

function Room19_Light6_On() { controlDevice("Room19_Light6", "on"); }
function Room19_Light6_Off() { controlDevice("Room19_Light6", "off"); }
function Room19_Light6_Toggle() { controlDevice("Room19_Light6", "toggle"); }
function Room19_Light6_SetLevel(level) { controlDevice("Room19_Light6", "setlevel", level); }

function Room19_Light7_On() { controlDevice("Room19_Light7", "on"); }
function Room19_Light7_Off() { controlDevice("Room19_Light7", "off"); }
function Room19_Light7_Toggle() { controlDevice("Room19_Light7", "toggle"); }
function Room19_Light7_SetLevel(level) { controlDevice("Room19_Light7", "setlevel", level); }

function Room19_Light8_On() { controlDevice("Room19_Light8", "on"); }
function Room19_Light8_Off() { controlDevice("Room19_Light8", "off"); }
function Room19_Light8_Toggle() { controlDevice("Room19_Light8", "toggle"); }
function Room19_Light8_SetLevel(level) { controlDevice("Room19_Light8", "setlevel", level); }

function Room19_Light9_On() { controlDevice("Room19_Light9", "on"); }
function Room19_Light9_Off() { controlDevice("Room19_Light9", "off"); }
function Room19_Light9_Toggle() { controlDevice("Room19_Light9", "toggle"); }
function Room19_Light9_SetLevel(level) { controlDevice("Room19_Light9", "setlevel", level); }

function Room19_Light10_On() { controlDevice("Room19_Light10", "on"); }
function Room19_Light10_Off() { controlDevice("Room19_Light10", "off"); }
function Room19_Light10_Toggle() { controlDevice("Room19_Light10", "toggle"); }
function Room19_Light10_SetLevel(level) { controlDevice("Room19_Light10", "setlevel", level); }

function Room19_Light11_On() { controlDevice("Room19_Light11", "on"); }
function Room19_Light11_Off() { controlDevice("Room19_Light11", "off"); }
function Room19_Light11_Toggle() { controlDevice("Room19_Light11", "toggle"); }
function Room19_Light11_SetLevel(level) { controlDevice("Room19_Light11", "setlevel", level); }

function Room19_Light12_On() { controlDevice("Room19_Light12", "on"); }
function Room19_Light12_Off() { controlDevice("Room19_Light12", "off"); }
function Room19_Light12_Toggle() { controlDevice("Room19_Light12", "toggle"); }
function Room19_Light12_SetLevel(level) { controlDevice("Room19_Light12", "setlevel", level); }

function Room19_Light13_On() { controlDevice("Room19_Light13", "on"); }
function Room19_Light13_Off() { controlDevice("Room19_Light13", "off"); }
function Room19_Light13_Toggle() { controlDevice("Room19_Light13", "toggle"); }
function Room19_Light13_SetLevel(level) { controlDevice("Room19_Light13", "setlevel", level); }

function Room19_Light14_On() { controlDevice("Room19_Light14", "on"); }
function Room19_Light14_Off() { controlDevice("Room19_Light14", "off"); }
function Room19_Light14_Toggle() { controlDevice("Room19_Light14", "toggle"); }
function Room19_Light14_SetLevel(level) { controlDevice("Room19_Light14", "setlevel", level); }

function Room19_Light15_On() { controlDevice("Room19_Light15", "on"); }
function Room19_Light15_Off() { controlDevice("Room19_Light15", "off"); }
function Room19_Light15_Toggle() { controlDevice("Room19_Light15", "toggle"); }
function Room19_Light15_SetLevel(level) { controlDevice("Room19_Light15", "setlevel", level); }

function Room19_Light16_On() { controlDevice("Room19_Light16", "on"); }
function Room19_Light16_Off() { controlDevice("Room19_Light16", "off"); }
function Room19_Light16_Toggle() { controlDevice("Room19_Light16", "toggle"); }
function Room19_Light16_SetLevel(level) { controlDevice("Room19_Light16", "setlevel", level); }

function Room19_Light17_On() { controlDevice("Room19_Light17", "on"); }
function Room19_Light17_Off() { controlDevice("Room19_Light17", "off"); }
function Room19_Light17_Toggle() { controlDevice("Room19_Light17", "toggle"); }
function Room19_Light17_SetLevel(level) { controlDevice("Room19_Light17", "setlevel", level); }

function Room19_Light18_On() { controlDevice("Room19_Light18", "on"); }
function Room19_Light18_Off() { controlDevice("Room19_Light18", "off"); }
function Room19_Light18_Toggle() { controlDevice("Room19_Light18", "toggle"); }
function Room19_Light18_SetLevel(level) { controlDevice("Room19_Light18", "setlevel", level); }

function Room19_Light19_On() { controlDevice("Room19_Light19", "on"); }
function Room19_Light19_Off() { controlDevice("Room19_Light19", "off"); }
function Room19_Light19_Toggle() { controlDevice("Room19_Light19", "toggle"); }
function Room19_Light19_SetLevel(level) { controlDevice("Room19_Light19", "setlevel", level); }

function Room19_Light20_On() { controlDevice("Room19_Light20", "on"); }
function Room19_Light20_Off() { controlDevice("Room19_Light20", "off"); }
function Room19_Light20_Toggle() { controlDevice("Room19_Light20", "toggle"); }
function Room19_Light20_SetLevel(level) { controlDevice("Room19_Light20", "setlevel", level); }

// Room 19 Scene Functions
function Room19_Scene1_Activate() { activateScene("Room19_Scene1"); }
function Room19_Scene2_Activate() { activateScene("Room19_Scene2"); }
function Room19_Scene3_Activate() { activateScene("Room19_Scene3"); }
function Room19_Scene4_Activate() { activateScene("Room19_Scene4"); }
function Room19_Scene5_Activate() { activateScene("Room19_Scene5"); }
function Room19_Scene6_Activate() { activateScene("Room19_Scene6"); }
function Room19_Scene7_Activate() { activateScene("Room19_Scene7"); }
function Room19_Scene8_Activate() { activateScene("Room19_Scene8"); }
function Room19_Scene9_Activate() { activateScene("Room19_Scene9"); }
function Room19_Scene10_Activate() { activateScene("Room19_Scene10"); }
function Room19_Scene11_Activate() { activateScene("Room19_Scene11"); }
function Room19_Scene12_Activate() { activateScene("Room19_Scene12"); }
function Room19_Scene13_Activate() { activateScene("Room19_Scene13"); }
function Room19_Scene14_Activate() { activateScene("Room19_Scene14"); }
function Room19_Scene15_Activate() { activateScene("Room19_Scene15"); }
function Room19_Scene16_Activate() { activateScene("Room19_Scene16"); }
function Room19_Scene17_Activate() { activateScene("Room19_Scene17"); }
function Room19_Scene18_Activate() { activateScene("Room19_Scene18"); }
function Room19_Scene19_Activate() { activateScene("Room19_Scene19"); }
function Room19_Scene20_Activate() { activateScene("Room19_Scene20"); }

// Room 20 Light Functions
function Room20_Light1_On() { controlDevice("Room20_Light1", "on"); }
function Room20_Light1_Off() { controlDevice("Room20_Light1", "off"); }
function Room20_Light1_Toggle() { controlDevice("Room20_Light1", "toggle"); }
function Room20_Light1_SetLevel(level) { controlDevice("Room20_Light1", "setlevel", level); }

function Room20_Light2_On() { controlDevice("Room20_Light2", "on"); }
function Room20_Light2_Off() { controlDevice("Room20_Light2", "off"); }
function Room20_Light2_Toggle() { controlDevice("Room20_Light2", "toggle"); }
function Room20_Light2_SetLevel(level) { controlDevice("Room20_Light2", "setlevel", level); }

function Room20_Light3_On() { controlDevice("Room20_Light3", "on"); }
function Room20_Light3_Off() { controlDevice("Room20_Light3", "off"); }
function Room20_Light3_Toggle() { controlDevice("Room20_Light3", "toggle"); }
function Room20_Light3_SetLevel(level) { controlDevice("Room20_Light3", "setlevel", level); }

function Room20_Light4_On() { controlDevice("Room20_Light4", "on"); }
function Room20_Light4_Off() { controlDevice("Room20_Light4", "off"); }
function Room20_Light4_Toggle() { controlDevice("Room20_Light4", "toggle"); }
function Room20_Light4_SetLevel(level) { controlDevice("Room20_Light4", "setlevel", level); }

function Room20_Light5_On() { controlDevice("Room20_Light5", "on"); }
function Room20_Light5_Off() { controlDevice("Room20_Light5", "off"); }
function Room20_Light5_Toggle() { controlDevice("Room20_Light5", "toggle"); }
function Room20_Light5_SetLevel(level) { controlDevice("Room20_Light5", "setlevel", level); }

function Room20_Light6_On() { controlDevice("Room20_Light6", "on"); }
function Room20_Light6_Off() { controlDevice("Room20_Light6", "off"); }
function Room20_Light6_Toggle() { controlDevice("Room20_Light6", "toggle"); }
function Room20_Light6_SetLevel(level) { controlDevice("Room20_Light6", "setlevel", level); }

function Room20_Light7_On() { controlDevice("Room20_Light7", "on"); }
function Room20_Light7_Off() { controlDevice("Room20_Light7", "off"); }
function Room20_Light7_Toggle() { controlDevice("Room20_Light7", "toggle"); }
function Room20_Light7_SetLevel(level) { controlDevice("Room20_Light7", "setlevel", level); }

function Room20_Light8_On() { controlDevice("Room20_Light8", "on"); }
function Room20_Light8_Off() { controlDevice("Room20_Light8", "off"); }
function Room20_Light8_Toggle() { controlDevice("Room20_Light8", "toggle"); }
function Room20_Light8_SetLevel(level) { controlDevice("Room20_Light8", "setlevel", level); }

function Room20_Light9_On() { controlDevice("Room20_Light9", "on"); }
function Room20_Light9_Off() { controlDevice("Room20_Light9", "off"); }
function Room20_Light9_Toggle() { controlDevice("Room20_Light9", "toggle"); }
function Room20_Light9_SetLevel(level) { controlDevice("Room20_Light9", "setlevel", level); }

function Room20_Light10_On() { controlDevice("Room20_Light10", "on"); }
function Room20_Light10_Off() { controlDevice("Room20_Light10", "off"); }
function Room20_Light10_Toggle() { controlDevice("Room20_Light10", "toggle"); }
function Room20_Light10_SetLevel(level) { controlDevice("Room20_Light10", "setlevel", level); }

function Room20_Light11_On() { controlDevice("Room20_Light11", "on"); }
function Room20_Light11_Off() { controlDevice("Room20_Light11", "off"); }
function Room20_Light11_Toggle() { controlDevice("Room20_Light11", "toggle"); }
function Room20_Light11_SetLevel(level) { controlDevice("Room20_Light11", "setlevel", level); }

function Room20_Light12_On() { controlDevice("Room20_Light12", "on"); }
function Room20_Light12_Off() { controlDevice("Room20_Light12", "off"); }
function Room20_Light12_Toggle() { controlDevice("Room20_Light12", "toggle"); }
function Room20_Light12_SetLevel(level) { controlDevice("Room20_Light12", "setlevel", level); }

function Room20_Light13_On() { controlDevice("Room20_Light13", "on"); }
function Room20_Light13_Off() { controlDevice("Room20_Light13", "off"); }
function Room20_Light13_Toggle() { controlDevice("Room20_Light13", "toggle"); }
function Room20_Light13_SetLevel(level) { controlDevice("Room20_Light13", "setlevel", level); }

function Room20_Light14_On() { controlDevice("Room20_Light14", "on"); }
function Room20_Light14_Off() { controlDevice("Room20_Light14", "off"); }
function Room20_Light14_Toggle() { controlDevice("Room20_Light14", "toggle"); }
function Room20_Light14_SetLevel(level) { controlDevice("Room20_Light14", "setlevel", level); }

function Room20_Light15_On() { controlDevice("Room20_Light15", "on"); }
function Room20_Light15_Off() { controlDevice("Room20_Light15", "off"); }
function Room20_Light15_Toggle() { controlDevice("Room20_Light15", "toggle"); }
function Room20_Light15_SetLevel(level) { controlDevice("Room20_Light15", "setlevel", level); }

function Room20_Light16_On() { controlDevice("Room20_Light16", "on"); }
function Room20_Light16_Off() { controlDevice("Room20_Light16", "off"); }
function Room20_Light16_Toggle() { controlDevice("Room20_Light16", "toggle"); }
function Room20_Light16_SetLevel(level) { controlDevice("Room20_Light16", "setlevel", level); }

function Room20_Light17_On() { controlDevice("Room20_Light17", "on"); }
function Room20_Light17_Off() { controlDevice("Room20_Light17", "off"); }
function Room20_Light17_Toggle() { controlDevice("Room20_Light17", "toggle"); }
function Room20_Light17_SetLevel(level) { controlDevice("Room20_Light17", "setlevel", level); }

function Room20_Light18_On() { controlDevice("Room20_Light18", "on"); }
function Room20_Light18_Off() { controlDevice("Room20_Light18", "off"); }
function Room20_Light18_Toggle() { controlDevice("Room20_Light18", "toggle"); }
function Room20_Light18_SetLevel(level) { controlDevice("Room20_Light18", "setlevel", level); }

function Room20_Light19_On() { controlDevice("Room20_Light19", "on"); }
function Room20_Light19_Off() { controlDevice("Room20_Light19", "off"); }
function Room20_Light19_Toggle() { controlDevice("Room20_Light19", "toggle"); }
function Room20_Light19_SetLevel(level) { controlDevice("Room20_Light19", "setlevel", level); }

function Room20_Light20_On() { controlDevice("Room20_Light20", "on"); }
function Room20_Light20_Off() { controlDevice("Room20_Light20", "off"); }
function Room20_Light20_Toggle() { controlDevice("Room20_Light20", "toggle"); }
function Room20_Light20_SetLevel(level) { controlDevice("Room20_Light20", "setlevel", level); }

// Room 20 Scene Functions
function Room20_Scene1_Activate() { activateScene("Room20_Scene1"); }
function Room20_Scene2_Activate() { activateScene("Room20_Scene2"); }
function Room20_Scene3_Activate() { activateScene("Room20_Scene3"); }
function Room20_Scene4_Activate() { activateScene("Room20_Scene4"); }
function Room20_Scene5_Activate() { activateScene("Room20_Scene5"); }
function Room20_Scene6_Activate() { activateScene("Room20_Scene6"); }
function Room20_Scene7_Activate() { activateScene("Room20_Scene7"); }
function Room20_Scene8_Activate() { activateScene("Room20_Scene8"); }
function Room20_Scene9_Activate() { activateScene("Room20_Scene9"); }
function Room20_Scene10_Activate() { activateScene("Room20_Scene10"); }
function Room20_Scene11_Activate() { activateScene("Room20_Scene11"); }
function Room20_Scene12_Activate() { activateScene("Room20_Scene12"); }
function Room20_Scene13_Activate() { activateScene("Room20_Scene13"); }
function Room20_Scene14_Activate() { activateScene("Room20_Scene14"); }
function Room20_Scene15_Activate() { activateScene("Room20_Scene15"); }
function Room20_Scene16_Activate() { activateScene("Room20_Scene16"); }
function Room20_Scene17_Activate() { activateScene("Room20_Scene17"); }
function Room20_Scene18_Activate() { activateScene("Room20_Scene18"); }
function Room20_Scene19_Activate() { activateScene("Room20_Scene19"); }
function Room20_Scene20_Activate() { activateScene("Room20_Scene20"); }


// Initialize when loaded
System.Print("FIBARO: Driver loaded\n");
Initialize();