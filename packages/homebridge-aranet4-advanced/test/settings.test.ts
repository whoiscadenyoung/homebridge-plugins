import {
  PLATFORM_NAME,
  PLUGIN_NAME,
  ARANET4_SERVICE_UUID,
  charUUID,
  CHAR_EXTENDED_READINGS,
  CHAR_TOTAL_READINGS,
  CHAR_READ_INTERVAL,
  ARANET4_NAME_PREFIX,
  DEFAULT_POLLING_INTERVAL,
  DEFAULT_CO2_ALERT_THRESHOLD,
  DEFAULT_LOW_BATTERY_THRESHOLD,
} from '../src/settings';

describe('settings constants', () => {
  it('should have correct platform and plugin names', () => {
    expect(PLATFORM_NAME).toBe('Aranet4');
    expect(PLUGIN_NAME).toBe('homebridge-aranet4-advanced');
  });

  it('should have a valid Aranet4 BLE service UUID', () => {
    expect(ARANET4_SERVICE_UUID).toBe('0000fce0-0000-1000-8000-00805f9b34fb');
    expect(ARANET4_SERVICE_UUID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('charUUID should build valid 128-bit UUIDs', () => {
    const uuid = charUUID('3001');
    expect(uuid).toBe('f0cd3001-95da-4f4b-9ac8-aa55d312af0c');
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('should define all expected characteristic UUIDs', () => {
    expect(CHAR_EXTENDED_READINGS).toBe('f0cd3001-95da-4f4b-9ac8-aa55d312af0c');
    expect(CHAR_TOTAL_READINGS).toBe('f0cd2001-95da-4f4b-9ac8-aa55d312af0c');
    expect(CHAR_READ_INTERVAL).toBe('f0cd2002-95da-4f4b-9ac8-aa55d312af0c');
  });

  it('should have correct default config values', () => {
    expect(ARANET4_NAME_PREFIX).toBe('Aranet4');
    expect(DEFAULT_POLLING_INTERVAL).toBe(60);
    expect(DEFAULT_CO2_ALERT_THRESHOLD).toBe(1000);
    expect(DEFAULT_LOW_BATTERY_THRESHOLD).toBe(15);
  });

  it('polling interval minimum should be sane', () => {
    expect(DEFAULT_POLLING_INTERVAL).toBeGreaterThanOrEqual(60);
  });
});
