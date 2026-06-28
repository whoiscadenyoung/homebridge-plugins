# homebridge-aranet4-advanced

Homebridge plugin for the [Aranet4](https://aranet.com/products/aranet4/) CO2 and environment sensor. Exposes CO2, temperature, humidity, atmospheric pressure, air quality, and battery level to Apple HomeKit via passive BLE advertisement scanning.

Supports [Eve](https://apps.apple.com/app/eve-for-matter-homekit/id917695792) app history graphs via FakeGato.

## Features

- **Passive BLE scanning** -- reads sensor data from Aranet4 advertisements without connecting, minimizing battery drain and BLE contention
- **Minimal dependencies** -- passive BLE scanning, no database or heavy native modules required
- **Multi-device support** -- monitor multiple Aranet4 sensors simultaneously
- **Auto-discovery** -- finds Aranet4 devices in range automatically (or configure explicit MAC addresses)
- **Eve history** -- temperature, humidity, and CO2 graphs in the Eve app
- **HomeKit services**: CO2 Sensor, Temperature, Humidity, Air Quality, Atmospheric Pressure (Eve-compatible), Battery

## Prerequisites

- Homebridge v1.8+ or v2.0+
- Node.js 20 or 22
- A Bluetooth adapter (built-in or USB) supported by your OS
- Aranet4 with **"Smart Home integrations"** enabled in the Aranet4 Home app

### Enabling Smart Home Integrations

The Aranet4 only broadcasts sensor data in BLE advertisements when this setting is enabled:

1. Open the **Aranet4 Home** app on your phone
2. Connect to your Aranet4 device
3. Go to **Settings** > **Smart Home integrations**
4. Toggle it **on**

Without this, the plugin will detect the device by name but won't receive sensor data.

## Installation

Install via the Homebridge UI (search for `homebridge-aranet4-advanced`) or manually:

```bash
npm install -g homebridge-aranet4-advanced
```

### Bluetooth Permissions

**macOS** -- Bluetooth works out of the box via Core Bluetooth. If running Homebridge via Terminal, grant Terminal Bluetooth permission in System Settings > Privacy & Security > Bluetooth.

**Linux / Raspberry Pi** -- Install BlueZ and grant the Node.js binary BLE capabilities:

```bash
sudo apt-get install bluetooth bluez libbluetooth-dev libudev-dev
sudo setcap cap_net_raw+eip $(eval readlink -f $(which node))
```

## Configuration

### Minimal (auto-discovery)

```json
{
  "platforms": [
    {
      "platform": "Aranet4",
      "name": "Aranet4"
    }
  ]
}
```

The plugin will discover any Aranet4 in range and create accessories automatically.

### Explicit device configuration

```json
{
  "platforms": [
    {
      "platform": "Aranet4",
      "name": "Aranet4",
      "devices": [
        {
          "name": "Living Room CO2",
          "address": "AA:BB:CC:DD:EE:FF",
          "pollingInterval": 120,
          "co2AlertThreshold": 1000,
          "lowBatteryThreshold": 15,
          "enableHistory": true
        }
      ]
    }
  ]
}
```

### Device options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | string | `"Aranet4"` | Friendly name shown in HomeKit |
| `address` | string | *(auto)* | Bluetooth MAC address (`AA:BB:CC:DD:EE:FF`). Recommended for multi-device setups. |
| `pollingInterval` | integer | `60` | Seconds between HomeKit updates (60--3600). The Aranet4 broadcasts every ~1s; this throttles how often the plugin pushes updates. |
| `co2AlertThreshold` | integer | `1000` | CO2 ppm level that triggers `CarbonDioxideDetected` in HomeKit (400--5000). |
| `lowBatteryThreshold` | integer | `15` | Battery % below which low-battery alert triggers (5--50). |
| `enableHistory` | boolean | `true` | Enable Eve app history graphs (via FakeGato). |

### Finding your Aranet4 MAC address

The plugin logs the MAC address of each discovered device at startup. Check your Homebridge logs for:

```
[Aranet4] Discovered Aranet4: "Aranet4 Home" [aabbccddeeff] via advertisement
```

Use that address (formatted as `AA:BB:CC:DD:EE:FF`) in your config.

## HomeKit Services

Each Aranet4 device exposes these services:

| Sensor Data | HomeKit Service | Details |
|-------------|----------------|---------|
| CO2 (ppm) | CarbonDioxideSensor | Level + alert at configurable threshold |
| Temperature (C) | TemperatureSensor | |
| Humidity (%) | HumiditySensor | |
| Air Quality | AirQualitySensor | Derived from CO2 level (see below) |
| Pressure (hPa) | Eve custom characteristic | Visible in the Eve app |
| Battery (%) | BatteryService | Low-battery alert at configurable threshold |

### Air Quality Mapping

| CO2 (ppm) | Air Quality |
|-----------|-------------|
| 0--600 | Excellent |
| 601--800 | Good |
| 801--1000 | Fair |
| 1001--1500 | Inferior |
| >1500 | Poor |

## Troubleshooting

### "No sensor data in advertisement"

The Aranet4 was detected by name but isn't broadcasting sensor data. Enable **Smart Home integrations** in the Aranet4 Home app (see Prerequisites above).

### Plugin starts but no devices found

- Verify your Bluetooth adapter is working: `hciconfig` (Linux) or check System Settings (macOS)
- Check Homebridge logs for `Bluetooth adapter state: poweredOn`
- Ensure no other process is monopolizing the BLE adapter
- On Linux, verify BLE capabilities are set (see Bluetooth Permissions above)

### Readings appear stale or intermittent

- The Aranet4 measures every 1--10 minutes (configurable on device). Between measurements, it broadcasts the last known reading.
- BLE range is typically 10--20m. Move the Homebridge host closer to the sensor.
- Other BLE devices can cause interference. A dedicated USB Bluetooth adapter may help.

### "Bluetooth access denied" (macOS)

On macOS, Bluetooth requires explicit permission per executable. The plugin logs a clear error when this happens. This affects both the main bridge and child bridge setups.

**Fix — grant Bluetooth permission to the Node.js binary:**

1. Open **System Settings → Privacy & Security → Bluetooth**
2. Click the **+** button to add an application
3. Press **Cmd+Shift+G** to open the path input dialog
4. Type the path to your Node.js binary and press Enter:
   - Homebrew: `/opt/homebrew/bin/node` (Apple Silicon) or `/usr/local/bin/node` (Intel)
   - hb-service default: check the path shown in `sudo hb-service status` or in your Homebridge startup logs (look for the `Node.js` line)
5. Select the binary and click **Open**
6. Make sure the toggle next to `node` is **ON**
7. Restart Homebridge

This works for both the main bridge and child bridges because Homebridge child bridges use the same `node` binary (via `child_process.fork()`), and macOS tracks Bluetooth permission by executable path.

**Caveats:**
- If you update Node.js (e.g., via Homebrew), the binary path may change and you'll need to re-add it
- If `node` is a symlink, you may need to add the resolved path instead (e.g., `/opt/homebrew/Cellar/node/24.14.1/bin/node`)

### "BLE scan start failed"

Make sure Bluetooth is enabled and the Node.js process has the necessary permissions (see Bluetooth Permissions above).

### Sensor shows as inactive / "No data received"

The plugin automatically marks sensors as inactive when no BLE advertisement is received for several minutes. This typically means:

- The Aranet4 is out of BLE range (move it closer, typically within 10m)
- The device is powered off or battery is dead
- BLE interference from other devices

The sensor will automatically recover when advertisements resume -- no restart required.

## Development

```bash
git clone https://github.com/RobSim/homebridge-aranet4-advanced.git
cd homebridge-aranet4-advanced
npm install
npm run build
npm test
```

### Project structure

```
src/
  index.ts              -- Plugin registration
  platform.ts           -- Dynamic platform plugin (lifecycle, accessory management)
  platformAccessory.ts  -- HomeKit service/characteristic setup per device
  bleManager.ts         -- BLE scanning and advertisement parsing
  aranet4Parser.ts      -- Binary protocol parser for Aranet4 data
  settings.ts           -- Constants, types, UUIDs
test/
  *.test.ts             -- Jest test suites
```

## License

MIT
