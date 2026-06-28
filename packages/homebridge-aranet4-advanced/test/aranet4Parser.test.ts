import { parseExtendedReadings, parseAdvertisement } from '../src/aranet4Parser';

describe('parseExtendedReadings', () => {
  it('should parse a valid 13-byte extended readings buffer', () => {
    // Construct a known packet:
    //   CO2 = 850 ppm (0x0352)
    //   Temperature = 440 raw → 22.0°C (0x01B8)
    //   Pressure = 10130 raw → 1013.0 hPa (0x2792)
    //   Humidity = 55% (0x37)
    //   Battery = 92% (0x5C)
    //   Status = 0 (0x00)
    //   Interval = 60s (0x003C)
    //   Age = 15s (0x000F)
    const buf = Buffer.alloc(13);
    buf.writeUInt16LE(850, 0);    // CO2
    buf.writeUInt16LE(440, 2);    // Temperature raw
    buf.writeUInt16LE(10130, 4);  // Pressure raw
    buf.writeUInt8(55, 6);        // Humidity
    buf.writeUInt8(92, 7);        // Battery
    buf.writeUInt8(0, 8);         // Status
    buf.writeUInt16LE(60, 9);     // Interval
    buf.writeUInt16LE(15, 11);    // Age

    const reading = parseExtendedReadings(buf);

    expect(reading.co2).toBe(850);
    expect(reading.temperature).toBeCloseTo(22.0, 2);
    expect(reading.pressure).toBeCloseTo(1013.0, 1);
    expect(reading.humidity).toBe(55);
    expect(reading.battery).toBe(92);
    expect(reading.status).toBe(0);
    expect(reading.interval).toBe(60);
    expect(reading.age).toBe(15);
    expect(reading.timestamp).toBeGreaterThan(0);
  });

  it('should handle high CO2 values', () => {
    const buf = Buffer.alloc(13);
    buf.writeUInt16LE(5000, 0);   // Very high CO2
    buf.writeUInt16LE(500, 2);    // 25.0°C
    buf.writeUInt16LE(9800, 4);   // 980.0 hPa
    buf.writeUInt8(70, 6);
    buf.writeUInt8(50, 7);
    buf.writeUInt8(1, 8);
    buf.writeUInt16LE(120, 9);
    buf.writeUInt16LE(5, 11);

    const reading = parseExtendedReadings(buf);

    expect(reading.co2).toBe(5000);
    expect(reading.temperature).toBeCloseTo(25.0, 2);
    expect(reading.pressure).toBeCloseTo(980.0, 1);
    expect(reading.status).toBe(1);
  });

  it('should reject all-zero values as invalid sensor data (warmup / malfunction)', () => {
    const buf = Buffer.alloc(13, 0);

    expect(() => parseExtendedReadings(buf)).toThrow('Invalid sensor data');
    expect(() => parseExtendedReadings(buf)).toThrow('CO2 out of range: 0');
  });

  it('should reject maximum uint16 values as invalid sensor data', () => {
    const buf = Buffer.alloc(13);
    buf.writeUInt16LE(65535, 0);  // Max CO2 — out of plausible range
    buf.writeUInt16LE(65535, 2);  // Max temperature raw
    buf.writeUInt16LE(65535, 4);  // Max pressure raw
    buf.writeUInt8(255, 6);
    buf.writeUInt8(255, 7);
    buf.writeUInt8(255, 8);
    buf.writeUInt16LE(65535, 9);
    buf.writeUInt16LE(65535, 11);

    expect(() => parseExtendedReadings(buf)).toThrow('Invalid sensor data');
    expect(() => parseExtendedReadings(buf)).toThrow('CO2 out of range: 65535');
  });

  it('should accept readings at plausible boundary values', () => {
    const buf = Buffer.alloc(13);
    buf.writeUInt16LE(1, 0);       // CO2 = 1 ppm (minimum valid)
    buf.writeUInt16LE(0, 2);       // Temperature = 0°C
    buf.writeUInt16LE(3000, 4);    // Pressure = 300 hPa (minimum valid)
    buf.writeUInt8(0, 6);          // Humidity = 0%
    buf.writeUInt8(0, 7);          // Battery = 0%
    buf.writeUInt8(0, 8);          // Status
    buf.writeUInt16LE(60, 9);      // Interval = 60s
    buf.writeUInt16LE(5, 11);      // Age = 5s

    const reading = parseExtendedReadings(buf);
    expect(reading.co2).toBe(1);
    expect(reading.temperature).toBe(0);
    expect(reading.pressure).toBe(300);
    expect(reading.humidity).toBe(0);
  });

  it('should throw for a buffer shorter than 13 bytes', () => {
    const buf = Buffer.alloc(12);

    expect(() => parseExtendedReadings(buf)).toThrow('Expected at least 13 bytes');
  });

  it('should throw for an empty buffer', () => {
    const buf = Buffer.alloc(0);

    expect(() => parseExtendedReadings(buf)).toThrow('Expected at least 13 bytes');
  });

  it('should accept buffers longer than 13 bytes (ignoring extra)', () => {
    const buf = Buffer.alloc(20);
    buf.writeUInt16LE(400, 0);
    buf.writeUInt16LE(400, 2);  // 20.0°C
    buf.writeUInt16LE(10130, 4);
    buf.writeUInt8(50, 6);
    buf.writeUInt8(80, 7);
    buf.writeUInt8(0, 8);
    buf.writeUInt16LE(60, 9);
    buf.writeUInt16LE(0, 11);

    const reading = parseExtendedReadings(buf);

    expect(reading.co2).toBe(400);
    expect(reading.temperature).toBeCloseTo(20.0, 2);
  });

  it('should parse realistic sensor values from a real Aranet4', () => {
    // Simulate: CO2=623, Temp=21.35°C (427 raw), Pressure=1018.7 hPa (10187),
    // Humidity=42%, Battery=87%, Status=0, Interval=60, Age=32
    const buf = Buffer.alloc(13);
    buf.writeUInt16LE(623, 0);
    buf.writeUInt16LE(427, 2);
    buf.writeUInt16LE(10187, 4);
    buf.writeUInt8(42, 6);
    buf.writeUInt8(87, 7);
    buf.writeUInt8(0, 8);
    buf.writeUInt16LE(60, 9);
    buf.writeUInt16LE(32, 11);

    const reading = parseExtendedReadings(buf);

    expect(reading.co2).toBe(623);
    expect(reading.temperature).toBeCloseTo(21.35, 2);
    expect(reading.pressure).toBeCloseTo(1018.7, 1);
    expect(reading.humidity).toBe(42);
    expect(reading.battery).toBe(87);
    expect(reading.interval).toBe(60);
    expect(reading.age).toBe(32);
  });
});

describe('parseAdvertisement', () => {
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
    companyId?: number;
    co2?: number;
    tempRaw?: number;
    humidity?: number;
    battery?: number;
    status?: number;
    pressureRaw?: number;
    interval?: number;
    age?: number;
  } = {}): Buffer {
    const buf = Buffer.alloc(23);
    buf.writeUInt16LE(opts.companyId ?? 0x0702, 0);  // Company ID
    // Bytes 2–9: header (zeros — flags, version, device type)
    buf.writeUInt16LE(opts.co2 ?? 650, 10);           // CO2
    buf.writeUInt16LE(opts.tempRaw ?? 440, 12);       // Temperature raw
    buf.writeUInt16LE(opts.pressureRaw ?? 10130, 14); // Pressure raw
    buf.writeUInt8(opts.humidity ?? 50, 16);           // Humidity
    buf.writeUInt8(opts.battery ?? 90, 17);            // Battery
    buf.writeUInt8(opts.status ?? 0, 18);              // Status
    buf.writeUInt16LE(opts.interval ?? 60, 19);        // Interval
    buf.writeUInt16LE(opts.age ?? 5, 21);              // Age
    return buf;
  }

  it('should parse valid manufacturer data', () => {
    const buf = buildMfgData({ co2: 800, tempRaw: 500, humidity: 45, battery: 85 });
    const reading = parseAdvertisement(buf);

    expect(reading).not.toBeNull();
    expect(reading!.co2).toBe(800);
    expect(reading!.temperature).toBeCloseTo(25.0, 2);
    expect(reading!.humidity).toBe(45);
    expect(reading!.battery).toBe(85);
  });

  it('should return null for buffers too short', () => {
    // 13 bytes is too short — need at least 14 (company ID + 8 header + 2 CO2 + 2 temp)
    const buf = Buffer.alloc(13);
    expect(parseAdvertisement(buf)).toBeNull();
  });

  it('should return null for invalid sensor data (all zeros)', () => {
    const buf = buildMfgData({ co2: 0, tempRaw: 0, humidity: 0, battery: 0 });
    expect(parseAdvertisement(buf)).toBeNull();
  });

  it('should handle shorter advertisements without pressure/humidity/battery', () => {
    // Company ID (2) + header (8) + CO2 (2) + temp (2) = 14 bytes
    // This is the minimum parseable buffer — no pressure, humidity, or battery
    const buf = Buffer.alloc(14);
    buf.writeUInt16LE(0x0702, 0);
    buf.writeUInt16LE(500, 10);  // CO2 at payload offset 8
    buf.writeUInt16LE(440, 12);  // Temperature at payload offset 10

    const reading = parseAdvertisement(buf);
    expect(reading).not.toBeNull();
    expect(reading!.co2).toBe(500);
    expect(reading!.temperature).toBeCloseTo(22.0, 2);
    expect(reading!.pressure).toBe(0);
    expect(reading!.humidity).toBe(0);
    expect(reading!.battery).toBe(0);
  });
});

