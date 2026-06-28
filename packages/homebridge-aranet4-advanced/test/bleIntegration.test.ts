/**
 * Integration test harness for the BLE layer using mocked noble.
 *
 * These tests verify that the BleManager correctly:
 *  - Starts and stops scanning
 *  - Discovers Aranet4 devices by advertisement manufacturer data
 *  - Ignores non-Aranet4 devices
 *  - Invokes the reading callback on valid advertisement
 *  - Throttles readings based on polling interval
 *  - Warns when device has no manufacturer data
 */

import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Mock noble before importing BleManager
// ---------------------------------------------------------------------------

const mockNoble = new EventEmitter() as EventEmitter & {
  state: string;
  startScanning: jest.Mock;
  stopScanning: jest.Mock;
};
mockNoble.state = 'poweredOff';
mockNoble.startScanning = jest.fn((_uuids: string[], _dup: boolean, cb?: (err?: Error) => void) => {
  if (cb) {
    cb();
  }
});
mockNoble.stopScanning = jest.fn();

jest.mock('@stoprocent/noble', () => mockNoble);

import { BleManager } from '../src/bleManager';
import { Aranet4DeviceConfig, DEFAULT_POLLING_INTERVAL } from '../src/settings';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockLog: any = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

/**
 * Build a mock manufacturer data buffer matching the real Aranet4 layout:
 *   Bytes 0–1  : Company ID (0x0702)
 *   Bytes 2–9  : Header (flags, firmware version, device type, padding)
 *   Bytes 10–11: CO2 (uint16 LE)
 *   Bytes 12–13: Temperature raw (uint16 LE, ÷ 20 = °C)
 *   Bytes 14–15: Pressure raw (uint16 LE, ÷ 10 = hPa)
 *   Byte  16   : Humidity (uint8)
 *   Byte  17   : Battery (uint8)
 *   Byte  18   : Status (uint8)
 *   Bytes 19–20: Interval (uint16 LE)
 *   Bytes 21–22: Age (uint16 LE)
 */
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
  const tempRaw = opts.tempRaw ?? 440;       // 22.0°C
  const humidity = opts.humidity ?? 50;
  const battery = opts.battery ?? 90;
  const status = opts.status ?? 0;
  const pressureRaw = opts.pressureRaw ?? 10130; // 1013.0 hPa
  const interval = opts.interval ?? 60;
  const age = opts.age ?? 5;

  const buf = Buffer.alloc(23);
  buf.writeUInt16LE(0x0702, 0);           // Company ID
  // Bytes 2–9: header (zeros)
  buf.writeUInt16LE(co2, 10);             // CO2
  buf.writeUInt16LE(tempRaw, 12);         // Temperature raw
  buf.writeUInt16LE(pressureRaw, 14);     // Pressure raw
  buf.writeUInt8(humidity, 16);           // Humidity
  buf.writeUInt8(battery, 17);            // Battery
  buf.writeUInt8(status, 18);             // Status
  buf.writeUInt16LE(interval, 19);        // Interval
  buf.writeUInt16LE(age, 21);             // Age
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

describe('BleManager', () => {
  let manager: BleManager;
  const defaultConfig: Aranet4DeviceConfig = {
    name: 'Aranet4',
    pollingInterval: DEFAULT_POLLING_INTERVAL,
    co2AlertThreshold: 1000,
    lowBatteryThreshold: 15,
    enableHistory: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockNoble.state = 'poweredOff';
    mockNoble.removeAllListeners();
    manager = new BleManager(mockLog, [defaultConfig]);
  });

  afterEach(() => {
    manager.shutdown();
  });

  it('should start scanning when Bluetooth powers on', () => {
    manager.start();
    mockNoble.state = 'poweredOn';
    mockNoble.emit('stateChange', 'poweredOn');

    expect(mockNoble.startScanning).toHaveBeenCalledWith([], true, expect.any(Function));
  });

  it('should not scan when Bluetooth is powered off', () => {
    manager.start();
    mockNoble.emit('stateChange', 'poweredOff');

    expect(mockNoble.startScanning).not.toHaveBeenCalled();
  });

  it('should stop scanning on shutdown', () => {
    manager.start();
    mockNoble.state = 'poweredOn';
    mockNoble.emit('stateChange', 'poweredOn');
    manager.shutdown();

    expect(mockNoble.stopScanning).toHaveBeenCalled();
  });

  it('should discover Aranet4 devices by advertisement manufacturer data', () => {
    const readingCallback = jest.fn();
    manager.onReading(readingCallback);
    manager.start();

    mockNoble.state = 'poweredOn';
    mockNoble.emit('stateChange', 'poweredOn');

    const mfgData = buildMfgData({ co2: 650, humidity: 50, battery: 90 });
    const peripheral = createMockPeripheral('Aranet4 Home', 'aabbccddeeff', mfgData);
    mockNoble.emit('discover', peripheral);

    expect(readingCallback).toHaveBeenCalledWith(
      'aabbccddeeff',
      expect.objectContaining({
        co2: 650,
        humidity: 50,
        battery: 90,
      }),
    );
  });

  it('should ignore non-Aranet4 devices', () => {
    const readingCallback = jest.fn();
    manager.onReading(readingCallback);
    manager.start();

    mockNoble.state = 'poweredOn';
    mockNoble.emit('stateChange', 'poweredOn');

    // Different company ID
    const buf = Buffer.alloc(10);
    buf.writeUInt16LE(0x1234, 0); // Not SAF Tehnika
    const peripheral = createMockPeripheral('SomeOtherSensor', '112233445566', buf);
    mockNoble.emit('discover', peripheral);

    expect(readingCallback).not.toHaveBeenCalled();
  });

  it('should throttle readings based on polling interval', () => {
    const readingCallback = jest.fn();
    manager.onReading(readingCallback);
    manager.start();

    mockNoble.state = 'poweredOn';
    mockNoble.emit('stateChange', 'poweredOn');

    const mfgData = buildMfgData();
    const peripheral = createMockPeripheral('Aranet4 Home', 'aabbccddeeff', mfgData);

    // First advertisement — should emit
    mockNoble.emit('discover', peripheral);
    expect(readingCallback).toHaveBeenCalledTimes(1);

    // Immediate second advertisement — should be throttled
    mockNoble.emit('discover', peripheral);
    expect(readingCallback).toHaveBeenCalledTimes(1);
  });

  it('should warn when Aranet4 found by name but without manufacturer data', () => {
    manager.start();
    mockNoble.state = 'poweredOn';
    mockNoble.emit('stateChange', 'poweredOn');

    const peripheral = createMockPeripheral('Aranet4 Home', 'aabbccddeeff');
    mockNoble.emit('discover', peripheral);

    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Smart Home integrations'),
    );
  });

  it('should not warn again for the same device without manufacturer data', () => {
    manager.start();
    mockNoble.state = 'poweredOn';
    mockNoble.emit('stateChange', 'poweredOn');

    const peripheral = createMockPeripheral('Aranet4 Home', 'aabbccddeeff');
    mockNoble.emit('discover', peripheral);
    mockNoble.emit('discover', peripheral);

    // Only one warning, not two
    const warnCalls = mockLog.warn.mock.calls.filter(
      (c: string[]) => c[0]?.includes('Smart Home integrations'),
    );
    expect(warnCalls).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // Scan resilience
  // -----------------------------------------------------------------------

  it('should restart scanning after unexpected scanStop', () => {
    jest.useFakeTimers();
    manager.start();
    mockNoble.state = 'poweredOn';
    mockNoble.emit('stateChange', 'poweredOn');

    expect(mockNoble.startScanning).toHaveBeenCalledTimes(1);

    // Simulate unexpected scan stop
    mockNoble.emit('scanStop');

    // Should not restart immediately
    expect(mockNoble.startScanning).toHaveBeenCalledTimes(1);

    // After debounce delay, should restart
    jest.advanceTimersByTime(3000);
    expect(mockNoble.startScanning).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  it('should debounce rapid scanStop events', () => {
    jest.useFakeTimers();
    manager.start();
    mockNoble.state = 'poweredOn';
    mockNoble.emit('stateChange', 'poweredOn');

    // Rapid-fire scanStop events (noble issue #569)
    mockNoble.emit('scanStop');
    mockNoble.emit('scanStop');
    mockNoble.emit('scanStop');

    jest.advanceTimersByTime(3000);

    // Should only restart once, not three times
    expect(mockNoble.startScanning).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  it('should retry scan start on failure with backoff', () => {
    jest.useFakeTimers();

    // Make startScanning fail
    mockNoble.startScanning.mockImplementation(
      (_uuids: string[], _dup: boolean, cb?: (err?: Error) => void) => {
        if (cb) {
          cb(new Error('BLE adapter busy'));
        }
      },
    );

    manager.start();
    mockNoble.state = 'poweredOn';
    mockNoble.emit('stateChange', 'poweredOn');

    // First attempt fails
    expect(mockNoble.startScanning).toHaveBeenCalledTimes(1);
    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('BLE scan start failed'));

    // After 5s retry delay
    jest.advanceTimersByTime(5000);
    expect(mockNoble.startScanning).toHaveBeenCalledTimes(2);

    // After 10s (doubled backoff)
    jest.advanceTimersByTime(10000);
    expect(mockNoble.startScanning).toHaveBeenCalledTimes(3);

    jest.useRealTimers();
  });

  it('should log error on unauthorized Bluetooth state', () => {
    manager.start();
    mockNoble.emit('stateChange', 'unauthorized');

    expect(mockLog.error).toHaveBeenCalledWith(
      expect.stringContaining('Bluetooth access denied'),
    );
  });

  it('should only log unauthorized warning once', () => {
    manager.start();
    mockNoble.emit('stateChange', 'unauthorized');
    mockNoble.emit('stateChange', 'unauthorized');

    const errorCalls = mockLog.error.mock.calls.filter(
      (c: string[]) => c[0]?.includes('Bluetooth access denied'),
    );
    expect(errorCalls).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // Stale device detection
  // -----------------------------------------------------------------------

  it('should fire stale callback when device stops advertising', () => {
    jest.useFakeTimers();
    const staleCallback = jest.fn();
    manager.onStale(staleCallback);
    manager.start();

    mockNoble.state = 'poweredOn';
    mockNoble.emit('stateChange', 'poweredOn');

    // Discover a device
    const mfgData = buildMfgData();
    const peripheral = createMockPeripheral('Aranet4 Home', 'aabbccddeeff', mfgData);
    mockNoble.emit('discover', peripheral);

    // Advance past the stale threshold (pollingInterval × 5 = 300s)
    jest.advanceTimersByTime(6 * 60_000);

    expect(staleCallback).toHaveBeenCalledWith('aabbccddeeff');
  });

  it('should only fire stale callback once per device until it recovers', () => {
    jest.useFakeTimers();
    const staleCallback = jest.fn();
    manager.onStale(staleCallback);
    manager.start();

    mockNoble.state = 'poweredOn';
    mockNoble.emit('stateChange', 'poweredOn');

    const mfgData = buildMfgData();
    const peripheral = createMockPeripheral('Aranet4 Home', 'aabbccddeeff', mfgData);
    mockNoble.emit('discover', peripheral);

    // Go stale
    jest.advanceTimersByTime(6 * 60_000);
    expect(staleCallback).toHaveBeenCalledTimes(1);

    // More time passes — should not fire again
    jest.advanceTimersByTime(6 * 60_000);
    expect(staleCallback).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });
});
