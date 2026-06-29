/**
 * Tests for AirmegaPlatform (platform.ts).
 *
 * CowayClient, AirPurifierAccessory, and MqttPublisher are all mocked so
 * these tests stay pure and don't make any HTTP or MQTT calls.
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import type { API, Logger, PlatformAccessory } from 'homebridge';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before importing the module under test.
// Bun hoists mock.module() calls like jest.mock().
// ---------------------------------------------------------------------------

const mockLogin = mock(async () => {});
const mockListDevices = mock(async () => [] as ReturnType<typeof mockListDevices> extends Promise<infer T> ? T : never);

mock.module('../src/api/cowayClient.js', () => ({
  CowayClient: class MockCowayClient {
    login = mockLogin;
    listDevices = mockListDevices;
    getDeviceState = mock(async () => ({}));
    sendCommand = mock(async () => {});
  },
}));

const mockAirPurifierCtor = mock(function MockAirPurifier() {});
mock.module('../src/accessories/airPurifier.js', () => ({
  AirPurifierAccessory: mockAirPurifierCtor,
}));

const mockDisconnect = mock(() => {});
mock.module('../src/mqttPublisher.js', () => ({
  MqttPublisher: class MockMqttPublisher {
    disconnect = mockDisconnect;
  },
}));

import { AirmegaPlatform } from '../src/platform.js';
import { DEFAULT_POLL_SECONDS, PLATFORM_NAME, PLUGIN_NAME } from '../src/settings.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockLogger(): Logger {
  return {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
    log: mock(() => {}),
    success: mock(() => {}),
  } as unknown as Logger;
}

function createMockAPI() {
  const handlers = new Map<string, Array<() => void>>();
  return {
    hap: {
      Service: {},
      Characteristic: {},
      uuid: { generate: mock((id: string) => `uuid-${id}`) },
    },
    on: mock(function(event: string, handler: () => void) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    }),
    registerPlatformAccessories: mock(() => {}),
    updatePlatformAccessories: mock(() => {}),
    unregisterPlatformAccessories: mock(() => {}),
    platformAccessory: mock((name: string, uuid: string) => ({
      displayName: name,
      UUID: uuid,
      context: {} as Record<string, unknown>,
      getService: mock(() => ({
        setCharacteristic: mock(function() { return this; }),
        getCharacteristic: mock(() => ({
          onGet: mock(function() { return this; }),
          onSet: mock(function() { return this; }),
          setProps: mock(function() { return this; }),
        })),
        addOptionalCharacteristic: mock(() => {}),
        setPrimaryService: mock(() => {}),
        updateCharacteristic: mock(() => {}),
      })),
      getServiceById: mock(() => null),
      addService: mock(() => ({
        setCharacteristic: mock(function() { return this; }),
        getCharacteristic: mock(() => ({
          onGet: mock(function() { return this; }),
          onSet: mock(function() { return this; }),
          setProps: mock(function() { return this; }),
        })),
        addOptionalCharacteristic: mock(() => {}),
        setPrimaryService: mock(() => {}),
        updateCharacteristic: mock(() => {}),
      })),
      removeService: mock(() => {}),
    })),
    _fire: (event: string) => handlers.get(event)?.forEach(h => h()),
  };
}

function makeDevice(overrides: Record<string, unknown> = {}) {
  return {
    deviceId: 'serial-abc',
    name: 'Test Purifier',
    model: 'Airmega 400S',
    modelCode: '02EUZ',
    productModel: 'AP-2015E',
    placeId: '1',
    serial: 'serial-abc',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('AirmegaPlatform construction', () => {
  let log: Logger;
  let api: ReturnType<typeof createMockAPI>;

  beforeEach(() => {
    log = createMockLogger();
    api = createMockAPI();
    mockLogin.mockClear();
    mockListDevices.mockClear();
    mockAirPurifierCtor.mockClear();
  });

  it('constructs without throwing for valid config', () => {
    expect(() => new AirmegaPlatform(
      log,
      { platform: 'AirmegaPlatform', name: 'Airmega', username: 'u@test.com', password: 'pass' },
      api as unknown as API,
    )).not.toThrow();
  });

  it('logs error and sets configured=false when username is missing', () => {
    new AirmegaPlatform(
      log,
      { platform: 'AirmegaPlatform', name: 'Airmega', password: 'pass' } as never,
      api as unknown as API,
    );
    expect((log.error as ReturnType<typeof mock>).mock.calls.length).toBeGreaterThan(0);
  });

  it('logs error and sets configured=false when password is missing', () => {
    new AirmegaPlatform(
      log,
      { platform: 'AirmegaPlatform', name: 'Airmega', username: 'u@test.com' } as never,
      api as unknown as API,
    );
    expect((log.error as ReturnType<typeof mock>).mock.calls.length).toBeGreaterThan(0);
  });

  it('registers didFinishLaunching and shutdown event handlers', () => {
    new AirmegaPlatform(
      log,
      { platform: 'AirmegaPlatform', name: 'Airmega', username: 'u@test.com', password: 'pass' },
      api as unknown as API,
    );
    const calls = (api.on as ReturnType<typeof mock>).mock.calls.map(c => c[0]);
    expect(calls).toContain('didFinishLaunching');
    expect(calls).toContain('shutdown');
  });

  it('clears the password from config after construction', () => {
    const config = {
      platform: 'AirmegaPlatform',
      name: 'Airmega',
      username: 'u@test.com',
      password: 'super-secret',
    };
    new AirmegaPlatform(log, config, api as unknown as API);
    expect(config.password).toBe('');
  });

  it('exposes Service and Characteristic from the HAP instance', () => {
    const platform = new AirmegaPlatform(
      log,
      { platform: 'AirmegaPlatform', name: 'Airmega', username: 'u@test.com', password: 'pass' },
      api as unknown as API,
    );
    expect(platform.Service).toBe(api.hap.Service);
    expect(platform.Characteristic).toBe(api.hap.Characteristic);
  });
});

// ---------------------------------------------------------------------------
// pollingInterval clamping
// ---------------------------------------------------------------------------

describe('AirmegaPlatform pollingInterval clamping', () => {
  let log: Logger;
  let api: ReturnType<typeof createMockAPI>;

  beforeEach(() => {
    log = createMockLogger();
    api = createMockAPI();
    mockLogin.mockClear();
    mockAirPurifierCtor.mockClear();
  });

  async function discoverWithInterval(pollingInterval: unknown) {
    const platform = new AirmegaPlatform(
      log,
      { platform: 'AirmegaPlatform', name: 'Airmega', username: 'u@test.com', password: 'pass', pollingInterval } as never,
      api as unknown as API,
    );
    mockListDevices.mockResolvedValueOnce([makeDevice()] as never);
    await platform.discoverDevices();
    return mockAirPurifierCtor.mock.calls[0]?.[2] as number | undefined;
  }

  it('uses DEFAULT_POLL_SECONDS when pollingInterval is omitted', async () => {
    const platform = new AirmegaPlatform(
      log,
      { platform: 'AirmegaPlatform', name: 'Airmega', username: 'u@test.com', password: 'pass' },
      api as unknown as API,
    );
    mockListDevices.mockResolvedValueOnce([makeDevice()] as never);
    await platform.discoverDevices();
    const interval = mockAirPurifierCtor.mock.calls[0]?.[2] as number;
    expect(interval).toBe(DEFAULT_POLL_SECONDS * 1000);
  });

  it('clamps values below 30s to 30s', async () => {
    const interval = await discoverWithInterval(10);
    expect(interval).toBe(30 * 1000);
  });

  it('uses 0 → 30s (clamped)', async () => {
    const interval = await discoverWithInterval(0);
    expect(interval).toBe(30 * 1000);
  });

  it('passes values above 30s through unchanged', async () => {
    const interval = await discoverWithInterval(90);
    expect(interval).toBe(90 * 1000);
  });

  it('falls back to DEFAULT_POLL_SECONDS for NaN string input', async () => {
    const interval = await discoverWithInterval('abc');
    expect(interval).toBe(DEFAULT_POLL_SECONDS * 1000);
  });

  it('null coerces to 0 via Number(), which is clamped to the 30s minimum', async () => {
    // Number(null) === 0 — finite, so the clamping path runs rather than the NaN default
    const interval = await discoverWithInterval(null);
    expect(interval).toBe(30 * 1000);
  });
});

// ---------------------------------------------------------------------------
// configureAccessory
// ---------------------------------------------------------------------------

describe('AirmegaPlatform.configureAccessory', () => {
  it('pushes the accessory into the cached accessories array', () => {
    const log = createMockLogger();
    const api = createMockAPI();
    const platform = new AirmegaPlatform(
      log,
      { platform: 'AirmegaPlatform', name: 'Airmega', username: 'u@test.com', password: 'pass' },
      api as unknown as API,
    );

    const fakeAccessory = { displayName: 'Cached', UUID: 'cached-uuid-1' } as unknown as PlatformAccessory;
    platform.configureAccessory(fakeAccessory);
    expect(platform.accessories).toContain(fakeAccessory);
  });

  it('logs info about the cached accessory', () => {
    const log = createMockLogger();
    const api = createMockAPI();
    const platform = new AirmegaPlatform(
      log,
      { platform: 'AirmegaPlatform', name: 'Airmega', username: 'u@test.com', password: 'pass' },
      api as unknown as API,
    );

    const fakeAccessory = { displayName: 'My Purifier', UUID: 'uuid-x' } as unknown as PlatformAccessory;
    platform.configureAccessory(fakeAccessory);
    expect((log.info as ReturnType<typeof mock>).mock.calls.some(
      c => String(c[0]).includes('My Purifier'),
    )).toBe(true);
  });

  it('accumulates multiple cached accessories', () => {
    const log = createMockLogger();
    const api = createMockAPI();
    const platform = new AirmegaPlatform(
      log,
      { platform: 'AirmegaPlatform', name: 'Airmega', username: 'u@test.com', password: 'pass' },
      api as unknown as API,
    );

    platform.configureAccessory({ displayName: 'A', UUID: 'uuid-a' } as unknown as PlatformAccessory);
    platform.configureAccessory({ displayName: 'B', UUID: 'uuid-b' } as unknown as PlatformAccessory);
    expect(platform.accessories).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// discoverDevices
// ---------------------------------------------------------------------------

describe('AirmegaPlatform.discoverDevices', () => {
  let log: Logger;
  let api: ReturnType<typeof createMockAPI>;

  beforeEach(() => {
    log = createMockLogger();
    api = createMockAPI();
    mockLogin.mockClear();
    mockListDevices.mockClear();
    mockAirPurifierCtor.mockClear();
  });

  it('calls client.login() then client.listDevices()', async () => {
    const platform = new AirmegaPlatform(
      log,
      { platform: 'AirmegaPlatform', name: 'Airmega', username: 'u@test.com', password: 'pass' },
      api as unknown as API,
    );
    mockListDevices.mockResolvedValueOnce([] as never);
    await platform.discoverDevices();
    expect(mockLogin).toHaveBeenCalledTimes(1);
    expect(mockListDevices).toHaveBeenCalledTimes(1);
  });

  it('registers a new accessory for each discovered device', async () => {
    const platform = new AirmegaPlatform(
      log,
      { platform: 'AirmegaPlatform', name: 'Airmega', username: 'u@test.com', password: 'pass' },
      api as unknown as API,
    );
    mockListDevices.mockResolvedValueOnce([makeDevice()] as never);
    await platform.discoverDevices();
    expect(api.registerPlatformAccessories).toHaveBeenCalledWith(PLUGIN_NAME, PLATFORM_NAME, expect.any(Array));
    expect(mockAirPurifierCtor).toHaveBeenCalledTimes(1);
  });

  it('updates an existing accessory when UUID matches a cached one', async () => {
    const platform = new AirmegaPlatform(
      log,
      { platform: 'AirmegaPlatform', name: 'Airmega', username: 'u@test.com', password: 'pass' },
      api as unknown as API,
    );
    const device = makeDevice();
    const cachedAccessory = {
      displayName: 'Old Name',
      UUID: 'uuid-serial-abc', // matches uuid.generate('serial-abc')
      context: {} as Record<string, unknown>,
      getService: mock(() => ({
        setCharacteristic: mock(function() { return this; }),
        getCharacteristic: mock(() => ({
          onGet: mock(function() { return this; }),
          onSet: mock(function() { return this; }),
          setProps: mock(function() { return this; }),
        })),
        addOptionalCharacteristic: mock(() => {}),
        setPrimaryService: mock(() => {}),
        updateCharacteristic: mock(() => {}),
      })),
      getServiceById: mock(() => null),
      addService: mock(() => ({
        setCharacteristic: mock(function() { return this; }),
        getCharacteristic: mock(() => ({
          onGet: mock(function() { return this; }),
          onSet: mock(function() { return this; }),
          setProps: mock(function() { return this; }),
        })),
        addOptionalCharacteristic: mock(() => {}),
        setPrimaryService: mock(() => {}),
        updateCharacteristic: mock(() => {}),
      })),
      removeService: mock(() => {}),
    } as unknown as PlatformAccessory;

    platform.configureAccessory(cachedAccessory);
    mockListDevices.mockResolvedValueOnce([device] as never);
    await platform.discoverDevices();

    expect(api.updatePlatformAccessories).toHaveBeenCalledWith([cachedAccessory]);
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(mockAirPurifierCtor).toHaveBeenCalledTimes(1);
  });

  it('unregisters stale cached accessories no longer returned by listDevices', async () => {
    const platform = new AirmegaPlatform(
      log,
      { platform: 'AirmegaPlatform', name: 'Airmega', username: 'u@test.com', password: 'pass' },
      api as unknown as API,
    );
    const staleAccessory = {
      displayName: 'Gone',
      UUID: 'uuid-stale-device',
      context: {},
    } as unknown as PlatformAccessory;
    platform.configureAccessory(staleAccessory);

    mockListDevices.mockResolvedValueOnce([] as never); // device no longer returned
    await platform.discoverDevices();

    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(
      PLUGIN_NAME, PLATFORM_NAME, [staleAccessory],
    );
  });

  it('does nothing when configured=false (missing credentials)', async () => {
    const platform = new AirmegaPlatform(
      log,
      { platform: 'AirmegaPlatform', name: 'Airmega' } as never,
      api as unknown as API,
    );
    await platform.discoverDevices();
    expect(mockLogin).not.toHaveBeenCalled();
    expect(mockListDevices).not.toHaveBeenCalled();
  });
});
