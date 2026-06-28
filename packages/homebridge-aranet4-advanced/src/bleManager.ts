import {
  Logger,
} from 'homebridge';
import noble, { Peripheral } from '@stoprocent/noble';
import {
  ARANET4_NAME_PREFIX,
  Aranet4Reading,
  Aranet4DeviceConfig,
  DEFAULT_POLLING_INTERVAL,
  STALE_THRESHOLD_MULTIPLIER,
  normalizeAddress,
} from './settings';
import { parseAdvertisement } from './aranet4Parser';

// ---------------------------------------------------------------------------
// SAF Tehnika BLE company ID (little-endian in manufacturer data)
// ---------------------------------------------------------------------------
const SAF_TEHNIKA_COMPANY_ID = 0x0702;

// ---------------------------------------------------------------------------
// Scan restart / retry constants
// ---------------------------------------------------------------------------

/** Delay before restarting scan after an unexpected scanStop (ms). */
const SCAN_RESTART_DELAY_MS = 2_500;

/** Initial retry delay when startScanning fails (ms). */
const SCAN_RETRY_INITIAL_MS = 5_000;

/** Maximum retry delay (ms) — caps exponential backoff at 60s. */
const SCAN_RETRY_MAX_MS = 60_000;

/** How often to check for stale devices (ms). */
const STALE_CHECK_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callback invoked each time fresh sensor data arrives. */
export type ReadingCallback = (deviceId: string, reading: Aranet4Reading) => void;

/** Callback invoked when a device hasn't been heard from in too long. */
export type StaleCallback = (deviceId: string) => void;

interface ManagedDevice {
  config: Aranet4DeviceConfig;
  /** Timestamp of last successfully processed reading. */
  lastReadingTime: number;
  /** True if this device has been reported as stale (reset on next reading). */
  stale: boolean;
}

// ---------------------------------------------------------------------------
// BleManager — discovers Aranet4 devices via passive advertisement scanning
// ---------------------------------------------------------------------------

export class BleManager {
  private readonly devices = new Map<string, ManagedDevice>();
  private scanning = false;
  private readingCallback: ReadingCallback | null = null;
  private staleCallback: StaleCallback | null = null;
  private poweredOn = false;
  private shuttingDown = false;

  // Timers
  private scanRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private scanRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private staleCheckTimer: ReturnType<typeof setInterval> | null = null;
  private scanRetryDelay = SCAN_RETRY_INITIAL_MS;

  // Track whether we've logged the unauthorized warning (don't spam)
  private loggedUnauthorized = false;

  // Stored references for proper listener cleanup
  private readonly onStateChange: (state: string) => void;
  private readonly onDiscover: (peripheral: Peripheral) => void;
  private readonly onScanStop: () => void;
  private readonly onWarning: (message: string) => void;

  constructor(
    private readonly log: Logger,
    private readonly deviceConfigs: Aranet4DeviceConfig[],
  ) {
    this.onStateChange = (state: string) => {
      this.handleStateChange(state);
    };

    this.onDiscover = (peripheral: Peripheral) => {
      this.handleDiscovery(peripheral);
    };

    this.onScanStop = () => {
      this.handleScanStop();
    };

    this.onWarning = (message: string) => {
      this.log.debug(`Noble warning: ${message}`);
    };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Register a callback that will be invoked on every new reading. */
  onReading(cb: ReadingCallback): void {
    this.readingCallback = cb;
  }

  /** Register a callback for when a device goes stale (no data for too long). */
  onStale(cb: StaleCallback): void {
    this.staleCallback = cb;
  }

  /** Begin scanning. Call once after Homebridge finishes launching. */
  start(): void {
    this.log.info('BLE manager starting — waiting for Bluetooth adapter...');

    noble.on('stateChange', this.onStateChange);
    noble.on('discover', this.onDiscover);
    noble.on('scanStop', this.onScanStop);
    noble.on('warning', this.onWarning);

    // If noble is already powered on (e.g. cached state)
    if ((noble as unknown as { state: string }).state === 'poweredOn') {
      this.poweredOn = true;
      this.startScan();
    }

    // Start periodic stale-device check
    this.staleCheckTimer = setInterval(() => {
      this.checkForStaleDevices();
    }, STALE_CHECK_INTERVAL_MS);
  }

  /** Gracefully shut down — stop scanning, clear all timers. */
  shutdown(): void {
    this.log.info('BLE manager shutting down...');
    this.shuttingDown = true;

    this.stopScan();
    this.clearTimers();

    noble.removeListener('stateChange', this.onStateChange);
    noble.removeListener('discover', this.onDiscover);
    noble.removeListener('scanStop', this.onScanStop);
    noble.removeListener('warning', this.onWarning);

    this.devices.clear();
  }

  // -----------------------------------------------------------------------
  // Bluetooth adapter state
  // -----------------------------------------------------------------------

  private handleStateChange(state: string): void {
    this.log.debug(`Bluetooth adapter state: ${state}`);

    if (state === 'poweredOn') {
      this.poweredOn = true;
      this.loggedUnauthorized = false;
      this.startScan();
    } else if (state === 'unauthorized') {
      this.poweredOn = false;
      this.stopScan();
      if (!this.loggedUnauthorized) {
        this.loggedUnauthorized = true;
        this.log.error(
          'Bluetooth access denied by the operating system. ' +
          'On macOS: open System Settings → Privacy & Security → Bluetooth, ' +
          'click "+", press Cmd+Shift+G, and add your Node.js binary ' +
          '(e.g., /usr/local/bin/node). This grants Bluetooth access to both ' +
          'the main bridge and child bridges. See the README for details.',
        );
      }
    } else {
      this.poweredOn = false;
      this.stopScan();
    }
  }

  // -----------------------------------------------------------------------
  // Scanning — continuous passive scanning with auto-restart
  // -----------------------------------------------------------------------

  private startScan(): void {
    if (this.scanning || !this.poweredOn || this.shuttingDown) {
      return;
    }
    this.log.info('Starting BLE scan for Aranet4 advertisements...');
    this.scanning = true;

    // Scan with allowDuplicates=true so we receive every advertisement,
    // not just the first one per device.  No service filter — we match
    // by manufacturer data or name in handleDiscovery.
    noble.startScanning([], true, (error?: Error) => {
      if (error) {
        this.log.error(`BLE scan start failed: ${error.message}`);
        this.scanning = false;
        this.scheduleScanRetry();
        return;
      }
      this.log.info('BLE scan active — listening for Aranet4 advertisements');
      // Reset retry backoff on success
      this.scanRetryDelay = SCAN_RETRY_INITIAL_MS;
    });
  }

  private stopScan(): void {
    if (this.scanning) {
      try {
        noble.stopScanning();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.log.warn(`Error stopping BLE scan: ${msg}`);
      }
      this.scanning = false;
    }
  }

  /**
   * Handle noble's scanStop event — scanning was interrupted externally
   * (another app took BLE, adapter reset, etc.).
   *
   * Debounced: noble issue #569 documents scanStop firing rapidly after
   * reboots. We only schedule one restart attempt at a time.
   */
  private handleScanStop(): void {
    if (this.shuttingDown) {
      return;
    }

    this.scanning = false;

    // Debounce: don't schedule multiple restarts
    if (this.scanRestartTimer) {
      return;
    }

    this.log.info('BLE scan stopped unexpectedly — will restart...');
    this.scanRestartTimer = setTimeout(() => {
      this.scanRestartTimer = null;
      if (this.poweredOn && !this.shuttingDown) {
        this.startScan();
      }
    }, SCAN_RESTART_DELAY_MS);
  }

  /**
   * Schedule a scan retry with exponential backoff after a startScanning failure.
   */
  private scheduleScanRetry(): void {
    if (this.shuttingDown || this.scanRetryTimer) {
      return;
    }

    const delaySec = Math.round(this.scanRetryDelay / 1000);
    this.log.warn(`Retrying BLE scan in ${delaySec}s...`);

    this.scanRetryTimer = setTimeout(() => {
      this.scanRetryTimer = null;
      this.startScan();
    }, this.scanRetryDelay);

    // Exponential backoff: double the delay, cap at max
    this.scanRetryDelay = Math.min(this.scanRetryDelay * 2, SCAN_RETRY_MAX_MS);
  }

  // -----------------------------------------------------------------------
  // Stale device detection
  // -----------------------------------------------------------------------

  private checkForStaleDevices(): void {
    const now = Date.now();

    for (const [deviceId, managed] of this.devices) {
      // Skip devices that were never heard from (e.g. name-only detection)
      if (managed.lastReadingTime === 0) {
        continue;
      }

      // Already reported as stale — don't spam
      if (managed.stale) {
        continue;
      }

      const pollingMs = (managed.config.pollingInterval ?? DEFAULT_POLLING_INTERVAL) * 1000;
      const staleThresholdMs = pollingMs * STALE_THRESHOLD_MULTIPLIER;
      const elapsed = now - managed.lastReadingTime;

      if (elapsed > staleThresholdMs) {
        managed.stale = true;
        const elapsedMin = Math.round(elapsed / 60_000);
        this.log.warn(
          `[${managed.config.name}] No data received for ${elapsedMin}m — marking sensor inactive. ` +
          'Check that the device is in BLE range and powered on.',
        );

        if (this.staleCallback) {
          this.staleCallback(deviceId);
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Timer cleanup
  // -----------------------------------------------------------------------

  private clearTimers(): void {
    if (this.scanRestartTimer) {
      clearTimeout(this.scanRestartTimer);
      this.scanRestartTimer = null;
    }
    if (this.scanRetryTimer) {
      clearTimeout(this.scanRetryTimer);
      this.scanRetryTimer = null;
    }
    if (this.staleCheckTimer) {
      clearInterval(this.staleCheckTimer);
      this.staleCheckTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // Discovery — process each advertisement
  // -----------------------------------------------------------------------

  private handleDiscovery(peripheral: Peripheral): void {
    // Top-level catch: an uncaught exception here propagates into noble's
    // EventEmitter and can crash the entire Homebridge process.
    try {
      this.processAdvertisement(peripheral);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.log.debug(`Error processing BLE advertisement: ${msg}`);
    }
  }

  private processAdvertisement(peripheral: Peripheral): void {
    const mfgData = peripheral.advertisement?.manufacturerData;

    // Fast path: check manufacturer data company ID first — avoids address
    // normalization and string ops for the vast majority of non-Aranet4 BLE
    // devices in range.
    if (mfgData && mfgData.length >= 2) {
      const companyId = mfgData.readUInt16LE(0);
      if (companyId === SAF_TEHNIKA_COMPANY_ID) {
        const id = normalizeAddress(peripheral.id ?? peripheral.uuid);
        const name = peripheral.advertisement?.localName ?? '';
        this.handleAranet4Advertisement(id, name, mfgData);
        return;
      }
    }

    // Fallback: match by name prefix for devices without manufacturer data.
    // Only normalize the address if the name matches first.
    const name = peripheral.advertisement?.localName ?? '';
    if (name.startsWith(ARANET4_NAME_PREFIX)) {
      const id = normalizeAddress(peripheral.id ?? peripheral.uuid);
      // Device is an Aranet4 but didn't include sensor data in advertisement.
      // This happens when "Smart Home integrations" is disabled in the app.
      if (!this.devices.has(id)) {
        this.log.warn(
          `Aranet4 "${name}" [${id}] detected but no sensor data in advertisement. ` +
          'Enable "Smart Home integrations" in the Aranet4 Home app.',
        );
        // Register the device so we don't spam this warning
        const config = this.findConfigForPeripheral(id, name) ?? this.buildDefaultConfig(name);
        this.devices.set(id, {
          config,
          lastReadingTime: 0,
          stale: false,
        });
      }
    }
  }

  private handleAranet4Advertisement(
    deviceId: string,
    name: string,
    manufacturerData: Buffer,
  ): void {
    // Parse sensor data from the advertisement
    const reading = parseAdvertisement(manufacturerData);
    if (!reading) {
      return; // Invalid or warmup data — silently skip
    }

    // Get or register the device
    let managed = this.devices.get(deviceId);
    if (!managed) {
      this.log.info(`Discovered Aranet4: "${name}" [${deviceId}] via advertisement`);
      const config = this.findConfigForPeripheral(deviceId, name) ?? this.buildDefaultConfig(name);
      managed = {
        config,
        lastReadingTime: 0,
        stale: false,
      };
      this.devices.set(deviceId, managed);
    }

    // Clear stale flag — device is back
    if (managed.stale) {
      this.log.info(`[${managed.config.name}] Device back in range — resuming readings`);
      managed.stale = false;
    }

    // Throttle: only emit a reading if enough time has passed since the last
    // one, based on the configured polling interval.  This avoids flooding
    // HomeKit with updates every ~1s (advertisement broadcast rate).
    const now = Date.now();
    const minIntervalMs = (managed.config.pollingInterval ?? DEFAULT_POLLING_INTERVAL) * 1000;
    if (now - managed.lastReadingTime < minIntervalMs) {
      return;
    }
    managed.lastReadingTime = now;

    this.log.debug(
      `[${managed.config.name}] CO2=${reading.co2}ppm T=${reading.temperature.toFixed(1)}°C ` +
      `RH=${reading.humidity}% P=${reading.pressure.toFixed(1)}hPa Bat=${reading.battery}%`,
    );

    if (this.readingCallback) {
      this.readingCallback(deviceId, reading);
    }
  }

  // -----------------------------------------------------------------------
  // Config lookup
  // -----------------------------------------------------------------------

  private findConfigForPeripheral(id: string, name: string): Aranet4DeviceConfig | undefined {
    // Config addresses are already pre-normalized by the platform, so this
    // is a simple string comparison — no repeated toLowerCase/replace calls.
    return this.deviceConfigs.find((cfg) => {
      if (cfg.address) {
        return cfg.address === id;
      }
      if (cfg.name && name) {
        return name.toLowerCase().includes(cfg.name.toLowerCase());
      }
      return false;
    });
  }

  private buildDefaultConfig(name: string): Aranet4DeviceConfig {
    return {
      name: name || 'Aranet4',
      pollingInterval: DEFAULT_POLLING_INTERVAL,
      co2AlertThreshold: 1000,
      lowBatteryThreshold: 15,
      enableHistory: true,
    };
  }
}
