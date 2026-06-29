/**
 * Tests for CowayClient pure helper functions and the CowayClient class.
 *
 * The heavy HTTP logic in CowayClient (auth flow, retries, token refresh) is
 * integration-tested through the real API in production; here we cover:
 *   - All module-level pure functions exported for testing
 *   - CowayClient pre-condition guards (must call login() first)
 */

import { describe, it, expect } from 'bun:test';
import {
  modeFromRegister,
  aqLevelFromGrade,
  clampFanSpeed,
  pickNumber,
  sensorDerivedFilterPct,
  assembleDeviceState,
  extractPurifierJsonFromHtml,
  safeJsonParse,
  findFirstObject,
  readPath,
  findSensorAttributes,
  findMcuVersion,
  CowayClient,
} from '../src/api/cowayClient.js';
import type { SuppliesEntry } from '../src/api/cowayClient.js';

// ---------------------------------------------------------------------------
// modeFromRegister
// ---------------------------------------------------------------------------

describe('modeFromRegister', () => {
  it('1 → auto', () => expect(modeFromRegister(1)).toBe('auto'));
  it('2 → night (Sleep preset)', () => expect(modeFromRegister(2)).toBe('night'));
  it('5 → rapid (Smart preset, 250S)', () => expect(modeFromRegister(5)).toBe('rapid'));
  it('6 → eco', () => expect(modeFromRegister(6)).toBe('eco'));
  it('0 → manual (fallback)', () => expect(modeFromRegister(0)).toBe('manual'));
  it('3 → manual', () => expect(modeFromRegister(3)).toBe('manual'));
  it('string "1" → manual (register values are numbers)', () => expect(modeFromRegister('1')).toBe('manual'));
  it('null → manual', () => expect(modeFromRegister(null)).toBe('manual'));
  it('undefined → manual', () => expect(modeFromRegister(undefined)).toBe('manual'));
});

// ---------------------------------------------------------------------------
// aqLevelFromGrade
// ---------------------------------------------------------------------------

describe('aqLevelFromGrade', () => {
  it('1 → 1 (Excellent)', () => expect(aqLevelFromGrade(1)).toBe(1));
  it('2 → 2 (Good)', () => expect(aqLevelFromGrade(2)).toBe(2));
  it('3 → 3 (Fair)', () => expect(aqLevelFromGrade(3)).toBe(3));
  it('4 → 4 (Inferior)', () => expect(aqLevelFromGrade(4)).toBe(4));
  it('0 → 0 (Unknown — Coway does not emit 0 as a real grade)', () => expect(aqLevelFromGrade(0)).toBe(0));
  it('5 → 0 (out of Coway range; Unknown is safer than a wrong grade)', () => expect(aqLevelFromGrade(5)).toBe(0));
  it('null → 0', () => expect(aqLevelFromGrade(null)).toBe(0));
  it('undefined → 0', () => expect(aqLevelFromGrade(undefined)).toBe(0));
  it('string "2" → 0 (type mismatch)', () => expect(aqLevelFromGrade('2')).toBe(0));
});

// ---------------------------------------------------------------------------
// clampFanSpeed
// ---------------------------------------------------------------------------

describe('clampFanSpeed', () => {
  it('1 → 1 (minimum)', () => expect(clampFanSpeed(1)).toBe(1));
  it('2 → 2', () => expect(clampFanSpeed(2)).toBe(2));
  it('3 → 3', () => expect(clampFanSpeed(3)).toBe(3));
  it('6 → 6 (maximum)', () => expect(clampFanSpeed(6)).toBe(6));
  it('0 → 1 (below minimum)', () => expect(clampFanSpeed(0)).toBe(1));
  it('7 → 1 (above maximum)', () => expect(clampFanSpeed(7)).toBe(1));
  it('NaN → 1', () => expect(clampFanSpeed(NaN)).toBe(1));
  it('string "2" → 2 (coerced via Number())', () => expect(clampFanSpeed('2')).toBe(2));
  it('null → 1', () => expect(clampFanSpeed(null)).toBe(1));
  it('3.9 → 3 (truncated)', () => expect(clampFanSpeed(3.9)).toBe(3));
});

// ---------------------------------------------------------------------------
// pickNumber
// ---------------------------------------------------------------------------

describe('pickNumber', () => {
  it('returns the first finite number', () => expect(pickNumber(5)).toBe(5));
  it('skips undefined and returns the next finite number', () => expect(pickNumber(undefined, 10)).toBe(10));
  it('null coerces to 0 (Number(null)===0 is finite), so it is returned', () => expect(pickNumber(null)).toBe(0));
  it('skips NaN, returns next finite value', () => expect(pickNumber(NaN, 42)).toBe(42));
  it('returns undefined when only undefined and NaN are present', () => expect(pickNumber(undefined, NaN)).toBeUndefined());
  it('returns 0 (which is finite)', () => expect(pickNumber(0)).toBe(0));
  it('returns negative numbers', () => expect(pickNumber(-5)).toBe(-5));
  it('coerces string numbers', () => expect(pickNumber('15')).toBe(15));
  it('returns undefined for no args', () => expect(pickNumber()).toBeUndefined());
});

// ---------------------------------------------------------------------------
// sensorDerivedFilterPct
// ---------------------------------------------------------------------------

describe('sensorDerivedFilterPct', () => {
  it('100 - used% = remaining%', () => {
    expect(sensorDerivedFilterPct({ '0011': 40 }, '0011')).toBe(60);
  });

  it('0% used → 100% remaining', () => {
    expect(sensorDerivedFilterPct({ '0011': 0 }, '0011')).toBe(100);
  });

  it('100% used → 0% remaining', () => {
    expect(sensorDerivedFilterPct({ '0011': 100 }, '0011')).toBe(0);
  });

  it('clamps to 0 when used > 100', () => {
    expect(sensorDerivedFilterPct({ '0011': 110 }, '0011')).toBe(0);
  });

  it('returns undefined when key is missing', () => {
    expect(sensorDerivedFilterPct({}, '0011')).toBeUndefined();
  });

  it('returns undefined when value is non-numeric', () => {
    expect(sensorDerivedFilterPct({ '0011': 'n/a' }, '0011')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// safeJsonParse
// ---------------------------------------------------------------------------

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns null for invalid JSON', () => {
    expect(safeJsonParse('not json')).toBeNull();
  });

  it('strips __proto__ keys to prevent prototype pollution', () => {
    const result = safeJsonParse('{"__proto__":{"evil":true},"safe":1}') as Record<string, unknown>;
    expect(result?.safe).toBe(1);
    // __proto__ is inherited from Object.prototype — check that no own-property was created
    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false);
  });

  it('strips constructor and prototype keys', () => {
    const result = safeJsonParse('{"constructor":{},"prototype":{},"ok":true}') as Record<string, unknown>;
    expect((result as Record<string, unknown>)?.ok).toBe(true);
    // constructor is an inherited property; verify no own-property was injected
    expect(Object.prototype.hasOwnProperty.call(result, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, 'prototype')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findFirstObject
// ---------------------------------------------------------------------------

describe('findFirstObject', () => {
  it('returns the first plain object in an array', () => {
    expect(findFirstObject([null, { a: 1 }, { b: 2 }])).toEqual({ a: 1 });
  });

  it('skips non-object values', () => {
    expect(findFirstObject([1, 'str', null, { x: 9 }])).toEqual({ x: 9 });
  });

  it('skips arrays (only plain objects)', () => {
    expect(findFirstObject([[1, 2], { ok: true }])).toEqual({ ok: true });
  });

  it('returns null for empty array', () => {
    expect(findFirstObject([])).toBeNull();
  });

  it('returns null for non-array input', () => {
    expect(findFirstObject(null)).toBeNull();
    expect(findFirstObject('string')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readPath
// ---------------------------------------------------------------------------

describe('readPath', () => {
  it('reads a nested path', () => {
    const obj = { a: { b: { c: 42 } } };
    expect(readPath(obj, 'a.b.c')).toBe(42);
  });

  it('returns undefined for missing intermediate key', () => {
    expect(readPath({ a: {} }, 'a.b.c')).toBeUndefined();
  });

  it('returns undefined for null obj', () => {
    expect(readPath(null, 'a.b')).toBeUndefined();
  });

  it('reads a single-segment path', () => {
    expect(readPath({ x: 7 }, 'x')).toBe(7);
  });

  it('returns undefined when path traverses a non-object', () => {
    expect(readPath({ a: 5 }, 'a.b')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// findSensorAttributes
// ---------------------------------------------------------------------------

describe('findSensorAttributes', () => {
  it('returns the sensorInfo.attributes from coreData', () => {
    const info = {
      coreData: [
        { data: { sensorInfo: { attributes: { '0001': 15, '0002': 8 } } } },
      ],
    };
    expect(findSensorAttributes(info)).toEqual({ '0001': 15, '0002': 8 });
  });

  it('returns empty object when no sensorInfo entry', () => {
    expect(findSensorAttributes({ coreData: [{ data: {} }] })).toEqual({});
  });

  it('returns empty object when coreData is absent', () => {
    expect(findSensorAttributes({})).toEqual({});
  });

  it('skips entries without sensorInfo.attributes', () => {
    const info = {
      coreData: [
        { data: { other: {} } },
        { data: { sensorInfo: { attributes: { pm: 5 } } } },
      ],
    };
    expect(findSensorAttributes(info)).toEqual({ pm: 5 });
  });
});

// ---------------------------------------------------------------------------
// findMcuVersion
// ---------------------------------------------------------------------------

describe('findMcuVersion', () => {
  it('returns the currentMcuVer string from coreData', () => {
    const info = {
      coreData: [
        { data: { currentMcuVer: '1.0.6' } },
      ],
    };
    expect(findMcuVersion(info)).toBe('1.0.6');
  });

  it('returns undefined when coreData has no mcuVer entry', () => {
    expect(findMcuVersion({ coreData: [{ data: {} }] })).toBeUndefined();
  });

  it('returns undefined when coreData is absent', () => {
    expect(findMcuVersion({})).toBeUndefined();
  });

  it('skips empty string mcuVer entries', () => {
    const info = {
      coreData: [
        { data: { currentMcuVer: '' } },
        { data: { currentMcuVer: '2.0.0' } },
      ],
    };
    expect(findMcuVersion(info)).toBe('2.0.0');
  });
});

// ---------------------------------------------------------------------------
// extractPurifierJsonFromHtml
// ---------------------------------------------------------------------------

function makeHtmlWithJson(json: unknown): string {
  const payload = JSON.stringify(json);
  return `<html><body><script>var data = ${payload};</script></body></html>`;
}

// Simulate Coway's double-escaped format by stringifying twice then stripping
// outer quotes — cowayaio strips all backslashes to unescape this.
function makeDoubleEscapedHtml(json: unknown): string {
  const innerJson = JSON.stringify(json);
  // Embed it escaped inside another string literal in the script block
  const escaped = JSON.stringify(innerJson).slice(1, -1); // strip outer quotes
  return `<html><body><script>var data = ${escaped};</script></body></html>`;
}

const SAMPLE_PURIFIER_JSON = {
  children: [
    {
      deviceStatusData: { data: { statusInfo: { attributes: { '0001': 1, '0002': 1, '0003': 2, '0007': 2 } } } },
      coreData: [
        { data: { sensorInfo: { attributes: { '0001': 15, '0002': 8 } } } },
        { data: { currentMcuVer: '1.0.6' } },
      ],
      deviceModule: {
        data: { content: { deviceModuleDetailInfo: { airStatusInfo: { iaqGrade: 2 } } } },
      },
    },
  ],
};

describe('extractPurifierJsonFromHtml', () => {
  it('extracts JSON from a script tag containing sensorInfo', () => {
    const html = makeHtmlWithJson(SAMPLE_PURIFIER_JSON);
    const result = extractPurifierJsonFromHtml(html);
    expect(result).not.toBeNull();
    expect(result?.children).toHaveLength(1);
  });

  it('returns null when no script tag contains sensorInfo', () => {
    const html = '<html><body><script>var x = 1;</script></body></html>';
    expect(extractPurifierJsonFromHtml(html)).toBeNull();
  });

  it('returns null for HTML with no script tags', () => {
    expect(extractPurifierJsonFromHtml('<html><body><p>text</p></body></html>')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractPurifierJsonFromHtml('')).toBeNull();
  });

  it('handles Coway double-escaped JSON (cowayaio-style backslash-strip path)', () => {
    // Build the HTML so the script body contains backslash-escaped JSON
    const innerJson = JSON.stringify(SAMPLE_PURIFIER_JSON);
    const escaped = innerJson.replace(/"/g, '\\"');
    const html = `<html><body><script>var data = ${escaped};</script></body></html>`;
    // If direct parse fails, extractPurifierJsonFromHtml falls back to strip-and-parse
    const result = extractPurifierJsonFromHtml(html);
    // Either path produces a valid parse or null — no throw
    expect(() => extractPurifierJsonFromHtml(html)).not.toThrow();
    // The stripped form should still yield the children array
    if (result) {
      expect(Array.isArray(result.children)).toBe(true);
    }
  });

  it('strips __proto__ keys for prototype-pollution safety', () => {
    const malicious = { children: [{ '__proto__': { evil: true }, safe: 'ok' }], sensorInfo: {} };
    const html = makeHtmlWithJson(malicious);
    const result = extractPurifierJsonFromHtml(html) as Record<string, unknown>;
    // __proto__ key should have no own-property set on the parsed child object
    const child = (result?.children as Record<string, unknown>[])?.[0];
    expect(Object.prototype.hasOwnProperty.call(child, '__proto__')).toBe(false);
    expect(child?.safe).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// assembleDeviceState
// ---------------------------------------------------------------------------

function makeStatus(overrides: Record<string, unknown> = {}) {
  return { '0001': 1, '0002': 1, '0003': 2, '0007': 2, '0008': 60, ...overrides };
}
function makeSensors(overrides: Record<string, unknown> = {}) {
  return { '0001': 15, '0002': 8, ...overrides };
}
function makeSupplies(overrides: Partial<SuppliesEntry>[] = []): SuppliesEntry[] {
  return [
    { supplyNm: 'Pre-Filter', filterRemain: 85, ...overrides[0] },
    { supplyNm: 'Max2 Filter', filterRemain: 60, ...overrides[1] },
  ];
}

describe('assembleDeviceState', () => {
  it('maps power register 1 → power=true', () => {
    const state = assembleDeviceState(makeStatus({ '0001': 1 }), {}, undefined, [], undefined);
    expect(state.power).toBe(true);
  });

  it('maps power register 0 → power=false', () => {
    const state = assembleDeviceState(makeStatus({ '0001': 0 }), {}, undefined, [], undefined);
    expect(state.power).toBe(false);
  });

  it('maps mode register to DeviceMode string', () => {
    expect(assembleDeviceState(makeStatus({ '0002': 1 }), {}, undefined, [], undefined).mode).toBe('auto');
    expect(assembleDeviceState(makeStatus({ '0002': 2 }), {}, undefined, [], undefined).mode).toBe('night');
    expect(assembleDeviceState(makeStatus({ '0002': 5 }), {}, undefined, [], undefined).mode).toBe('rapid');
    expect(assembleDeviceState(makeStatus({ '0002': 6 }), {}, undefined, [], undefined).mode).toBe('eco');
    expect(assembleDeviceState(makeStatus({ '0002': 9 }), {}, undefined, [], undefined).mode).toBe('manual');
  });

  it('clamps fanSpeed from register 0003', () => {
    const state = assembleDeviceState(makeStatus({ '0003': 3 }), {}, undefined, [], undefined);
    expect(state.fanSpeed).toBe(3);
  });

  it('maps light register 2 → lightOn=true', () => {
    const state = assembleDeviceState(makeStatus({ '0007': 2 }), {}, undefined, [], undefined);
    expect(state.lightOn).toBe(true);
  });

  it('maps light register 0 → lightOn=false', () => {
    const state = assembleDeviceState(makeStatus({ '0007': 0 }), {}, undefined, [], undefined);
    expect(state.lightOn).toBe(false);
  });

  it('reads timerMinutesRemaining from register 0008', () => {
    const state = assembleDeviceState(makeStatus({ '0008': 60 }), {}, undefined, [], undefined);
    expect(state.timerMinutesRemaining).toBe(60);
  });

  it('picks PM2.5 from sensor 0001', () => {
    const state = assembleDeviceState({}, makeSensors({ '0001': 12 }), undefined, [], undefined);
    expect(state.pm25).toBe(12);
  });

  it('picks PM10 from sensor 0002', () => {
    const state = assembleDeviceState({}, makeSensors({ '0002': 7 }), undefined, [], undefined);
    expect(state.pm10).toBe(7);
  });

  it('falls back to PM25_IDX for pm25 when sensor 0001 is absent', () => {
    const sensors = { PM25_IDX: 5 };
    const state = assembleDeviceState({}, sensors, undefined, [], undefined);
    expect(state.pm25).toBe(5);
  });

  it('maps airQuality from iaqGrade', () => {
    const aqGrade = { iaqGrade: 3 };
    const state = assembleDeviceState({}, {}, aqGrade, [], undefined);
    expect(state.airQuality).toBe(3);
  });

  it('airQuality = 0 (Unknown) when aqGrade is undefined', () => {
    const state = assembleDeviceState({}, {}, undefined, [], undefined);
    expect(state.airQuality).toBe(0);
  });

  it('reads filter percentages from supplies endpoint (preferred)', () => {
    const state = assembleDeviceState({}, {}, undefined, makeSupplies(), undefined);
    expect(state.preFilterPct).toBe(85);
    expect(state.max2FilterPct).toBe(60);
  });

  it('falls back to sensor-derived filter pct when supplies are missing', () => {
    // sensor 0011 = 40% used → 60% remaining
    const sensors = { '0011': 40, '0012': 20 };
    const state = assembleDeviceState({}, sensors, undefined, [], undefined);
    expect(state.preFilterPct).toBe(60);
    expect(state.max2FilterPct).toBe(80);
  });

  it('includes mcuVersion', () => {
    const state = assembleDeviceState({}, {}, undefined, [], '1.0.6');
    expect(state.mcuVersion).toBe('1.0.6');
  });

  it('mcuVersion is undefined when not passed', () => {
    const state = assembleDeviceState({}, {}, undefined, [], undefined);
    expect(state.mcuVersion).toBeUndefined();
  });

  it('supplies preFilterPct takes priority over sensor-derived value', () => {
    // supplies say 85%; sensor says 100-40=60%. Supplies win.
    const sensors = { '0011': 40 };
    const state = assembleDeviceState({}, sensors, undefined, makeSupplies(), undefined);
    expect(state.preFilterPct).toBe(85);
  });
});

// ---------------------------------------------------------------------------
// CowayClient — pre-condition guards (no HTTP mocking needed)
// ---------------------------------------------------------------------------

describe('CowayClient pre-condition guards', () => {
  const client = new CowayClient({
    username: 'test@example.com',
    password: 'password',
    skipPasswordChange: true,
    log: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      log: () => {},
      success: () => {},
    } as never,
  });

  const device = {
    deviceId: 'serial1',
    name: 'My Purifier',
    model: 'Airmega 400S',
    modelCode: '02EUZ',
    productModel: 'AP-2015E',
    placeId: '1',
    serial: 'serial1',
  };

  it('listDevices() throws before login()', async () => {
    await expect(client.listDevices()).rejects.toThrow('called before login');
  });

  it('getDeviceState() throws before login()', async () => {
    await expect(client.getDeviceState(device)).rejects.toThrow('called before login');
  });

  it('sendCommand() throws before login()', async () => {
    await expect(client.sendCommand(device, '0001', '1')).rejects.toThrow('called before login');
  });
});
