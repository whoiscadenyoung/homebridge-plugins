# homebridge-aranet4-advanced — Project Plan

**Created:** 2026-04-03
**Updated:** 2026-04-04
**Status:** Ready for hardware testing

---

## Overview

A Homebridge plugin for the Aranet4 CO2/environment sensor. Exposes CO2, temperature, humidity, atmospheric pressure, air quality, and battery level to Apple HomeKit via **passive BLE advertisement scanning** — no connection required, no battery drain on the sensor.

Built in TypeScript as a Dynamic Platform Plugin following Homebridge verified-plugin standards.

---

## Architecture Decisions

### Passive BLE scanning (not active connections)

The Aranet4 broadcasts sensor data in BLE advertisements when "Smart Home integrations" is enabled in the Aranet4 Home app. This plugin listens for those broadcasts passively.

**Why passive over active:**
- Zero battery impact on the Aranet4 (active connections drain the CR2032 coin cell)
- No BLE contention (only one device can hold an active connection at a time)
- No connection management, reconnect logic, or pairing
- Simpler, more reliable (~250 lines vs. estimated ~600+ for connection lifecycle)
- Works with multiple devices simultaneously without connection scheduling

**Tradeoff:** No access to onboard historical data (requires active connection + PIN pairing). The plugin accumulates its own history from the moment it starts via FakeGato.

### No database — FakeGato handles persistence

The original plan called for SQLite (`better-sqlite3`). This was removed because:
- FakeGato already persists history to JSON files in the Homebridge storage directory
- SQLite adds a native dependency requiring C++ compilation (node-gyp), which is a major installability barrier on Raspberry Pi and NAS devices
- There's no query use case that justifies a database

### Two distinct BLE data formats

The Aranet4 has two different binary formats. Confusing these was the source of a critical parser bug during development.

**Advertisement format** (passive scanning — what this plugin uses):

Manufacturer data includes 2-byte company ID (0x0702) + payload:

| Payload offset | Type | Field | Conversion |
|---|---|---|---|
| 0 | uint8 | Flags (bit 5 = integrations enabled) | Bitfield |
| 1–3 | uint8×3 | Firmware version (patch, minor, major) | — |
| 4–7 | — | Device type + padding | — |
| 8–9 | uint16 LE | CO2 | ppm (raw) |
| 10–11 | uint16 LE | Temperature | raw ÷ 20 = °C |
| 12–13 | uint16 LE | Pressure | raw ÷ 10 = hPa |
| 14 | uint8 | Humidity | % (raw) |
| 15 | uint8 | Battery | % (raw) |
| 16 | uint8 | Status | Quality indicator |
| 17–18 | uint16 LE | Interval | Seconds between readings |
| 19–20 | uint16 LE | Age | Seconds since last reading |

Minimum payload: 12 bytes (header + CO2 + temperature). Full payload: 21 bytes.

References: [Aranet4-Python](https://github.com/Anrijs/Aranet4-Python), [Aranet4-ESP32](https://github.com/Anrijs/Aranet4-ESP32), [Theengs Decoder](https://decoder.theengs.io/devices/Aranet4.html)

**GATT characteristic format** (active connection — not used in v1):

Extended readings characteristic (`f0cd3001`), 13-byte packet:

| Offset | Type | Field | Conversion |
|---|---|---|---|
| 0–1 | uint16 LE | CO2 | ppm (raw) |
| 2–3 | uint16 LE | Temperature | raw ÷ 20 = °C |
| 4–5 | uint16 LE | Pressure | raw ÷ 10 = hPa |
| 6 | uint8 | Humidity | % (raw) |
| 7 | uint8 | Battery | % (raw) |
| 8 | uint8 | Status | Device status byte |
| 9–10 | uint16 LE | Interval | Seconds between readings |
| 11–12 | uint16 LE | Age | Seconds since last reading |

Note: the field order and offsets differ between formats. The advertisement format has an 8-byte header before sensor data; the GATT format starts with sensor data immediately.

---

## HomeKit Service Mapping

| Aranet4 Data | HomeKit Service | Characteristics |
|---|---|---|
| CO2 (ppm) | CarbonDioxideSensor | CarbonDioxideLevel, CarbonDioxideDetected (configurable threshold, default 1000 ppm) |
| Temperature (°C) | TemperatureSensor | CurrentTemperature |
| Humidity (%) | HumiditySensor | CurrentRelativeHumidity |
| CO2 → quality | AirQualitySensor | AirQuality (≤600 Excellent, ≤800 Good, ≤1000 Fair, ≤1500 Inferior, >1500 Poor) |
| Battery (%) | BatteryService | BatteryLevel, StatusLowBattery (configurable threshold, default 15%) |
| Pressure (hPa) | Eve custom characteristic | UINT16, visible in Eve app |

All services include StatusActive (false until first reading arrives).

---

## Project Structure

```
src/
  index.ts              — Plugin registration entry point
  platform.ts           — Dynamic platform plugin (lifecycle, config, accessory management)
  platformAccessory.ts  — HomeKit service/characteristic setup per device
  bleManager.ts         — BLE scanning, advertisement filtering, throttling
  aranet4Parser.ts      — Binary protocol parser + validation for both formats
  settings.ts           — Constants, types, interfaces, shared utilities
  types/
    fakegato-history.d.ts — Type declarations for FakeGato
test/
  *.test.ts             — Jest test suites (44 tests across 6 suites)
```

---

## Dependencies

| Package | Purpose | Native? |
|---|---|---|
| `@homebridge/noble` | BLE advertisement scanning | Yes (BlueZ on Linux, Core Bluetooth on macOS) |
| `fakegato-history` | Eve app historical graphs | No |

Dev-only: TypeScript, Jest, ESLint, rimraf, nodemon.

---

## Implementation Phases (as executed)

### Phase 1: Scaffolding + BLE + Parser ✅
- Project structure, TypeScript config, ESLint, config schema
- `settings.ts` with all constants, types, and BLE protocol UUIDs
- `aranet4Parser.ts` with advertisement and GATT characteristic parsers
- `bleManager.ts` with passive scanning, company ID filtering, throttling
- Validation: CO2 1–10000 ppm, temperature -40–60°C, humidity 0–100%, pressure 300–1200 hPa, battery 0–100%

### Phase 2: HomeKit Services ✅
- All 6 HomeKit services with onGet handlers and push updates
- Eve-compatible pressure characteristic (custom UUID, UINT16)
- CO2 → AirQuality mapping with configurable alert threshold
- FakeGato history integration for Eve app graphs
- Stable service subtypes decoupled from display names (safe to rename)

### Phase 3: Multi-Device + Config ✅
- Auto-discovery (no config needed) or explicit MAC address config
- Per-device polling interval, CO2 threshold, battery threshold, history toggle
- Config validation: duplicate addresses, missing addresses with multiple devices, MAC format
- Stale accessory pruning when devices are removed from config
- Graceful fallback to defaults for auto-discovered devices

### Phase 4: Error Handling + Hardening ✅
- Error boundaries in all BLE callback paths (prevent noble EventEmitter crashes)
- Protected `stopScanning` during shutdown
- Config value clamping (polling 60–3600s, CO2 400–5000 ppm, battery 5–50%)
- Sensor data validation with plausible range checks
- StatusActive flag for no-data-yet state
- Isolated cleanup steps in shutdown

### Phase 5: Testing ✅
- 44 tests across 6 suites
- Parser tests with known byte sequences for both formats
- BLE integration tests with mocked noble (discovery, throttling, edge cases)
- Platform tests (config parsing, accessory lifecycle)
- Accessory tests (service creation, characteristic updates, fault marking)
- Air quality mapping boundary tests

### Phase 6: Hardware Testing 🔜
- Install on Homebridge server machine
- Verify advertisement parsing against real Aranet4 hardware
- Confirm all 6 HomeKit services appear and update correctly
- Test Eve app history graphs
- Test multi-device with multiple Aranet4 sensors
- Test BLE range limits and recovery after out-of-range

### Phase 7: Publish
- Verify Homebridge verified-plugin checklist
- npm publish with `--access=public`
- GitHub release with changelog
- Submit for Homebridge verified plugin review

---

## Platform Notes

### macOS
- BLE works via Core Bluetooth, no native compilation required
- noble exposes a system-assigned UUID, **not the actual MAC address** — the `address` config field won't match what the Aranet4 Home app shows. Use the address logged by the plugin during discovery instead.
- Terminal needs Bluetooth permission (System Settings → Privacy & Security → Bluetooth)

### Linux / Raspberry Pi
- Requires BlueZ, `libbluetooth-dev`, `libudev-dev`
- Node.js binary needs BLE capabilities: `sudo setcap cap_net_raw+eip $(eval readlink -f $(which node))`
- noble exposes real MAC addresses — the `address` field matches what the Aranet4 Home app shows

### Critical prerequisite: Smart Home integrations
The Aranet4 **does not broadcast sensor data by default**. The user must enable "Smart Home integrations" in the Aranet4 Home app (Settings → Smart Home integrations → On). Without this, the plugin detects the device by name but receives no data. This is the #1 user support issue.

---

## Future Enhancements (post-v1)

| Feature | Complexity | Notes |
|---|---|---|
| Active BLE history sync | High | Requires OS-level PIN pairing, connection management, incremental sync state. Most users won't need it — FakeGato accumulates history from plugin start. |
| MQTT export | Medium | Publish readings to MQTT broker for Grafana/InfluxDB integration |
| Stale reading detection | Low | Mark sensor inactive if no advertisement received within N × polling interval |
| Homebridge UI device scanner | Medium | Scan button in config UI to discover devices and populate MAC addresses |

---

## Risk & Mitigation

| Risk | Mitigation |
|---|---|
| Noble platform differences | Document platform-specific setup; test on macOS + Linux |
| BLE range limitations | Document placement; plugin recovers automatically when device returns to range |
| Aranet4 firmware variations | Parser handles variable-length advertisements gracefully; validated against 3 reference implementations |
| "Smart Home integrations" disabled | Plugin detects device by name and logs a clear warning with instructions |
| macOS UUID vs. Linux MAC | Document the difference; plugin logs the correct identifier for each platform |
