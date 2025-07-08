# Fibaro RTI Driver

⚠️ **IMPORTANT**: This is a **TEMPLATE DRIVER** designed to work with ANY Fibaro installation through configuration. **NO customer-specific information should ever be hardcoded**.

## Overview

Comprehensive driver for integrating Fibaro Home Center 2/3 with RTI control systems. One driver file works for unlimited installations - just configure through RTI Integration Designer.

### Current Version: 5.10
- ✅ Support for 400 devices (20 rooms × 20 devices)
- ✅ Support for 400 scenes (20 rooms × 20 scenes)  
- ✅ Real-time feedback with auto-reconnection
- ✅ Template design - configure without coding
- ✅ Memory efficient (~88KB with 8 devices)

## Features

- **No Programming Required** - All configuration through Integration Designer
- **Multi-Room Support** - Up to 20 rooms with 20 devices each
- **Scene Control** - Up to 20 scenes per room
- **Real-Time Feedback** - Instant status updates
- **Auto-Recovery** - Handles hub restarts gracefully
- **Dimmer Memory** - Remembers last dimmer levels

## Quick Start Guide

### For RTI Installers:

1. **Download the Driver**
   - Download latest release from [Releases](../../releases)
   - Extract all files to a folder

2. **Load into Integration Designer**
   - Open Integration Designer 11
   - Import `FibaroDriver_v5.10.js`
   - Driver loads with blank configuration

3. **Configure Connection** (No Code Editing!)
   ```
   Device Properties → Connection Settings
   - IP Address: [Customer's Fibaro IP]
   - Port: 80
   - Username: [Fibaro username]
   - Password: [Fibaro password]
   ```

4. **Add Devices**
   ```
   Device Properties → Room Settings → Room 1
   - Enable Room: ✓
   - Light 1 Enable: ✓
   - Light 1 Fibaro ID: [Get from Fibaro]
   - Light 1 Name: [Friendly name]
   ```

5. **Download to Processor**
   - Save configuration
   - Download to RTI processor
   - Test control and feedback

## Documentation

- 📖 **[Setup Guide](docs/setup-guide.md)** - Detailed installation instructions
- 🎯 **[Template Design Principles](docs/template-design-principles.md)** - Why configuration matters
- 🔧 **[Understanding the Driver](docs/understanding-v5.10.md)** - Technical details
- 🚀 **[Device Implementation](docs/device-implementation/)** - Adding new device types
- ❓ **[Troubleshooting](docs/troubleshooting.md)** - Common issues and solutions

## File Structure

```
driver/
├── FibaroDriver_v5.10.js      # Main driver file
├── DriverManifest.xml          # RTI manifest
├── SystemFunctions.xml         # Control functions
├── SystemVariables.xml         # State variables  
├── ConfigSettings.xml          # Configuration interface
└── json2.js                    # JSON support library

tools/
├── fibaro-function-generator_v5.10.html  # Generate control functions
└── README.md                             # Tool documentation

docs/
└── (All documentation files)
```

## Important Notes

### 🚫 Never Hardcode Values
This driver uses **ZERO hardcoded values**:
- ❌ No IP addresses in code
- ❌ No device IDs in code
- ❌ No customer names in code
- ✅ Everything from configuration

### 🔧 Configuration Only
All settings through Integration Designer:
- No JavaScript knowledge needed
- No code editing required
- Simple checkbox and text field interface
- Same driver file for all customers

## Supported Devices

Currently Supported (v5.10):
- ✅ Switches (on/off)
- ✅ Dimmers (level control)
- ✅ Scenes (execute)

Coming Soon:
- 🎨 RGB Lights (v6.0)
- 🚪 Sensors (v6.1)
- 🔒 Smart Locks (v6.2)
- 🌡️ Thermostats (v7.0)

## Tools Included

### Function Generator
- Generates up to 2,000 control functions
- Supports all rooms and devices
- Maintains template design
- See [tools/README.md](tools/README.md)

## Contributing

We welcome contributions! Please:
1. Maintain template design (no hardcoded values)
2. Test with multiple configurations
3. Update documentation
4. Submit pull request

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Version History

- **v5.10** (Jan 2025) - Stable consolidated release
- **v5.0** - Control state tracking
- **v4.5** - Connection stability
- **v4.0** - Multi-room support
- **v3.5** - Initial stable version

See [CHANGELOG.md](CHANGELOG.md) for detailed history.

## Support

- 📧 Issues: Use [GitHub Issues](../../issues)
- 💬 Discussions: Use [GitHub Discussions](../../discussions)
- 📚 Wiki: Additional examples and tips

## License

MIT License - See [LICENSE](LICENSE) file

---

**Remember**: This is a template driver. One file, unlimited installations, zero programming required!