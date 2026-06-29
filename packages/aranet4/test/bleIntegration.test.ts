import { mock, jest, describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { Mock } from 'bun:test';
import { EventEmitter } from 'events';
import { DEFAULT_POLLING_INTERVAL } from '../src/settings.js';
import type { Aranet4DeviceConfig } from '../src/settings.js';

// ---------------------------------------------------------------------------
// Noble mock
// ---------------------------------------------------------------------------

// noble is set inside the module factory so it exists before BleManager loads it
let noble: EventEmitter & {
  state: string;
  startScanning: Mock;
  stopScanning: Mock;
};

mock.module('@stoprocent/noble', () => {
  noble = Object.assign(new EventEmitter(), {
    state: 'poweredOff',
    startScanning: mock((_uuids: string[], _dup: boolean, cb?: (err?: Error) => void) => {
      if (cb) cb();
    }),
    stopScanning: mock(),
  });
  return { default: noble };
});

// Dynamic import so bleManager picks up the mock above
const { BleManager } = await import('../src/bleManager.js');

// ---------------------------------------------------------------------------
// Shared mock log
// ---------------------------------------------------------------------------

const mockLog = {
  info: mock(),
  warn: mock(),
  error: mock(),
  debug: mock(),
};

// ---------------------------------------------------------------------------
// Buffer helpers
// ---------------------------------------------------------------------------

function buildMfgData(opts: {
  co2?: number;
  tempRaw?: number;
  humidity?: number;
  battery?: number;
  status?: number;
  pressureRaw?: number;
  interval?: number;
  age?: number;
} = {}): Buffer {
  const co2 = opts.co2 ?? 650;
  const tempRaw = opts.tempRaw ?? 440;
  const humidity = opts.humidity ?? 50;
  const battery = opts.battery ?? 90;
  const status = opts.status ?? 0;
  const pressureRaw = opts.pressureRaw ?? 10130;
  const interval = opts.interval ?? 60;
  const age = opts.age ?? 5;

  const buf = Buffer.alloc(23);
  buf.writeUInt16LE(0x0702, 0);
  buf.writeUInt16LE(co2, 10);
  buf.writeUInt16LE(tempRaw, 12);
  buf.writeUInt16LE(pressureRaw, 14);
  buf.writeUInt8(humidity, 16);
  buf.writeUInt8(battery, 17);
  buf.writeUInt8(status, 18);
  buf.writeUInt16LE(interval, 19);
  buf.writeUInt16LE(age, 21);
  return buf;
}

function createMockPeripheral(name: string, id: string, mfgData?: Buffer) {
  return {
    id,
    uuid: id,
    advertisement: {
      localName: name,
      manufacturerData: mfgData ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BleManager', () => {
  let manager: InstanceType<typeof BleManager>;
  const defaultConfig: Aranet4DeviceConfig = {
    name: 'Aranet4',
    pollingInterval: DEFAULT_POLLING_INTERVAL,
    co2AlertThreshold: 1000,
    lowBatteryThreshold: 15,
    enableHistory: true,
  };

  beforeEach(() => {
    // Reset noble to default state and clear call history
    noble.state = 'poweredOff';
    noble.removeAllListeners();
    noble.startScanning.mockClear();
    noble.startScanning.mockImplementation((_uuids: string[], _dup: boolean, cb?: (err?: Error) => void) => {
      if (cb) cb();
    });
    noble.stopScanning.mockClear();
    mockLog.info.mockClear();
    mockLog.warn.mockClear();
    mockLog.error.mockClear();
    mockLog.debug.mockClear();

    manager = new BleManager(mockLog, [defaultConfig]);
  });

  afterEach(() => {
    manager.shutdown();
  });

  it('should start scanning when Bluetooth powers on', () => {
    manager.start();
    noble.state = 'poweredOn';
    noble.emit('stateChange', 'poweredOn');

    expect(noble.startScanning).toHaveBeenCalledWith([], true, expect.any(Function));
  });

  it('should not scan when Bluetooth is powered off', () => {
    manager.start();
    noble.emit('stateChange', 'poweredOff');

    expect(noble.startScanning).not.toHaveBeenCalled();
  });

  it('should stop scanning on shutdown', () => {
    manager.start();
    noble.state = 'poweredOn';
    noble.emit('stateChange', 'poweredOn');
    manager.shutdown();

    expect(noble.stopScanning).toHaveBeenCalled();
  });

  it('should discover Aranet4 devices by advertisement manufacturer data', () => {
    const readingCallback = mock();
    manager.onReading(readingCallback);
    manager.start();

    noble.state = 'poweredOn';
    noble.emit('stateChange', 'poweredOn');

    const mfgData = buildMfgData({ co2: 650, humidity: 50, battery: 90 });
    const peripheral = createMockPeripheral('Aranet4 Home', 'aabbccddeeff', mfgData);
    noble.emit('discover', peripheral);

    expect(readingCallback).toHaveBeenCalledWith(
      'aabbccddeeff',
      expect.objectContaining({ co2: 650, humidity: 50, battery: 90 }),
    );
  });

  it('should ignore non-Aranet4 devices', () => {
    const readingCallback = mock();
    manager.onReading(readingCallback);
    manager.start();

    noble.state = 'poweredOn';
    noble.emit('stateChange', 'poweredOn');

    const buf = Buffer.alloc(10);
    buf.writeUInt16LE(0x1234, 0);
    noble.emit('discover', createMockPeripheral('SomeOtherSensor', '112233445566', buf));

    expect(readingCallback).not.toHaveBeenCalled();
  });

  it('should throttle readings based on polling interval', () => {
    const readingCallback = mock();
    manager.onReading(readingCallback);
    manager.start();

    noble.state = 'poweredOn';
    noble.emit('stateChange', 'poweredOn');

    const peripheral = createMockPeripheral('Aranet4 Home', 'aabbccddeeff', buildMfgData());
    noble.emit('discover', peripheral);
    expect(readingCallback).toHaveBeenCalledTimes(1);

    noble.emit('discover', peripheral);
    expect(readingCallback).toHaveBeenCalledTimes(1);
  });

  it('should warn when Aranet4 found by name but without manufacturer data', () => {
    manager.start();
    noble.state = 'poweredOn';
    noble.emit('stateChange', 'poweredOn');

    noble.emit('discover', createMockPeripheral('Aranet4 Home', 'aabbccddeeff'));

    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Smart Home integrations'),
    );
  });

  it('should not warn again for the same device without manufacturer data', () => {
    manager.start();
    noble.state = 'poweredOn';
    noble.emit('stateChange', 'poweredOn');

    const peripheral = createMockPeripheral('Aranet4 Home', 'aabbccddeeff');
    noble.emit('discover', peripheral);
    noble.emit('discover', peripheral);

    const warnCalls = mockLog.warn.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('Smart Home integrations'),
    );
    expect(warnCalls).toHaveLength(1);
  });

  it('should restart scanning after unexpected scanStop', () => {
    jest.useFakeTimers();
    manager.start();
    noble.state = 'poweredOn';
    noble.emit('stateChange', 'poweredOn');

    expect(noble.startScanning).toHaveBeenCalledTimes(1);

    noble.emit('scanStop');
    expect(noble.startScanning).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(3000);
    expect(noble.startScanning).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  it('should debounce rapid scanStop events', () => {
    jest.useFakeTimers();
    manager.start();
    noble.state = 'poweredOn';
    noble.emit('stateChange', 'poweredOn');

    noble.emit('scanStop');
    noble.emit('scanStop');
    noble.emit('scanStop');

    jest.advanceTimersByTime(3000);
    expect(noble.startScanning).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  it('should retry scan start on failure with backoff', () => {
    jest.useFakeTimers();

    noble.startScanning.mockImplementation(
      (_uuids: string[], _dup: boolean, cb?: (err?: Error) => void) => {
        if (cb) cb(new Error('BLE adapter busy'));
      },
    );

    manager.start();
    noble.state = 'poweredOn';
    noble.emit('stateChange', 'poweredOn');

    expect(noble.startScanning).toHaveBeenCalledTimes(1);
    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('BLE scan start failed'));

    jest.advanceTimersByTime(5000);
    expect(noble.startScanning).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(10000);
    expect(noble.startScanning).toHaveBeenCalledTimes(3);

    jest.useRealTimers();
  });

  it('should log error on unauthorized Bluetooth state', () => {
    manager.start();
    noble.emit('stateChange', 'unauthorized');

    expect(mockLog.error).toHaveBeenCalledWith(
      expect.stringContaining('Bluetooth access denied'),
    );
  });

  it('should only log unauthorized warning once', () => {
    manager.start();
    noble.emit('stateChange', 'unauthorized');
    noble.emit('stateChange', 'unauthorized');

    const errorCalls = mockLog.error.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('Bluetooth access denied'),
    );
    expect(errorCalls).toHaveLength(1);
  });

  it('should fire stale callback when device stops advertising', () => {
    jest.useFakeTimers();
    const staleCallback = mock();
    manager.onStale(staleCallback);
    manager.start();

    noble.state = 'poweredOn';
    noble.emit('stateChange', 'poweredOn');

    noble.emit('discover', createMockPeripheral('Aranet4 Home', 'aabbccddeeff', buildMfgData()));
    jest.advanceTimersByTime(6 * 60_000);

    expect(staleCallback).toHaveBeenCalledWith('aabbccddeeff');

    jest.useRealTimers();
  });

  it('should only fire stale callback once per device until it recovers', () => {
    jest.useFakeTimers();
    const staleCallback = mock();
    manager.onStale(staleCallback);
    manager.start();

    noble.state = 'poweredOn';
    noble.emit('stateChange', 'poweredOn');

    noble.emit('discover', createMockPeripheral('Aranet4 Home', 'aabbccddeeff', buildMfgData()));
    jest.advanceTimersByTime(6 * 60_000);
    expect(staleCallback).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(6 * 60_000);
    expect(staleCallback).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });
});
