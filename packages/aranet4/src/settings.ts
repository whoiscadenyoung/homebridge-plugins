/**
 * Platform name — must match the "pluginAlias" in config.schema.json.
 */
export const PLATFORM_NAME = 'Aranet4';

/**
 * Plugin name — must match the "name" field in package.json.
 */
export const PLUGIN_NAME = 'homebridge-aranet4-advanced';

// ---------------------------------------------------------------------------
// Aranet4 BLE Protocol Constants
// ---------------------------------------------------------------------------

/** Primary Aranet4 BLE service UUID. */
export const ARANET4_SERVICE_UUID = '0000fce0-0000-1000-8000-00805f9b34fb';

/** Characteristic UUID base pattern (replace XXXX with suffix). */
const CHAR_BASE = 'f0cd';
const CHAR_SUFFIX = '-95da-4f4b-9ac8-aa55d312af0c';

/** Build a full 128-bit characteristic UUID from a 4-hex suffix. */
export function charUUID(suffix: string): string {
  return `${CHAR_BASE}${suffix}${CHAR_SUFFIX}`;
}

/** Extended readings characteristic — 13-byte sensor snapshot. */
export const CHAR_EXTENDED_READINGS = charUUID('3001');

/** Measurement interval characteristic. */
export const CHAR_READ_INTERVAL = charUUID('2002');

/** Total stored readings count. */
export const CHAR_TOTAL_READINGS = charUUID('2001');

// ---------------------------------------------------------------------------
// Aranet4 BLE advertisement name prefix used for discovery.
// ---------------------------------------------------------------------------
export const ARANET4_NAME_PREFIX = 'Aranet4';

// ---------------------------------------------------------------------------
// Default configuration values
// ---------------------------------------------------------------------------
export const DEFAULT_POLLING_INTERVAL = 60;    // seconds
export const DEFAULT_CO2_ALERT_THRESHOLD = 1000; // ppm
export const DEFAULT_LOW_BATTERY_THRESHOLD = 15; // percent

/**
 * How many polling intervals without data before marking a sensor as stale.
 * E.g. with 60s polling and multiplier 5, sensor goes stale after 5 minutes.
 */
export const STALE_THRESHOLD_MULTIPLIER = 5;

// ---------------------------------------------------------------------------
// CO2 → HomeKit AirQuality mapping thresholds
// ---------------------------------------------------------------------------
export const AIR_QUALITY_THRESHOLDS = {
  EXCELLENT: 600,
  GOOD: 800,
  FAIR: 1000,
  INFERIOR: 1500,
  // Above 1500 → POOR (worst)
} as const;

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

/** Parsed sensor readings from the 13-byte extended readings packet. */
export interface Aranet4Reading {
  co2: number;          // ppm
  temperature: number;  // °C
  pressure: number;     // hPa
  humidity: number;     // %
  battery: number;      // %
  status: number;       // device status byte
  interval: number;     // seconds between readings
  age: number;          // seconds since last measurement
  timestamp: number;    // Unix timestamp (ms) when this reading was received
}

/** Per-device configuration from config.json. */
export interface Aranet4DeviceConfig {
  name: string;
  address?: string;
  pollingInterval: number;
  co2AlertThreshold: number;
  lowBatteryThreshold: number;
  enableHistory: boolean;
}

/** Top-level platform configuration. */
export interface Aranet4PlatformConfig {
  platform: string;
  name: string;
  devices?: Aranet4DeviceConfig[];
  mqttBroker?: string;
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/** Normalize a MAC address / peripheral ID to lowercase hex without separators. */
export function normalizeAddress(addr: string): string {
  return addr.toLowerCase().replace(/[:-]/g, '');
}

