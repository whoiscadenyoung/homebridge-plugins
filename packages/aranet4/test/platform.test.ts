import { mock, describe, it, expect, beforeEach } from 'bun:test';
import type { API, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';

// Mock noble before platform.ts (and its deps) are imported
mock.module('@stoprocent/noble', () => ({
  default: {
    on: mock(),
    removeListener: mock(),
    startScanning: mock(),
    stopScanning: mock(),
    state: 'poweredOff',
  },
}));

const { Aranet4Platform } = await import('../src/platform.js');

function createMockLogger(): Logger {
  return {
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
    log: mock(),
    success: mock(),
  } as unknown as Logger;
}

function createMockAPI(): API {
  const eventHandlers = new Map<string, (() => void)[]>();
  return {
    hap: {
      Service: {
        CarbonDioxideSensor: { UUID: 'CarbonDioxideSensor' },
        TemperatureSensor: { UUID: 'TemperatureSensor' },
        HumiditySensor: { UUID: 'HumiditySensor' },
        AirQualitySensor: { UUID: 'AirQualitySensor' },
        Battery: { UUID: 'Battery' },
        AccessoryInformation: { UUID: 'AccessoryInformation' },
      },
      Characteristic: {
        Manufacturer: 'Manufacturer',
        Model: 'Model',
        SerialNumber: 'SerialNumber',
      },
      uuid: { generate: mock((id: string) => `uuid-${id}`) },
      Formats: { UINT16: 'uint16' },
      Perms: { PAIRED_READ: 'pr', NOTIFY: 'ev' },
    },
    user: {
      storagePath: mock().mockReturnValue('/tmp/homebridge-test'),
    },
    on: mock().mockImplementation((event: string, handler: () => void) => {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, []);
      }
      eventHandlers.get(event)!.push(handler);
    }),
    registerPlatformAccessories: mock(),
    unregisterPlatformAccessories: mock(),
    platformAccessory: mock().mockImplementation((name: string, uuid: string) => ({
      displayName: name,
      UUID: uuid,
      context: {},
      getService: mock(),
      getServiceById: mock(),
      addService: mock().mockReturnValue({
        getCharacteristic: mock().mockReturnValue({
          onGet: mock().mockReturnThis(),
          updateValue: mock(),
        }),
        updateCharacteristic: mock(),
        addCharacteristic: mock().mockReturnValue({
          onGet: mock().mockReturnThis(),
          updateValue: mock(),
        }),
      }),
    })),
    _eventHandlers: eventHandlers,
  } as unknown as API & { _eventHandlers: Map<string, (() => void)[]> };
}

describe('Aranet4Platform', () => {
  let log: Logger;
  let api: ReturnType<typeof createMockAPI>;

  beforeEach(() => {
    log = createMockLogger();
    api = createMockAPI();
  });

  it('should construct with empty config', () => {
    const config: PlatformConfig = { platform: 'Aranet4', name: 'Aranet4' };
    expect(() => new Aranet4Platform(log, config, api as unknown as API)).not.toThrow();
  });

  it('should construct with device config and apply defaults', () => {
    const config: PlatformConfig = {
      platform: 'Aranet4',
      name: 'Aranet4',
      devices: [
        { name: 'Living Room', address: 'AA:BB:CC:DD:EE:FF' },
      ],
    };
    const platform = new Aranet4Platform(log, config, api as unknown as API);
    expect(platform).toBeDefined();
  });

  it('should register didFinishLaunching and shutdown handlers', () => {
    const config: PlatformConfig = { platform: 'Aranet4', name: 'Aranet4' };
    new Aranet4Platform(log, config, api as unknown as API);
    expect(api.on).toHaveBeenCalledWith('didFinishLaunching', expect.any(Function));
    expect(api.on).toHaveBeenCalledWith('shutdown', expect.any(Function));
  });

  it('should handle configureAccessory for cached accessories', () => {
    const config: PlatformConfig = { platform: 'Aranet4', name: 'Aranet4' };
    const platform = new Aranet4Platform(log, config, api as unknown as API);

    const mockAccessory = {
      displayName: 'Cached Aranet4',
      UUID: 'cached-uuid',
      context: { deviceId: 'aabbccddee' },
    } as unknown as PlatformAccessory;

    expect(() => platform.configureAccessory(mockAccessory)).not.toThrow();
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Restoring cached accessory'));
  });

  it('should log platform initialization message', () => {
    const config: PlatformConfig = { platform: 'Aranet4', name: 'Aranet4' };
    new Aranet4Platform(log, config, api as unknown as API);
    expect(log.info).toHaveBeenCalledWith('Aranet4 platform initializing...');
  });
});
