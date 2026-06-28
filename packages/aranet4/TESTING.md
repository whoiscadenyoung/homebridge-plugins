# Testing on Your Homebridge Server

## Before you start

Make sure your Aranet4 has **Smart Home integrations** enabled:

1. Open the **Aranet4 Home** app on your phone
2. Connect to your Aranet4 device
3. Go to **Settings** > **Smart Home integrations**
4. Toggle it **on**

Without this, the plugin will detect the device but won't receive any sensor data.

## Step 1: Build and pack on your dev machine

On this Mac (where the code lives):

```bash
cd ~/Claude/Aranet4\ Homebridge\ Plugin

# Clean build
rm -rf dist && npx tsc

# Create a tarball for transfer
npm pack
```

This creates `homebridge-aranet4-advanced-0.1.0.tgz` in the project directory.

## Step 2: Transfer to your Homebridge server

Copy the tarball to your Homebridge server. For example, via scp:

```bash
scp homebridge-aranet4-advanced-0.1.0.tgz user@homebridge-server:~/
```

Or use whatever file transfer method you prefer (USB, Finder, etc.).

## Step 3: Install on the Homebridge server

SSH into (or open a terminal on) your Homebridge server:

```bash
# Install from the tarball
sudo npm install -g ~/homebridge-aranet4-advanced-0.1.0.tgz
```

### Linux / Raspberry Pi only

If your Homebridge server runs Linux, you also need BLE dependencies:

```bash
sudo apt-get install bluetooth bluez libbluetooth-dev libudev-dev
sudo setcap cap_net_raw+eip $(eval readlink -f $(which node))
```

## Step 4: Add the plugin config

You can either use the Homebridge UI (the plugin will appear in Settings with a config form), or edit `config.json` directly.

### Minimal config (auto-discovery)

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

### With an explicit device

```json
{
  "platforms": [
    {
      "platform": "Aranet4",
      "name": "Aranet4",
      "devices": [
        {
          "name": "Office CO2",
          "pollingInterval": 60,
          "co2AlertThreshold": 1000,
          "enableHistory": true
        }
      ]
    }
  ]
}
```

Start with auto-discovery (no `devices` array). Once the plugin discovers your Aranet4 and logs the address, you can add it to the config for reliable matching.

## Step 5: Restart Homebridge

```bash
sudo systemctl restart homebridge
```

Or restart via the Homebridge UI.

## Step 6: Check the logs

Watch the Homebridge logs for these key lines:

```
[Aranet4] Aranet4 platform initializing...
[Aranet4] Plugin version: 0.1.0
[Aranet4] BLE scan active — listening for Aranet4 advertisements
[Aranet4] Discovered Aranet4: "Aranet4 Home" [aabbccddeeff] via advertisement
[Aranet4] Adding new accessory for device aabbccddeeff: "Aranet4"
```

**If you see "no sensor data in advertisement"** — Smart Home integrations is not enabled on the Aranet4. See "Before you start" above.

**If you see "BLE scan start failed"** — Bluetooth permissions issue. See the Linux setup above, or check macOS Bluetooth permissions (System Settings > Privacy & Security > Bluetooth).

**If you see nothing about Aranet4 at all** — The device may be out of BLE range (typically 10-20m), or the Bluetooth adapter isn't working. Check `hciconfig` on Linux or System Settings on macOS.

## Step 7: Verify in HomeKit / Eve

Once the plugin discovers the device and logs a reading:

- Open the **Home** app — you should see CO2, Temperature, Humidity, Air Quality, and Battery sensors
- Open the **Eve** app — you should see the same sensors plus atmospheric pressure and historical graphs (graphs will populate over time)

## What to test

1. **Do the readings match the Aranet4 display?** CO2, temperature, humidity should match what the device screen shows (within the measurement interval)
2. **Does the CO2 alert trigger?** If CO2 is above your threshold (default 1000 ppm), the CarbonDioxideDetected characteristic should show "abnormal"
3. **Does the battery level look right?** Compare to what the Aranet4 Home app shows
4. **Does pressure appear in Eve?** It won't show in Apple Home (no native support), but Eve should display it
5. **Do readings update on schedule?** With the default 60s polling interval, HomeKit should update roughly every minute
6. **Restart Homebridge** — does the plugin recover cleanly and resume readings?

## Finding your device address

The plugin logs the device identifier when it first discovers a device:

```
[Aranet4] Discovered Aranet4: "Aranet4 Home" [aabbccddeeff] via advertisement
```

- **On Linux:** this is the real MAC address. Format it as `AA:BB:CC:DD:EE:FF` for your config.
- **On macOS:** this is a system-assigned UUID, not the real MAC. Use the value the plugin logs, not the one from the Aranet4 Home app.

## Updating after code changes

When you make changes and want to re-test:

```bash
# On your dev machine
rm -rf dist && npx tsc
npm pack

# Transfer and reinstall
scp homebridge-aranet4-advanced-0.1.0.tgz user@homebridge-server:~/
ssh user@homebridge-server "sudo npm install -g ~/homebridge-aranet4-advanced-0.1.0.tgz && sudo systemctl restart homebridge"
```

## Uninstalling

```bash
sudo npm uninstall -g homebridge-aranet4-advanced
```

Remove the `Aranet4` platform entry from your Homebridge `config.json`, then restart Homebridge.
