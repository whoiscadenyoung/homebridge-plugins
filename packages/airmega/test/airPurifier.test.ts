/**
 * Tests for AirPurifierAccessory (accessories/airPurifier.ts).
 *
 * The HAP services and the CowayClient are mocked so these tests run without
 * any hardware or network access.
 */

import { describe, it, expect, beforeEach, mock, jest } from 'bun:test';
import type { PlatformAccessory } from 'homebridge';
import { AirPurifierAccessory } from '../src/accessories/airPurifier.js';
import type { AirmegaPlatform } from '../src/platform.js';
import type { CowayDevice, DeviceState } from '../src/api/types.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

// Characteristic key constants — plain strings used as identifiers so we can
// track which handlers were registered per-characteristic.
const C = {
  Active: 'Active',
  CurrentAirPurifierState: 'CurrentAirPurifierState',
  TargetAirPurifierState: 'TargetAirPurifierState',
  RotationSpeed: 'RotationSpeed',
  AirQuality: 'AirQuality',
  PM2_5Density: 'PM2_5Density',
  PM10Density: 'PM10Density',
  FilterLifeLevel: 'FilterLifeLevel',
  FilterChangeIndication: 'FilterChangeIndication',
  On: 'On',
  Manufacturer: 'Manufacturer',
  Model: 'Model',
  SerialNumber: 'SerialNumber',
  FirmwareRevision: 'FirmwareRevision',
  Name: 'Name',
  ConfiguredName: 'ConfiguredName',
};

const S = {
  AirPurifier: { UUID: 'AirPurifier' },
  AirQualitySensor: { UUID: 'AirQualitySensor' },
  FilterMaintenance: { UUID: 'FilterMaintenance' },
  Switch: { UUID: 'Switch' },
  AccessoryInformation: { UUID: 'AccessoryInformation' },
};

type HandlerMap = Map<string, { get?: () => unknown; set?: (v: unknown) => Promise<void> }>;

class MockCharacteristic {
  private _get?: () => unknown;
  private _set?: (v: unknown) => Promise<void>;

  onGet = mock((fn: () => unknown) => { this._get = fn; return this; });
  onSet = mock((fn: (v: unknown) => Promise<void>) => { this._set = fn; return this; });
  setProps = mock(() => this);
  updateValue = mock(() => {});

  async callGet() { return this._get?.(); }
  async callSet(v: unknown) { return this._set?.(v); }
  hasGet() { return this._get !== undefined; }
  hasSet() { return this._set !== undefined; }
}

class MockService {
  private chars = new Map<string, MockCharacteristic>();

  getCharacteristic(key: string): MockCharacteristic {
    if (!this.chars.has(key)) this.chars.set(key, new MockCharacteristic());
    return this.chars.get(key)!;
  }

  getChar(key: string): MockCharacteristic | undefined {
    return this.chars.get(key);
  }

  updateCharacteristic = mock((key: string, _value: unknown) => {
    // Ensure the characteristic exists so it can be retrieved later
    if (!this.chars.has(key)) this.chars.set(key, new MockCharacteristic());
  });
  setCharacteristic = mock(function() { return this; });
  addOptionalCharacteristic = mock(() => {});
  setPrimaryService = mock(() => {});
  testCharacteristic = mock(() => false);
  removeCharacteristic = mock(() => {});
  addCharacteristic = mock(() => new MockCharacteristic());
}

function createMockAccessory(device: CowayDevice): PlatformAccessory & {
  _services: Map<string, MockService>;
} {
  const services = new Map<string, MockService>();

  function getOrCreate(key: string): MockService {
    if (!services.has(key)) services.set(key, new MockService());
    return services.get(key)!;
  }

  // AccessoryInformation is always pre-provided by Homebridge
  getOrCreate('AccessoryInformation');

  return {
    UUID: `uuid-${device.deviceId}`,
    displayName: device.name,
    context: { device },
    getService: mock((type: { UUID?: string } | string) => {
      const key = typeof type === 'string' ? type : type?.UUID ?? '';
      if (key === 'AccessoryInformation') return services.get('AccessoryInformation')!;
      return null; // Force creation via addService for everything else
    }),
    getServiceById: mock((_type: unknown, subtype: string) => {
      // Return null to force addService on first construction
      return services.get(subtype) ?? null;
    }),
    addService: mock((type: { UUID?: string } | string, _name?: string, subtype?: string) => {
      const key = subtype ?? (typeof type === 'string' ? type : type?.UUID ?? 'unknown');
      return getOrCreate(key);
    }),
    removeService: mock(() => {}),
    _services: services,
  } as unknown as PlatformAccessory & { _services: Map<string, MockService> };
}

function createMockPlatform(deviceConfig: {
  exposeLight?: boolean;
  productModel?: string;
} = {}): AirmegaPlatform & {
  _getDeviceStateMock: ReturnType<typeof mock>;
  _sendCommandMock: ReturnType<typeof mock>;
} {
  const mockGetDeviceState = mock(async (): Promise<DeviceState> => ({
    power: false,
    mode: 'auto',
    fanSpeed: 2,
    lightOn: false,
    airQuality: 0,
    pm25: undefined,
    pm10: undefined,
    preFilterPct: undefined,
    max2FilterPct: undefined,
    timerMinutesRemaining: undefined,
    mcuVersion: undefined,
  }));
  const mockSendCommand = mock(async () => {});

  return {
    Service: S,
    Characteristic: C,
    config: { exposeLight: deviceConfig.exposeLight ?? true } as never,
    log: {
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
      debug: mock(() => {}),
      log: mock(() => {}),
      success: mock(() => {}),
    },
    client: {
      getDeviceState: mockGetDeviceState,
      sendCommand: mockSendCommand,
    } as never,
    accessories: [],
    api: {} as never,
    _getDeviceStateMock: mockGetDeviceState,
    _sendCommandMock: mockSendCommand,
  } as unknown as AirmegaPlatform & {
    _getDeviceStateMock: ReturnType<typeof mock>;
    _sendCommandMock: ReturnType<typeof mock>;
  };
}

function make400SDevice(overrides: Partial<CowayDevice> = {}): CowayDevice {
  return {
    deviceId: 'serial-400s',
    name: 'Airmega 400S',
    model: 'Airmega 400S',
    modelCode: '02EUZ',
    productModel: 'AP-2015E',
    placeId: '1',
    serial: 'serial-400s',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Construction smoke tests
// ---------------------------------------------------------------------------

describe('AirPurifierAccessory construction', () => {
  beforeEach(() => jest.useFakeTimers());

  it('constructs without throwing for a known model (400S)', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory(make400SDevice());
    expect(() => new AirPurifierAccessory(platform, accessory, 60_000)).not.toThrow();
  });

  it('constructs without throwing for MightyS (eco preset, no sleep)', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory(make400SDevice({ productModel: 'AP-1512HHS' }));
    expect(() => new AirPurifierAccessory(platform, accessory, 60_000)).not.toThrow();
  });

  it('constructs without throwing for 250S (sleep + smart presets)', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory(make400SDevice({ productModel: 'AP-1719A' }));
    expect(() => new AirPurifierAccessory(platform, accessory, 60_000)).not.toThrow();
  });

  it('logs a warning for an unknown productModel', () => {
    const platform = createMockPlatform();
    const device = make400SDevice({ productModel: 'AP-9999X-UNKNOWN' });
    const accessory = createMockAccessory(device);
    new AirPurifierAccessory(platform, accessory, 60_000);
    const warnCalls = (platform.log.warn as ReturnType<typeof mock>).mock.calls;
    expect(warnCalls.some(c => String(c[0]).includes('AP-9999X-UNKNOWN'))).toBe(true);
  });

  it('does not warn for a known productModel', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory(make400SDevice());
    new AirPurifierAccessory(platform, accessory, 60_000);
    const warnCalls = (platform.log.warn as ReturnType<typeof mock>).mock.calls;
    expect(warnCalls.some(c => String(c[0]).includes('unknown productModel'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Service registration (capability gating)
// ---------------------------------------------------------------------------

describe('AirPurifierAccessory service / preset gating', () => {
  beforeEach(() => jest.useFakeTimers());

  it('400S: adds a Sleep switch but no Eco or Smart switch', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory(make400SDevice());
    new AirPurifierAccessory(platform, accessory, 60_000);

    // addService called with subtype 'preset-sleep' but NOT 'preset-eco' or 'preset-smart'
    const addCalls = (accessory.addService as ReturnType<typeof mock>).mock.calls
      .map(c => c[2]); // third arg = subtype
    expect(addCalls).toContain('preset-sleep');
    expect(addCalls).not.toContain('preset-eco');
    expect(addCalls).not.toContain('preset-smart');
  });

  it('MightyS: adds Eco switch but no Sleep switch', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory(make400SDevice({ productModel: 'AP-1512HHS' }));
    new AirPurifierAccessory(platform, accessory, 60_000);

    const addCalls = (accessory.addService as ReturnType<typeof mock>).mock.calls
      .map(c => c[2]);
    expect(addCalls).toContain('preset-eco');
    expect(addCalls).not.toContain('preset-sleep');
    expect(addCalls).not.toContain('preset-smart');
  });

  it('250S: adds Sleep and Smart switches', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory(make400SDevice({ productModel: 'AP-1719A' }));
    new AirPurifierAccessory(platform, accessory, 60_000);

    const addCalls = (accessory.addService as ReturnType<typeof mock>).mock.calls
      .map(c => c[2]);
    expect(addCalls).toContain('preset-sleep');
    expect(addCalls).toContain('preset-smart');
    expect(addCalls).not.toContain('preset-eco');
  });

  it('adds a Display Light switch by default (exposeLight=true)', () => {
    const platform = createMockPlatform({ exposeLight: true });
    const accessory = createMockAccessory(make400SDevice());
    new AirPurifierAccessory(platform, accessory, 60_000);

    const addCalls = (accessory.addService as ReturnType<typeof mock>).mock.calls
      .map(c => c[2]);
    expect(addCalls).toContain('led');
  });

  it('removes the Display Light switch when exposeLight=false', () => {
    const platform = createMockPlatform({ exposeLight: false });
    const accessory = createMockAccessory(make400SDevice());

    // Pre-seed the LED service as if it was previously registered
    const ledSvc = new MockService();
    (accessory._services as Map<string, MockService>).set('led', ledSvc);
    (accessory.getServiceById as ReturnType<typeof mock>).mockImplementation(
      (_type: unknown, subtype: string) =>
        (accessory._services as Map<string, MockService>).get(subtype) ?? null,
    );

    new AirPurifierAccessory(platform, accessory, 60_000);
    expect(accessory.removeService).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Characteristic handler registration
// ---------------------------------------------------------------------------

describe('AirPurifierAccessory characteristic handlers', () => {
  beforeEach(() => jest.useFakeTimers());

  function buildAccessory() {
    const platform = createMockPlatform();
    const device = make400SDevice();
    const accessory = createMockAccessory(device);
    new AirPurifierAccessory(platform, accessory, 60_000);
    return { platform, accessory, device };
  }

  it('registers onGet for Active', () => {
    const { accessory } = buildAccessory();
    const purifier = accessory._services.get('AirPurifier')!;
    expect(purifier.getChar(C.Active)?.hasGet()).toBe(true);
  });

  it('registers onSet for Active', () => {
    const { accessory } = buildAccessory();
    const purifier = accessory._services.get('AirPurifier')!;
    expect(purifier.getChar(C.Active)?.hasSet()).toBe(true);
  });

  it('Active onGet returns 0 before first state poll (power undefined)', async () => {
    const { accessory } = buildAccessory();
    const purifier = accessory._services.get('AirPurifier')!;
    const value = await purifier.getChar(C.Active)?.callGet();
    expect(value).toBe(0);
  });

  it('registers onGet for TargetAirPurifierState', () => {
    const { accessory } = buildAccessory();
    const purifier = accessory._services.get('AirPurifier')!;
    expect(purifier.getChar(C.TargetAirPurifierState)?.hasGet()).toBe(true);
  });

  it('registers onGet for RotationSpeed with setProps', () => {
    const { accessory } = buildAccessory();
    const purifier = accessory._services.get('AirPurifier')!;
    const char = purifier.getChar(C.RotationSpeed);
    expect(char?.hasGet()).toBe(true);
    // setProps should have been called with minStep
    expect(char?.setProps.mock.calls.length).toBeGreaterThan(0);
    expect(char?.setProps.mock.calls[0][0]).toMatchObject({ minStep: expect.any(Number) });
  });

  it('registers onGet for AirQuality', () => {
    const { accessory } = buildAccessory();
    const aqSvc = accessory._services.get('AirQualitySensor')!;
    expect(aqSvc.getChar(C.AirQuality)?.hasGet()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Characteristic handler behavior
// ---------------------------------------------------------------------------

describe('AirPurifierAccessory handler behavior', () => {
  beforeEach(() => jest.useFakeTimers());

  it('Active onGet returns 1 after refresh populates power=true', async () => {
    const platform = createMockPlatform();
    platform._getDeviceStateMock.mockResolvedValueOnce({
      power: true,
      mode: 'auto',
      fanSpeed: 2,
      lightOn: false,
      airQuality: 1,
    } as DeviceState);

    const accessory = createMockAccessory(make400SDevice());
    new AirPurifierAccessory(platform, accessory, 60_000);

    // Let the initial refresh microtasks settle
    await Promise.resolve();
    await Promise.resolve();

    const purifier = accessory._services.get('AirPurifier')!;
    const value = await purifier.getChar(C.Active)?.callGet();
    expect(value).toBe(1);
  });

  it('Active onSet sends power ON command', async () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory(make400SDevice());
    new AirPurifierAccessory(platform, accessory, 60_000);

    const purifier = accessory._services.get('AirPurifier')!;
    await purifier.getChar(C.Active)?.callSet(1);

    expect(platform._sendCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({ productModel: 'AP-2015E' }),
      '0001',
      '1',
    );
  });

  it('Active onSet sends power OFF command', async () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory(make400SDevice());
    new AirPurifierAccessory(platform, accessory, 60_000);

    const purifier = accessory._services.get('AirPurifier')!;
    await purifier.getChar(C.Active)?.callSet(0);

    expect(platform._sendCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({ productModel: 'AP-2015E' }),
      '0001',
      '0',
    );
  });

  it('TargetAirPurifierState onSet → auto sends MODE=1', async () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory(make400SDevice());
    new AirPurifierAccessory(platform, accessory, 60_000);

    const purifier = accessory._services.get('AirPurifier')!;
    await purifier.getChar(C.TargetAirPurifierState)?.callSet(1); // 1 = Auto

    expect(platform._sendCommandMock).toHaveBeenCalledWith(
      expect.anything(), '0002', '1',
    );
  });

  it('TargetAirPurifierState onGet returns 1 when mode is auto', async () => {
    const platform = createMockPlatform();
    platform._getDeviceStateMock.mockResolvedValueOnce({
      power: true,
      mode: 'auto',
      fanSpeed: 2,
      lightOn: false,
      airQuality: 1,
    } as DeviceState);

    const accessory = createMockAccessory(make400SDevice());
    new AirPurifierAccessory(platform, accessory, 60_000);

    await Promise.resolve();
    await Promise.resolve();

    const purifier = accessory._services.get('AirPurifier')!;
    const value = await purifier.getChar(C.TargetAirPurifierState)?.callGet();
    expect(value).toBe(1);
  });

  it('TargetAirPurifierState onGet returns 0 when mode is manual', async () => {
    const platform = createMockPlatform();
    platform._getDeviceStateMock.mockResolvedValueOnce({
      power: true,
      mode: 'manual',
      fanSpeed: 2,
      lightOn: false,
      airQuality: 1,
    } as DeviceState);

    const accessory = createMockAccessory(make400SDevice());
    new AirPurifierAccessory(platform, accessory, 60_000);

    await Promise.resolve();
    await Promise.resolve();

    const purifier = accessory._services.get('AirPurifier')!;
    const value = await purifier.getChar(C.TargetAirPurifierState)?.callGet();
    expect(value).toBe(0);
  });

  it('eco mode reads as Auto (1) for 400S — eco is firmware-driven, not user-preset', async () => {
    const platform = createMockPlatform();
    platform._getDeviceStateMock.mockResolvedValueOnce({
      power: true,
      mode: 'eco',
      fanSpeed: 1,
      lightOn: false,
      airQuality: 1,
    } as DeviceState);

    const accessory = createMockAccessory(make400SDevice());
    new AirPurifierAccessory(platform, accessory, 60_000);

    await Promise.resolve();
    await Promise.resolve();

    const purifier = accessory._services.get('AirPurifier')!;
    const value = await purifier.getChar(C.TargetAirPurifierState)?.callGet();
    expect(value).toBe(1); // eco is Auto sub-state on 400S
  });

  it('eco mode reads as Manual (0) for MightyS — eco is a user-selectable preset', async () => {
    const platform = createMockPlatform();
    platform._getDeviceStateMock.mockResolvedValueOnce({
      power: true,
      mode: 'eco',
      fanSpeed: 1,
      lightOn: false,
      airQuality: 1,
    } as DeviceState);

    const accessory = createMockAccessory(make400SDevice({ productModel: 'AP-1512HHS' }));
    new AirPurifierAccessory(platform, accessory, 60_000);

    await Promise.resolve();
    await Promise.resolve();

    const purifier = accessory._services.get('AirPurifier')!;
    const value = await purifier.getChar(C.TargetAirPurifierState)?.callGet();
    expect(value).toBe(0); // eco is Manual + Eco preset on MightyS
  });

  it('light onSet is ignored when power is off (snaps back)', async () => {
    const platform = createMockPlatform();
    platform._getDeviceStateMock.mockResolvedValueOnce({
      power: false,
      mode: 'auto',
      fanSpeed: 1,
      lightOn: false,
      airQuality: 0,
    } as DeviceState);

    const accessory = createMockAccessory(make400SDevice());
    new AirPurifierAccessory(platform, accessory, 60_000);

    await Promise.resolve();
    await Promise.resolve();

    const lightSvc = accessory._services.get('led')!;
    await lightSvc.getChar(C.On)?.callSet(true);

    // Should NOT have sent a command since power is off
    expect(platform._sendCommandMock).not.toHaveBeenCalledWith(
      expect.anything(), '0007', expect.anything(),
    );
    // Should have snapped back via updateCharacteristic
    expect(lightSvc.updateCharacteristic.mock.calls.some(c => c[0] === C.On)).toBe(true);
  });

  it('light onSet sends LIGHT command when power is on', async () => {
    const platform = createMockPlatform();
    platform._getDeviceStateMock.mockResolvedValueOnce({
      power: true,
      mode: 'auto',
      fanSpeed: 2,
      lightOn: false,
      airQuality: 1,
    } as DeviceState);

    const accessory = createMockAccessory(make400SDevice());
    new AirPurifierAccessory(platform, accessory, 60_000);

    await Promise.resolve();
    await Promise.resolve();

    const lightSvc = accessory._services.get('led')!;
    await lightSvc.getChar(C.On)?.callSet(true);

    expect(platform._sendCommandMock).toHaveBeenCalledWith(
      expect.anything(), '0007', '2', // LightMode.ON = '2'
    );
  });

  it('RotationSpeed onGet returns 33 (≈33%) when fanSpeed=1', async () => {
    const platform = createMockPlatform();
    platform._getDeviceStateMock.mockResolvedValueOnce({
      power: true,
      mode: 'manual',
      fanSpeed: 1,
      lightOn: false,
      airQuality: 0,
    } as DeviceState);

    const accessory = createMockAccessory(make400SDevice());
    new AirPurifierAccessory(platform, accessory, 60_000);

    await Promise.resolve();
    await Promise.resolve();

    const purifier = accessory._services.get('AirPurifier')!;
    const value = await purifier.getChar(C.RotationSpeed)?.callGet();
    expect(value).toBe(33); // Math.round(1/3 * 100)
  });

  it('RotationSpeed onGet returns 100 when fanSpeed=3', async () => {
    const platform = createMockPlatform();
    platform._getDeviceStateMock.mockResolvedValueOnce({
      power: true,
      mode: 'manual',
      fanSpeed: 3,
      lightOn: false,
      airQuality: 0,
    } as DeviceState);

    const accessory = createMockAccessory(make400SDevice());
    new AirPurifierAccessory(platform, accessory, 60_000);

    await Promise.resolve();
    await Promise.resolve();

    const purifier = accessory._services.get('AirPurifier')!;
    const value = await purifier.getChar(C.RotationSpeed)?.callGet();
    expect(value).toBe(100);
  });
});
