import os from 'os';
import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import {
  PLATFORM_NAME,
  PLUGIN_NAME,
  Aranet4DeviceConfig,
  Aranet4PlatformConfig,
  DEFAULT_POLLING_INTERVAL,
  DEFAULT_CO2_ALERT_THRESHOLD,
  DEFAULT_LOW_BATTERY_THRESHOLD,
  Aranet4Reading,
  normalizeAddress,
} from './settings';
import { BleManager } from './bleManager';
import { Aranet4Accessory } from './platformAccessory';
import { MqttPublisher } from './mqttPublisher';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('../package.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp a value between min and max (inclusive). */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// Aranet4Platform — Dynamic Platform Plugin
// ---------------------------------------------------------------------------

export class Aranet4Platform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  private readonly accessories: PlatformAccessory[] = [];
  private readonly aranet4Accessories = new Map<string, Aranet4Accessory>();

  private bleManager: BleManager | null = null;
  private mqttPublisher: MqttPublisher | null = null;

  // FakeGato — loaded dynamically per-instance since it uses legacy module patterns.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private FakeGatoHistoryService: (new (...args: any[]) => Service) | null = null;

  private readonly deviceConfigs: Aranet4DeviceConfig[];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    const platformConfig = config as unknown as Aranet4PlatformConfig;
    if (platformConfig.mqttBroker) {
      this.mqttPublisher = new MqttPublisher(platformConfig.mqttBroker, 'aranet4', this.log);
    }
    this.deviceConfigs = (platformConfig.devices ?? []).map((d) => ({
      name: d.name || 'Aranet4',
      // Pre-normalize the address once so every subsequent lookup is a
      // simple string comparison without repeated toLowerCase/replace calls.
      address: d.address ? normalizeAddress(d.address) : undefined,
      pollingInterval: clamp(d.pollingInterval ?? DEFAULT_POLLING_INTERVAL, 60, 3600),
      co2AlertThreshold: clamp(d.co2AlertThreshold ?? DEFAULT_CO2_ALERT_THRESHOLD, 400, 5000),
      lowBatteryThreshold: clamp(d.lowBatteryThreshold ?? DEFAULT_LOW_BATTERY_THRESHOLD, 5, 50),
      enableHistory: d.enableHistory !== false,
    }));

    this.log.info('Aranet4 platform initializing...');

    // Validate config and warn about issues
    this.validateConfig(platformConfig);

    // Load FakeGato history service
    this.loadFakeGato();

    // Wait for Homebridge to finish restoring cached accessories
    this.api.on('didFinishLaunching', () => {
      this.log.info('Homebridge finished launching — starting Aranet4 plugin');
      this.initializePlugin();
    });

    // Graceful shutdown
    this.api.on('shutdown', () => {
      this.shutdown();
    });
  }

  // -----------------------------------------------------------------------
  // DynamicPlatformPlugin — called by Homebridge for cached accessories
  // -----------------------------------------------------------------------

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug(`Restoring cached accessory: ${accessory.displayName}`);
    this.accessories.push(accessory);
  }

  // -----------------------------------------------------------------------
  // Plugin lifecycle
  // -----------------------------------------------------------------------

  private initializePlugin(): void {
    try {
      this.logStartupDiagnostics();

      // Remove stale accessories that no longer match any configured device
      this.pruneStaleAccessories();

      // Initialize BLE manager
      this.bleManager = new BleManager(this.log, this.deviceConfigs);
      this.bleManager.onReading((deviceId, reading) => {
        this.handleReading(deviceId, reading);
      });
      this.bleManager.onStale((deviceId) => {
        this.handleStale(deviceId);
      });
      this.bleManager.start();

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.log.error(`Failed to initialize plugin: ${msg}`);
    }
  }

  private shutdown(): void {
    this.log.info('Aranet4 platform shutting down...');

    try {
      this.bleManager?.shutdown();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.log.warn(`Error shutting down BLE manager: ${msg}`);
    }

    this.mqttPublisher?.disconnect();
  }

  // -----------------------------------------------------------------------
  // Incoming sensor reading handler
  // -----------------------------------------------------------------------

  private handleReading(deviceId: string, reading: Aranet4Reading): void {
    try {
      const accessory = this.ensureAccessory(deviceId);
      accessory.updateReading(reading);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.log.error(`Error processing reading for device ${deviceId}: ${msg}`);
    }
  }

  private handleStale(deviceId: string): void {
    const accessory = this.aranet4Accessories.get(deviceId);
    if (accessory) {
      accessory.setFault();
    }
  }

  // -----------------------------------------------------------------------
  // Accessory management
  // -----------------------------------------------------------------------

  private ensureAccessory(deviceId: string): Aranet4Accessory {
    // Check if we already have an Aranet4Accessory wrapper for this device
    const existing = this.aranet4Accessories.get(deviceId);
    if (existing) {
      return existing;
    }

    // Find matching device config
    const deviceConfig = this.findDeviceConfig(deviceId) ?? {
      name: 'Aranet4',
      pollingInterval: DEFAULT_POLLING_INTERVAL,
      co2AlertThreshold: DEFAULT_CO2_ALERT_THRESHOLD,
      lowBatteryThreshold: DEFAULT_LOW_BATTERY_THRESHOLD,
      enableHistory: true,
    };

    // Check if Homebridge restored a cached accessory for this UUID
    const uuid = this.api.hap.uuid.generate(`aranet4-${deviceId}`);
    let platformAccessory = this.accessories.find((a) => a.UUID === uuid);

    if (!platformAccessory) {
      // Create a brand new accessory
      this.log.info(`Adding new accessory for device ${deviceId}: "${deviceConfig.name}"`);
      platformAccessory = new this.api.platformAccessory(deviceConfig.name, uuid);
      platformAccessory.context.deviceId = deviceId;
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [platformAccessory]);
      this.accessories.push(platformAccessory);
    } else {
      this.log.debug(`Using cached accessory for device ${deviceId}: "${deviceConfig.name}"`);
    }

    // Wrap in our Aranet4Accessory class
    const aranet4 = new Aranet4Accessory(
      this.log,
      this.api,
      platformAccessory,
      deviceConfig,
      this.mqttPublisher ?? undefined,
    );

    // Attach FakeGato history service if enabled
    if (deviceConfig.enableHistory && this.FakeGatoHistoryService) {
      try {
        const historyService = new this.FakeGatoHistoryService('room', platformAccessory, {
          log: this.log,
          storage: 'fs',
          path: this.api.user.storagePath(),
          filename: `fakegato-aranet4-${deviceId}.json`,
        });
        aranet4.setHistoryService(historyService as Service & { addEntry(entry: { time: number; [key: string]: number }): void });
        this.log.info(`FakeGato history enabled for ${deviceConfig.name}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.log.warn(`Failed to initialize FakeGato history: ${msg}`);
      }
    }

    this.aranet4Accessories.set(deviceId, aranet4);
    return aranet4;
  }

  // -----------------------------------------------------------------------
  // Stale accessory pruning (multi-device lifecycle)
  // -----------------------------------------------------------------------

  private pruneStaleAccessories(): void {
    // If explicit device addresses are configured, remove cached accessories
    // that don't match any configured device.
    // Addresses are already pre-normalized during config processing.
    const configuredAddresses = this.deviceConfigs
      .filter((c) => c.address)
      .map((c) => c.address!);

    if (configuredAddresses.length === 0) {
      return; // Auto-discovery mode — don't prune
    }

    const toRemove: PlatformAccessory[] = [];
    for (const acc of this.accessories) {
      const cachedDeviceId = acc.context?.deviceId as string | undefined;
      if (cachedDeviceId && !configuredAddresses.includes(cachedDeviceId)) {
        this.log.info(`Removing stale accessory: ${acc.displayName} [${cachedDeviceId}]`);
        toRemove.push(acc);
      }
    }

    if (toRemove.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, toRemove);
      for (const acc of toRemove) {
        const idx = this.accessories.indexOf(acc);
        if (idx >= 0) {
          this.accessories.splice(idx, 1);
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Device config lookup helper
  // -----------------------------------------------------------------------

  private findDeviceConfig(deviceId: string): Aranet4DeviceConfig | undefined {
    // First try to match by MAC address (already pre-normalized in config).
    const byAddress = this.deviceConfigs.find(
      (c) => c.address && c.address === deviceId,
    );
    if (byAddress) {
      return byAddress;
    }

    // Only fall back to the first config when there's exactly one device configured
    // (i.e. the user has a single device and is using auto-discovery). With multiple
    // devices configured, a missing address match should return undefined so the
    // caller uses hardcoded defaults rather than silently applying the wrong config.
    if (this.deviceConfigs.length === 1) {
      return this.deviceConfigs[0];
    }

    return undefined;
  }

  // -----------------------------------------------------------------------
  // Config validation
  // -----------------------------------------------------------------------

  private validateConfig(config: Aranet4PlatformConfig): void {
    const devices = config.devices ?? [];

    // Warn about multiple devices without addresses (ambiguous matching)
    const withoutAddress = devices.filter((d) => !d.address);
    if (devices.length > 1 && withoutAddress.length > 0) {
      this.log.warn(
        `${withoutAddress.length} of ${devices.length} devices have no MAC address configured. ` +
        'With multiple devices, each should have an explicit address for reliable matching.',
      );
    }

    // Warn about duplicate addresses
    const addresses = devices
      .filter((d) => d.address)
      .map((d) => normalizeAddress(d.address!));
    const seen = new Set<string>();
    for (const addr of addresses) {
      if (seen.has(addr)) {
        this.log.warn(`Duplicate device address detected: ${addr}. Only the first match will be used.`);
      }
      seen.add(addr);
    }

    // Warn about invalid MAC format (config schema validates too, but not all UIs enforce it)
    const macPattern = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
    for (const d of devices) {
      if (d.address && !macPattern.test(d.address)) {
        this.log.warn(
          `Device "${d.name ?? 'Aranet4'}" has non-standard MAC address "${d.address}". ` +
          'Expected format: AA:BB:CC:DD:EE:FF',
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // Startup diagnostics
  // -----------------------------------------------------------------------

  private logStartupDiagnostics(): void {
    this.log.info(`Plugin version: ${pkg.version}`);
    this.log.info(`Node ${process.version} | ${os.platform()} ${os.arch()}`);
    this.log.info(`Storage path: ${this.api.user.storagePath()}`);
    this.log.info(`FakeGato history: ${this.FakeGatoHistoryService ? 'available' : 'not loaded'}`);
    this.log.info(`MQTT logging: ${this.mqttPublisher ? 'enabled' : 'not configured'}`);
    this.log.info(`Configured devices: ${this.deviceConfigs.length}`);
    for (const d of this.deviceConfigs) {
      this.log.info(
        `  → "${d.name}" addr=${d.address ?? 'auto'} poll=${d.pollingInterval}s ` +
        `co2Alert=${d.co2AlertThreshold}ppm bat=${d.lowBatteryThreshold}% ` +
        `history=${d.enableHistory}`,
      );
    }
    if (this.deviceConfigs.length === 0) {
      this.log.warn(
        'No devices configured — the plugin will auto-discover any Aranet4 in range, ' +
        'but you should add explicit device entries for reliable operation.',
      );
    }
  }

  // -----------------------------------------------------------------------
  // FakeGato loader
  // -----------------------------------------------------------------------

  private loadFakeGato(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fakegato: typeof import('fakegato-history') = require('fakegato-history');
      this.FakeGatoHistoryService = fakegato(this.api);
      this.log.debug('FakeGato history service loaded');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.log.warn(`FakeGato history not available: ${msg}. Eve history will be disabled.`);
    }
  }
}
