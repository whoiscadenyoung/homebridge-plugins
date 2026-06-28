# Changelog

## 0.1.0 (Unreleased)

Initial release.

- BLE communication with Aranet4 devices via `@homebridge/noble`
- HomeKit services: CO2, temperature, humidity, air quality (CO2-derived), battery, atmospheric pressure (Eve custom)
- Local SQLite data persistence with configurable retention
- Eve app historical graphs via fakegato-history
- Device onboard history sync (opt-in, requires BLE pairing)
- Multi-device auto-discovery and manual MAC address configuration
- Exponential backoff reconnection and robust error handling
- Cross-platform: macOS (Core Bluetooth) and Linux/Raspberry Pi (BlueZ)
