# Changelog

All notable changes to the Fibaro RTI Driver will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.10] - 2025-01-08

### Changed
- Consolidated stable release with all features integrated
- Unified error handling across all functions
- Consistent version numbering across all files
- Template design fully implemented - zero hardcoded values

### Fixed
- Memory management optimized (~88KB with 8 devices)
- Connection stability improved
- Dimmer level memory now persistent
- Auto-reconnection after hub restart

### Added
- Comprehensive documentation suite
- GitHub repository structure
- Tool versioning system
- Template design validation

### Tested Configuration
- 8 devices across 3 rooms (Room 1, 2, and 8)
- 2 scenes (IDs 26 & 27)
- Long polling feedback
- Hub crash recovery

## [5.0] - 2024-12-15

### Added
- Control state tracking system
- g_ControlActive flags for each device
- Prevents feedback loops during control

### Changed
- Improved dimmer control logic
- Better separation of control vs feedback

## [4.5] - 2024-11-20

### Added
- Connection stability improvements
- Retry logic for failed commands
- Better error messages

### Fixed
- Authentication handling
- Timeout issues with large responses

## [4.0] - 2024-10-10

### Added
- Multi-room support (20 rooms)
- Room-based organization
- Extended to 400 devices total

### Changed
- Restructured internal device mapping
- New naming convention (Room1_Light1)

## [3.5] - 2024-09-01

### Added
- Initial stable version
- Basic device control (on/off/dim)
- Scene execution
- Real-time feedback via polling

### Features
- Support for 20 devices
- Basic authentication
- JSON parsing support

---

## Upgrade Instructions

### From 4.x to 5.10
1. Back up your current configuration
2. Note all device IDs and names
3. Load new driver files
4. Re-enter configuration through Integration Designer
5. Test all devices before going live

### From 3.x to 5.10
1. Complete reconfiguration required
2. New room-based structure
3. Follow setup guide for fresh installation

---

## Future Versions (Planned)

### [6.0] - RGB Device Support
- Color control for RGB devices
- Color picker interface
- RGB feedback and status

### [6.1] - Sensor Support
- Motion sensors
- Door/window sensors
- Temperature sensors
- Sensor status feedback

### [6.2] - Smart Lock Support
- Lock/unlock control
- Lock status feedback
- User code management

### [7.0] - Thermostat Support
- Temperature control
- Mode selection
- Schedule integration

### [8.0] - Energy Monitoring
- Power consumption tracking
- Historical data
- Energy reports