import { mock, describe, it, expect, beforeEach } from 'bun:test';
import type { Mock } from 'bun:test';
import type { API, HAP, Logger, PlatformAccessory, Service } from 'homebridge';
import { Aranet4Accessory } from '../src/platformAccessory.js';
import type { Aranet4DeviceConfig, Aranet4Reading } from '../src/settings.js';

function createMockCharacteristic(): Record<string, Mock> {
  return {
    onGet: mock().mockReturnThis(),
    updateValue: mock().mockReturnThis(),
    setValue: mock().mockReturnThis(),
  };
}

function createMockService(): Partial<Service> & { getCharacteristic: Mock; updateCharacteristic: Mock; addCharacteristic: Mock } {
  const chars = new Map<string, Record<string, Mock>>();
  return {
    getCharacteristic: mock().mockImplementation((charType) => {
      const key = typeof charType === 'string' ? charType : charType?.UUID ?? 'unknown';
      if (!chars.has(key)) {
        chars.set(key, createMockCharacteristic());
      }
      return chars.get(key);
    }),
    updateCharacteristic: mock(),
    addCharacteristic: mock().mockImplementation(() => createMockCharacteristic()),
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
    uuid: { generate: mock((id: string) => `uuid-${id}`) },
  } as unknown as HAP;
}

function createMockAccessory(): PlatformAccessory {
  const infoService = createMockService();
  (infoService as unknown as { setCharacteristic: Mock }).setCharacteristic = mock().mockReturnThis();

  return {
    UUID: 'test-uuid-123456789012',
    displayName: 'Test Aranet4',
    context: { deviceId: 'aabbccddee' },
    getService: mock().mockImplementation((type: { UUID?: string } | string) => {
      const key = typeof type === 'string' ? type : type?.UUID ?? 'unknown';
      if (key === 'AccessoryInformation') {
        return infoService;
      }
      return null;
    }),
    getServiceById: mock().mockImplementation((_type: unknown, _subtype: string) => null),
    addService: mock().mockImplementation(() => {
      const svc = createMockService();
      (svc as unknown as { setCharacteristic: Mock }).setCharacteristic = mock().mockReturnThis();
      return svc;
    }),
  } as unknown as PlatformAccessory;
}

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
    expect(accessory.addService).toHaveBeenCalledTimes(5);
  });

  it('should update all characteristics when updateReading is called', () => {
    const accessory = createMockAccessory();
    const aranet = new Aranet4Accessory(log, api, accessory, defaultConfig);
    expect(() => aranet.updateReading(makeReading())).not.toThrow();
  });

  it('should mark sensor as inactive when setFault is called', () => {
    const accessory = createMockAccessory();
    const aranet = new Aranet4Accessory(log, api, accessory, defaultConfig);
    expect(() => aranet.setFault()).not.toThrow();
  });
});
