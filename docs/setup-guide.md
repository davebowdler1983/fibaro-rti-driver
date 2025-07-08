# Fibaro RTI Driver - Setup Guide

## Before You Start

### What You Need:
- ✅ RTI Integration Designer 11
- ✅ Fibaro Home Center 2 or 3
- ✅ Fibaro admin username and password
- ✅ List of device IDs from Fibaro
- ✅ The driver files (v5.10)

### Getting Device IDs from Fibaro:
1. Log into your Fibaro web interface
2. Go to "Devices" section
3. Click on each device you want to control
4. Look for "ID" in the device details (usually a number like 31, 110, 221)
5. Write down: Device ID, Device Name, Room Location

---

## Step-by-Step Installation

### Step 1: Load Driver into Integration Designer

1. **Open Integration Designer 11**
2. **Create New Project** or open existing
3. **Add New Device**:
   - Right-click on "Devices"
   - Select "Add Device"
   - Choose "Import from File"
4. **Import Driver Files**:
   - Browse to driver folder
   - Select `FibaroDriver_v5.10.js`
   - Click "Open"
5. **Driver loads with blank configuration** ✓

### Step 2: Configure Connection Settings

1. **Select the Fibaro driver** in device tree
2. **Go to Properties panel** (right side)
3. **Find "Connection Settings"** section
4. **Enter your settings**:
   ```
   IP Address: [Your Fibaro IP, like 192.168.1.251]
   Port: 80
   Username: [Your Fibaro username]
   Password: [Your Fibaro password]
   ```
5. **Leave these as defaults**:
   ```
   Poll Interval: 2000
   Connection Timeout: 5000
   ```

### Step 3: Enable Rooms

1. **Scroll to "Room 1 Settings"**
2. **Check "Room 1 Enable"** ✓
3. **Repeat for each room** you want to use (up to 20)
4. **Skip rooms** you don't need

### Step 4: Add Your Devices

For each device you want to control:

1. **Find the room section** (like "Room 1 Devices")
2. **For Light 1**:
   ```
   Light 1 Enable: ✓ (check the box)
   Light 1 Fibaro ID: [Enter device ID, like 31]
   Light 1 Name: [Enter friendly name, like "Patio"]
   Light 1 Type: switch (or dimmer if dimmable)
   ```
3. **Repeat for each device** (up to 20 per room)

#### Example Configuration:
```
Room 1 Settings:
  ✓ Room 1 Enable
  
Room 1 Devices:
  ✓ Light 1 Enable
  Light 1 Fibaro ID: 31
  Light 1 Name: Patio
  Light 1 Type: switch
  
  ✓ Light 2 Enable
  Light 2 Fibaro ID: 33
  Light 2 Name: Kitchen
  Light 2 Type: dimmer
```

### Step 5: Add Scenes (Optional)

For each scene:

1. **Find "Room X Scenes"** section
2. **For Scene 1**:
   ```
   Scene 1 Enable: ✓
   Scene 1 Fibaro ID: [Scene ID, like 26]
   Scene 1 Name: [Name, like "All Lights Off"]
   ```

### Step 6: Save and Download

1. **Save your project** (Ctrl+S)
2. **Connect to RTI Processor**
3. **Download to Processor**:
   - Click "Download" button
   - Wait for completion
4. **Check System Status** for "Connected"

---

## Testing Your Setup

### Test Basic Control:
1. Open RTI Panel/App
2. Navigate to Fibaro controls
3. Try turning a light on/off
4. Check feedback updates

### Check System Monitor:
1. In Integration Designer
2. View → System Monitor
3. Look for:
   - "Fibaro Driver v5.10 loaded"
   - "HTTP Request completed"
   - Device status updates

### If Nothing Works:
1. Check IP address is correct
2. Verify username/password
3. Ensure Fibaro hub is online
4. Check device IDs are correct
5. Look at trace log for errors

---

## Common Mistakes to Avoid

### ❌ DON'T:
- Edit the JavaScript code
- Add device IDs to the code
- Change IP addresses in code
- Modify function names

### ✅ DO:
- Use Integration Designer properties only
- Get device IDs from Fibaro interface
- Test with one device first
- Save your configuration

---

## Adding More Devices Later

1. **Open your project** in Integration Designer
2. **Select Fibaro driver**
3. **Go to Properties**
4. **Add new devices** in empty slots
5. **Download to processor** again

---

## Quick Reference

### Device Types:
- **switch** - On/Off only (most devices)
- **dimmer** - On/Off + Level control
- **rgb** - Color control (coming in v6.0)

### Room Naming:
- Room 1 = First room in your list
- Room 2 = Second room, etc.
- Can skip numbers (use Room 1, 2, and 8)

### Function Names Created:
- `FIBARO_Room1_Light1_On()`
- `FIBARO_Room1_Light1_Off()`
- `FIBARO_Room1_Light1_Toggle()`
- `FIBARO_Room1_Light1_SetLevel(level)`

---

## Need Help?

### Check These First:
1. Is Fibaro hub accessible from browser?
2. Can you login to Fibaro with username/password?
3. Are device IDs correct?
4. Is RTI processor on same network?

### Error Messages:
- "No IP configured" → Set IP in properties
- "Not authenticated" → Check username/password
- "Device not found" → Verify device ID
- "Connection timeout" → Check network/IP

### Still Stuck?
- Check [Troubleshooting Guide](troubleshooting.md)
- Post in [GitHub Issues](https://github.com/your-username/fibaro-rti-driver/issues)
- Include your trace log (no passwords!)

---

## Example: Complete Room Setup

Here's what a complete room looks like in properties:

```
Room 2 Settings:
  ☑ Room 2 Enable

Room 2 Devices:
  ☑ Light 1 Enable
  Light 1 Fibaro ID: 33
  Light 1 Name: Above TV
  Light 1 Type: dimmer
  
  ☑ Light 2 Enable  
  Light 2 Fibaro ID: 36
  Light 2 Name: Above Door
  Light 2 Type: switch
  
  ☑ Light 3 Enable
  Light 3 Fibaro ID: 103  
  Light 3 Name: Middle Row
  Light 3 Type: dimmer
  
  ☐ Light 4 Enable (unchecked - not used)
  
Room 2 Scenes:
  ☑ Scene 1 Enable
  Scene 1 Fibaro ID: 26
  Scene 1 Name: Evening Mode
```

That's it! No coding required - just configuration! 🎉