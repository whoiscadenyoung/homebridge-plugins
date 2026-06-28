import { Aranet4Reading } from './settings';

// ---------------------------------------------------------------------------
// Plausible sensor value ranges for sanity checking.
// Values outside these ranges indicate sensor warmup, malfunction, or bad data.
// ---------------------------------------------------------------------------

/** CO2 0 or 65535 = sensor warmup / invalid. Valid range: 0–10000 ppm. */
const CO2_MIN = 1;
const CO2_MAX = 10_000;

/** Temperature valid range: −40 °C to +60 °C (Aranet4 spec: 0–50 °C). */
const TEMP_MIN = -40;
const TEMP_MAX = 60;

/** Humidity valid range: 0–100 %. */
const HUMIDITY_MAX = 100;

/** Pressure valid range: 300–1200 hPa (covers Dead Sea to Everest). */
const PRESSURE_MIN = 300;
const PRESSURE_MAX = 1200;

/**
 * Validate parsed sensor values. Returns a human-readable reason string
 * if the reading should be rejected, or null if it looks valid.
 */
export function validateReading(reading: {
  co2: number;
  temperature: number;
  pressure: number;
  humidity: number;
  battery: number;
}): string | null {
  if (reading.co2 < CO2_MIN || reading.co2 > CO2_MAX) {
    return `CO2 out of range: ${reading.co2} ppm`;
  }
  if (reading.temperature < TEMP_MIN || reading.temperature > TEMP_MAX) {
    return `Temperature out of range: ${reading.temperature} °C`;
  }
  if (reading.humidity > HUMIDITY_MAX) {
    return `Humidity out of range: ${reading.humidity}%`;
  }
  if (reading.pressure !== 0 && (reading.pressure < PRESSURE_MIN || reading.pressure > PRESSURE_MAX)) {
    return `Pressure out of range: ${reading.pressure} hPa`;
  }
  if (reading.battery > 100) {
    return `Battery out of range: ${reading.battery}%`;
  }
  return null;
}

/**
 * Parse a 13-byte extended readings buffer from the Aranet4 BLE characteristic
 * (UUID suffix 3001) into a typed Aranet4Reading.
 *
 * Packet layout (little-endian):
 *   Offset 0–1  : uint16  CO2 (ppm, raw)
 *   Offset 2–3  : uint16  Temperature (raw ÷ 20 = °C)
 *   Offset 4–5  : uint16  Pressure (raw ÷ 10 = hPa)
 *   Offset 6    : uint8   Humidity (%, raw)
 *   Offset 7    : uint8   Battery (%, raw)
 *   Offset 8    : uint8   Status byte
 *   Offset 9–10 : uint16  Interval (seconds)
 *   Offset 11–12: uint16  Age (seconds since last measurement)
 */
export function parseExtendedReadings(buf: Buffer): Aranet4Reading {
  if (buf.length < 13) {
    throw new Error(`Expected at least 13 bytes for extended readings, got ${buf.length}`);
  }

  const co2 = buf.readUInt16LE(0);
  const temperatureRaw = buf.readUInt16LE(2);
  const pressureRaw = buf.readUInt16LE(4);
  const humidity = buf.readUInt8(6);
  const battery = buf.readUInt8(7);
  const status = buf.readUInt8(8);
  const interval = buf.readUInt16LE(9);
  const age = buf.readUInt16LE(11);

  const reading: Aranet4Reading = {
    co2,
    temperature: temperatureRaw / 20,
    pressure: pressureRaw / 10,
    humidity,
    battery,
    status,
    interval,
    age,
    timestamp: Date.now(),
  };

  const invalid = validateReading(reading);
  if (invalid) {
    throw new Error(`Invalid sensor data: ${invalid}`);
  }

  return reading;
}

/**
 * Parse Aranet4 manufacturer-specific advertisement data.
 *
 * When "Smart Home integrations" is enabled in the Aranet4 Home app, the
 * device includes sensor data in its BLE advertisement manufacturer data.
 *
 * The manufacturer data starts with a 2-byte company ID (0x0702 for SAF
 * Tehnika), followed by the payload.  Noble includes this company ID prefix
 * in the buffer.
 *
 * Payload layout (little-endian, after 2-byte company ID):
 *   Byte  0      : uint8   Flags (bit 5 = integrations enabled)
 *   Byte  1–3    : uint8×3 Firmware version (patch, minor, major)
 *   Byte  4–5    : uint16  Device type / padding
 *   Byte  6–7    : uint16  Additional header
 *   Byte  8–9    : uint16  CO2 (ppm)
 *   Byte  10–11  : uint16  Temperature (raw ÷ 20 = °C)
 *   Byte  12–13  : uint16  Pressure (raw ÷ 10 = hPa)
 *   Byte  14     : uint8   Humidity (%)
 *   Byte  15     : uint8   Battery (%)
 *   Byte  16     : uint8   Status flags
 *   Byte  17–18  : uint16  Interval (seconds)
 *   Byte  19–20  : uint16  Age (seconds since last measurement)
 *
 * Reference: https://github.com/Anrijs/Aranet4-Python
 *            https://github.com/Anrijs/Aranet4-ESP32
 *
 * Returns null if the buffer doesn't contain valid Aranet4 data.
 */
export function parseAdvertisement(manufacturerData: Buffer): Aranet4Reading | null {
  // Company ID (2) + header (8) + CO2 (2) + temperature (2) = 14 bytes minimum
  if (manufacturerData.length < 14) {
    return null;
  }

  // Skip 2-byte company ID — remaining bytes are the payload
  const d = manufacturerData.subarray(2);

  // Need at least 12 bytes: 8-byte header + CO2 (2) + temperature (2)
  if (d.length < 12) {
    return null;
  }

  // Sensor data starts at byte 8, after the 8-byte header
  const co2 = d.readUInt16LE(8);
  const temperatureRaw = d.readUInt16LE(10);

  // Remaining fields may not be present in shorter advertisements
  const pressure = d.length >= 14 ? d.readUInt16LE(12) / 10 : 0;
  const humidity = d.length >= 15 ? d.readUInt8(14) : 0;
  const battery = d.length >= 16 ? d.readUInt8(15) : 0;
  const status = d.length >= 17 ? d.readUInt8(16) : 0;
  const interval = d.length >= 19 ? d.readUInt16LE(17) : 0;
  const age = d.length >= 21 ? d.readUInt16LE(19) : 0;

  const reading: Aranet4Reading = {
    co2,
    temperature: temperatureRaw / 20,
    pressure,
    humidity,
    battery,
    status,
    interval,
    age,
    timestamp: Date.now(),
  };

  const invalid = validateReading(reading);
  if (invalid) {
    return null; // Silently skip — advertisements can contain stale/warmup data
  }

  return reading;
}

