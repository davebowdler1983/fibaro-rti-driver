# Fibaro RTI Driver - Troubleshooting Guide

## Quick Diagnosis

### 🔴 Nothing Works At All

**Check These First:**
1. **Is driver loaded?**
   - System Monitor should show "Fibaro Driver v5.10 loaded"
   - If not, re-import driver file

2. **Network connection?**
   - Can you ping Fibaro hub from RTI processor?
   - Open browser, go to http://[fibaro-ip]
   - Should see Fibaro login page

3. **Configuration empty?**
   - Check Device Properties in Integration Designer
   - Must have IP, username, password filled in

---

## Common Problems & Solutions

### Problem: "ERROR: No IP address configured"

**Solution:**
1. Open Integration Designer
2. Select Fibaro driver
3. Properties → Connection Settings
4. Enter IP Address (like 192.168.1.251)
5. Download to processor

---

### Problem: "Authentication failed" or "401 Unauthorized"

**Solutions:**
1. **Wrong username/password:**
   - Test login on Fibaro web interface first
   - Re-enter in Integration Designer properties
   - Password is case-sensitive!

2. **Special characters in password:**
   - Try changing Fibaro password to simpler one
   - Avoid: @ # $ % & * ( ) 
   - Use: letters, numbers, dash, underscore

---

### Problem: Device won't turn on/off

**Check in Order:**

1. **Device ID correct?**
   ```
   In Fibaro web → Devices → Click device → Check ID number
   In RTI → Properties → Make sure same ID entered
   ```

2. **Device enabled?**
   ```
   Properties → Room X Devices → Light X Enable ✓ (must be checked)
   ```

3. **Room enabled?**
   ```
   Properties → Room X Settings → Room X Enable ✓ (must be checked)
   ```

4. **Test in Fibaro first:**
   - Can you control device from Fibaro app/web?
   - If not, fix in Fibaro first

---

### Problem: "Device not found" in trace

**This means:** Fibaro says that device ID doesn't exist

**Fix:**
1. Double-check device ID in Fibaro
2. Make sure device still exists in Fibaro
3. Common mistake: Entering device NAME instead of ID
   - Wrong: "Kitchen Light" 
   - Right: "33"

---

### Problem: Dimmer won't dim (only on/off works)

**Check:**
1. Device type set correctly?
   ```
   Properties → Light Type: dimmer (not "switch")
   ```

2. Is device actually dimmable in Fibaro?
   - Test dimming in Fibaro first
   - Some devices look like dimmers but aren't

---

### Problem: Feedback not updating

**Common Causes:**

1. **Polling stopped:**
   - Check trace for "Polling states"
   - Should see updates every 2 seconds

2. **Wrong variable names:**
   - Feedback uses exact same names as control
   - Example: `FIBARO_Room1_Light1_Status`

3. **Hub overloaded:**
   - Too many devices polling too fast
   - Try increasing Poll Interval to 3000 or 5000

---

### Problem: "Connection timeout"

**Solutions:**

1. **Network issue:**
   - Ping Fibaro hub from RTI processor
   - Check network cables/switches
   - Firewall blocking connection?

2. **Fibaro hub busy:**
   - Restart Fibaro hub
   - Wait 2-3 minutes for full startup

3. **Wrong IP:**
   - Fibaro IP might have changed
   - Check current IP in router

---

### Problem: Driver says v4.5 instead of v5.10

**Fix:**
1. You have old version loaded
2. Download latest v5.10 from GitHub
3. In Integration Designer:
   - Remove old driver
   - Import new FibaroDriver_v5.10.js
   - Re-enter all configuration

---

## Reading Trace Logs

### What to Look For:

**Good Messages:**
```
Fibaro Driver v5.10 loaded
Connected to hub
HTTP Request completed successfully
Device control successful: 31
Updating device status: Room1_Light1 = on
```

**Error Messages:**
```
ERROR: No IP address configured → Set IP in properties
ERROR: Not authenticated → Check username/password  
ERROR: Device not found: 31 → Wrong device ID
ERROR: Connection failed → Network/IP issue
ERROR: Invalid JSON → Fibaro response problem
```

---

## Advanced Debugging

### Enable Detailed Trace:

1. **Check every HTTP request:**
   - Look for URL being called
   - Check response codes (200=good, 401=auth, 404=not found)

2. **Monitor memory usage:**
   - System Monitor → Memory
   - Should stay under 150KB
   - If growing, may have loop issue

3. **Test with one device:**
   - Disable all but one device
   - Get that working first
   - Then enable others one by one

---

## Performance Issues

### Driver Running Slow?

1. **Too many devices:**
   - Only enable devices you actually use
   - Empty slots don't use resources

2. **Poll interval too fast:**
   - Default 2000ms is good
   - Try 3000-5000 for many devices

3. **Network latency:**
   - Check ping time to Fibaro
   - Should be under 50ms

---

## When All Else Fails

### Reset Everything:

1. **In Fibaro:**
   - Note down all device IDs
   - Test each device works

2. **In RTI:**
   - Delete Fibaro driver
   - Re-import fresh copy
   - Start with ONE device
   - Add others after working

3. **Still stuck?**
   - Save trace log (no passwords!)
   - Post on GitHub Issues
   - Include:
     - What you tried
     - Error messages
     - One example device config

---

## Prevention Tips

### 📝 Document Everything:
- Keep list of device IDs
- Screenshot working configuration  
- Note what changed when issues started

### 🔄 Change One Thing at a Time:
- Add one device
- Test it works
- Then add next device

### 💾 Backup Configuration:
- Export RTI project regularly
- Keep copy of working setup

### ✅ Test in Fibaro First:
- Make sure device works in Fibaro
- Get correct device ID
- Then add to RTI

---

## Quick Error Reference

| Error Message | Likely Cause | Quick Fix |
|--------------|--------------|-----------|
| "No IP configured" | Empty IP field | Enter IP in properties |
| "401 Unauthorized" | Wrong login | Check username/password |
| "404 Not Found" | Wrong device ID | Verify ID in Fibaro |
| "Connection timeout" | Network issue | Check IP and network |
| "Invalid JSON" | Fibaro bug | Restart Fibaro hub |
| "Out of memory" | Too many devices | Reduce active devices |

---

## Still Need Help?

Before posting for help, collect:
1. ✓ Trace log excerpt (remove passwords!)
2. ✓ One device configuration example
3. ✓ What worked before
4. ✓ What changed
5. ✓ Error messages exact text

Post on: [GitHub Issues](https://github.com/your-username/fibaro-rti-driver/issues)