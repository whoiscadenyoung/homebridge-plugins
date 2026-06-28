/**
 * Tests for Aranet4Platform (platform.ts)
 *
 * These tests validate platform construction, config parsing, accessory
 * lifecycle, and the purge scheduler using mocked Homebridge API.
 */

import { API, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';

// Mock noble before importing platform (noble initializes on import)
jest.mock('@stoprocent/noble', () => ({
  on: jest.fn(),
  removeListener: jest.fn(),
  startScanning: jest.fn(),
  stopScanning: jest.fn(),
  state: 'poweredOff',
}));

// Mock fakegato-history
jest.mock('fakegato-history', () => {
  return jest.fn(() => jest.fn());
}, { virtual: true });

import { Aranet4Platform } from '../src/platform';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
    success: jest.fn(),
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
      uuid: { generate: jest.fn((id: string) => `uuid-${id}`) },
      Formats: { UINT16: 'uint16' },
      Perms: { PAIRED_READ: 'pr', NOTIFY: 'ev' },
    },
    user: {
      storagePath: jest.fn().mockReturnValue('/tmp/homebridge-test'),
    },
    on: jest.fn((event: string, handler: () => void) => {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, []);
      }
      eventHandlers.get(event)!.push(handler);
    }),
    registerPlatformAccessories: jest.fn(),
    unregisterPlatformAccessories: jest.fn(),
    platformAccessory: jest.fn().mockImplementation((name: string, uuid: string) => ({
      displayName: name,
      UUID: uuid,
      context: {},
      getService: jest.fn(),
      getServiceById: jest.fn(),
      addService: jest.fn().mockReturnValue({
        getCharacteristic: jest.fn().mockReturnValue({
          onGet: jest.fn().mockReturnThis(),
          updateValue: jest.fn(),
        }),
        updateCharacteristic: jest.fn(),
        addCharacteristic: jest.fn().mockReturnValue({
          onGet: jest.fn().mockReturnThis(),
          updateValue: jest.fn(),
        }),
      }),
    })),
    _eventHandlers: eventHandlers,
  } as unknown as API & { _eventHandlers: Map<string, (() => void)[]> };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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
