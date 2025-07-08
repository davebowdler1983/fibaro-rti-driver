# Contributing to Fibaro RTI Driver

Thank you for your interest in contributing! This driver helps RTI installers integrate Fibaro systems without programming knowledge.

## 🎯 Core Principle: Template Design

**This driver must remain a template** - no hardcoded values, ever!

### ✅ Good Contribution:
```javascript
var deviceId = Config.Get("Room1_Light1_FibaroID");
```

### ❌ Bad Contribution:
```javascript
var deviceId = 31;  // Never hardcode IDs!
```

---

## How You Can Help

### 1. 🐛 Report Bugs
- Use [GitHub Issues](../../issues)
- Include trace logs (remove passwords!)
- Provide steps to reproduce
- List your configuration

### 2. 📝 Improve Documentation
- Fix typos or unclear instructions
- Add examples
- Translate to other languages
- Add diagrams or screenshots

### 3. 🧪 Test New Device Types
- Try RGB devices
- Test sensors
- Document working Fibaro API calls
- Share your findings

### 4. 💡 Suggest Features
- New device types
- UI improvements  
- Performance optimizations
- Tool ideas

---

## Before Contributing Code

### 1. Understand the Architecture
- Read [Understanding v5.10](docs/understanding-v5.10.md)
- Read [Template Design Principles](docs/template-design-principles.md)
- Never break template design!

### 2. Test Your Changes
- Test with blank configuration
- Test with multiple devices
- Verify no hardcoded values
- Check memory usage stays low

### 3. Follow RTI Limitations
- No modern JavaScript (ES6+)
- No external libraries
- Limited string functions
- Must work on XP-8 processors

---

## Submitting Changes

### 1. Fork & Clone
```bash
# Fork on GitHub first, then:
git clone https://github.com/YOUR-USERNAME/fibaro-rti-driver.git
cd fibaro-rti-driver
```

### 2. Create Branch
```bash
git checkout -b feature/rgb-support
# or
git checkout -b fix/dimmer-feedback
```

### 3. Make Changes
- Edit files
- Test thoroughly
- Update version numbers
- Document changes

### 4. Commit
```bash
git add .
git commit -m "Add RGB device support for v6.0"
```

### 5. Push & PR
```bash
git push origin feature/rgb-support
```
Then create Pull Request on GitHub

---

## Code Standards

### JavaScript Style
```javascript
// Function naming
function FIBARO_Room1_Light1_On() {  // RTI convention

// Variable naming  
var g_DeviceStatus = {};  // g_ for globals
var deviceId = 123;       // camelCase for locals

// Comments
// Clear explanation of what this does
// Not just repeating the code
```

### Configuration Naming
Follow existing patterns:
- `Room{X}_Light{Y}_Enable`
- `Room{X}_Light{Y}_FibaroID`
- `Room{X}_Light{Y}_Name`
- `Room{X}_Light{Y}_Type`

### Version Numbering
- Bug fixes: 5.10 → 5.11
- New features: 5.10 → 6.0
- Major changes: 5.10 → 6.0

---

## Adding New Device Types

### Example: Adding RGB Support

1. **Test Fibaro API First**
   ```bash
   POST http://fibaro-ip/api/devices/221/action/setColor
   Body: {"arg1": 255, "arg2": 0, "arg3": 0}
   ```

2. **Add Detection in BuildDeviceMap()**
   ```javascript
   if (deviceType === "rgb") {
       g_RoomDevices[key].type = "rgb";
       g_RoomDevices[key].color = {r:0, g:0, b:0};
   }
   ```

3. **Create Control Function**
   ```javascript
   function controlRGBDevice(deviceKey, action, value) {
       // Implementation
   }
   ```

4. **Add UI Functions**
   ```javascript
   function FIBARO_Room1_Light1_SetColor(r, g, b) {
       // Must use Config.Get() for device info!
   }
   ```

5. **Update Documentation**
   - Add to supported devices
   - Include examples
   - Update quick reference

---

## Testing Checklist

Before submitting PR:

- [ ] No hardcoded IPs or IDs
- [ ] Works with blank config
- [ ] Follows naming conventions
- [ ] Memory usage acceptable
- [ ] Trace log clean
- [ ] Documentation updated
- [ ] Version incremented
- [ ] CHANGELOG updated

---

## Documentation Contributions

### We Need:
- Setup videos/screenshots
- Device type examples
- Troubleshooting scenarios
- Integration tips
- Best practices

### Format:
- Use Markdown
- Include examples
- Keep it simple
- Target non-programmers

---

## Tool Contributions

### Tool Requirements:
- HTML-based (user preference)
- Include version in filename
- Generate valid driver code
- Maintain template design
- Include instructions

### Example Tools Needed:
- Configuration validator
- Device discovery tool
- Backup/restore utility
- Performance analyzer

---

## Community Guidelines

### Be Helpful
- Remember users aren't programmers
- Explain changes clearly
- Provide examples
- Be patient with questions

### Be Professional
- No customer data in examples
- Respect the template design
- Test before submitting
- Document everything

---

## Getting Help

### Questions?
- Open an issue
- Tag as "question"
- Be specific
- Include examples

### Stuck?
- Check existing issues
- Read documentation
- Ask in discussions
- Join RTI forums

---

## Recognition

Contributors will be:
- Listed in README
- Credited in CHANGELOG
- Thanked in release notes
- Appreciated by community!

---

## Quick Contribution Ideas

### Easy First Issues:
1. Fix typos in docs
2. Add troubleshooting scenarios
3. Test with your devices
4. Improve error messages

### Medium Difficulty:
1. Add new device type
2. Improve performance
3. Create new tool
4. Write guides

### Advanced:
1. Major architecture improvements
2. New feedback mechanisms
3. Advanced device support
4. Performance optimization

---

Thank you for helping make Fibaro integration easier for everyone! 🎉