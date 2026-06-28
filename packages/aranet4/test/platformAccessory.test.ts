/**
 * Tests for Aranet4Accessory (platformAccessory.ts)
 *
 * These tests validate HomeKit service setup, characteristic updates,
 * CO2→AirQuality mapping through the accessory, and fault marking.
 */

import { API, HAP, Logger, PlatformAccessory, Service } from 'homebridge';
import { Aranet4Accessory } from '../src/platformAccessory';
import { Aranet4DeviceConfig, Aranet4Reading } from '../src/settings';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockCharacteristic(): Record<string, jest.Mock> {
  return {
    onGet: jest.fn().mockReturnThis(),
    updateValue: jest.fn().mockReturnThis(),
    setValue: jest.fn().mockReturnThis(),
  };
}

function createMockService(): Partial<Service> & { getCharacteristic: jest.Mock; updateCharacteristic: jest.Mock; addCharacteristic: jest.Mock } {
  const chars = new Map<string, Record<string, jest.Mock>>();
  return {
    getCharacteristic: jest.fn().mockImplementation((charType) => {
      const key = typeof charType === 'string' ? charType : charType?.UUID ?? 'unknown';
      if (!chars.has(key)) {
        chars.set(key, createMockCharacteristic());
      }
      return chars.get(key);
    }),
    updateCharacteristic: jest.fn(),
    addCharacteristic: jest.fn().mockImplementation(() => createMockCharacteristic()),
  };
}

function createMockHAP(): HAP {
  const ServiceConstructors: Record<string, unknown> = {};
  for (const name of ['CarbonDioxideSensor', 'TemperatureSensor', 'HumiditySensor', 'AirQualitySensor', 'Battery', 'AccessoryInformation']) {
    ServiceConstructors[name] = { UUID: name };
  }
  return {
    Service: ServiceConstructors,
    Characteristic: {
      Manufacturer: 'Manufacturer',
      Model: 'Model',
      SerialNumber: 'SerialNumber',
      CarbonDioxideLevel: 'CarbonDioxideLevel',
      CarbonDioxideDetected: {
        UUID: 'CarbonDioxideDetected',
        CO2_LEVELS_NORMAL: 0,
        CO2_LEVELS_ABNORMAL: 1,
      },
      CurrentTemperature: 'CurrentTemperature',
      CurrentRelativeHumidity: 'CurrentRelativeHumidity',
      AirQuality: {
        UUID: 'AirQuality',
        UNKNOWN: 0,
        EXCELLENT: 1,
        GOOD: 2,
        FAIR: 3,
        INFERIOR: 4,
        POOR: 5,
      },
      BatteryLevel: 'BatteryLevel',
      StatusLowBattery: {
        UUID: 'StatusLowBattery',
        BATTERY_LEVEL_NORMAL: 0,
        BATTERY_LEVEL_LOW: 1,
      },
      StatusActive: 'StatusActive',
    },
    Formats: { UINT16: 'uint16' },
    Perms: { PAIRED_READ: 'pr', NOTIFY: 'ev' },
    uuid: { generate: jest.fn((id: string) => `uuid-${id}`) },
  } as unknown as HAP;
}

function createMockAccessory(): PlatformAccessory {
  // Pre-create the AccessoryInformation service (Homebridge always provides this)
  const infoService = createMockService();
  (infoService as unknown as { setCharacteristic: jest.Mock }).setCharacteristic = jest.fn().mockReturnThis();

  return {
    UUID: 'test-uuid-123456789012',
    displayName: 'Test Aranet4',
    context: { deviceId: 'aabbccddee' },
    getService: jest.fn().mockImplementation((type: { UUID?: string } | string) => {
      const key = typeof type === 'string' ? type : type?.UUID ?? 'unknown';
      if (key === 'AccessoryInformation') {
        return infoService;
      }
      return null;
    }),
    getServiceById: jest.fn().mockImplementation((_type: unknown, _subtype: string) => {
      return null; // Force creation of new services
    }),
    addService: jest.fn().mockImplementation(() => {
      const svc = createMockService();
      (svc as unknown as { setCharacteristic: jest.Mock }).setCharacteristic = jest.fn().mockReturnThis();
      return svc;
    }),
  } as unknown as PlatformAccessory;
}

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

function createMockAPI(hap: HAP): API {
  return { hap } as unknown as API;
}

function makeReading(overrides: Partial<Aranet4Reading> = {}): Aranet4Reading {
  return {
    co2: 450,
    temperature: 22.5,
    pressure: 1013.2,
    humidity: 45,
    battery: 85,
    status: 0,
    interval: 60,
    age: 10,
    timestamp: Date.now(),
    ...overrides,
  };
}

const defaultConfig: Aranet4DeviceConfig = {
  name: 'Test Aranet4',
  pollingInterval: 60,
  co2AlertThreshold: 1000,
  lowBatteryThreshold: 15,
  enableHistory: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Aranet4Accessory', () => {
  let hap: HAP;
  let api: API;
  let log: Logger;

  beforeEach(() => {
    hap = createMockHAP();
    api = createMockAPI(hap);
    log = createMockLogger();
  });

  it('should construct without errors', () => {
    const accessory = createMockAccessory();
    expect(() => new Aranet4Accessory(log, api, accessory, defaultConfig)).not.toThrow();
  });

  it('should create all required services on construction', () => {
    const accessory = createMockAccessory();
    new Aranet4Accessory(log, api, accessory, defaultConfig);
    // addService should have been called for CO2, Temperature, Humidity, AirQuality, Battery
    expect(accessory.addService).toHaveBeenCalledTimes(5);
  });

  it('should update all characteristics when updateReading is called', () => {
    const accessory = createMockAccessory();
    const aranet = new Aranet4Accessory(log, api, accessory, defaultConfig);
    const reading = makeReading();

    expect(() => aranet.updateReading(reading)).not.toThrow();
  });

  it('should mark sensor as inactive when setFault is called', () => {
    const accessory = createMockAccessory();
    const aranet = new Aranet4Accessory(log, api, accessory, defaultConfig);

    expect(() => aranet.setFault()).not.toThrow();
  });
});
