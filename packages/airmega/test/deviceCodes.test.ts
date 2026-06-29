import { describe, it, expect } from 'bun:test';
import {
  Attribute,
  ModeValue,
  LightMode,
  PREFILTER_CYCLE,
  PM_CAPABILITIES,
  PM_CAPABILITIES_UNKNOWN,
  PRESET_CAPABILITIES,
  PRESET_CAPABILITIES_UNKNOWN,
} from '../src/accessories/deviceCodes.js';

describe('Attribute hex codes', () => {
  it('POWER is 0001', () => expect(Attribute.POWER).toBe('0001'));
  it('MODE is 0002', () => expect(Attribute.MODE).toBe('0002'));
  it('FAN_SPEED is 0003', () => expect(Attribute.FAN_SPEED).toBe('0003'));
  it('LIGHT is 0007', () => expect(Attribute.LIGHT).toBe('0007'));
  it('TIMER is 0008', () => expect(Attribute.TIMER).toBe('0008'));
  it('BUTTON_LOCK is 0024', () => expect(Attribute.BUTTON_LOCK).toBe('0024'));
  it('SMART_SENSITIVITY is 000A', () => expect(Attribute.SMART_SENSITIVITY).toBe('000A'));
});

describe('ModeValue register strings', () => {
  it('AUTO is "1"', () => expect(ModeValue.AUTO).toBe('1'));
  it('NIGHT (Sleep preset) is "2"', () => expect(ModeValue.NIGHT).toBe('2'));
  it('RAPID (Smart/250S preset) is "5"', () => expect(ModeValue.RAPID).toBe('5'));
  it('ECO is "6"', () => expect(ModeValue.ECO).toBe('6'));
});

describe('LightMode constants', () => {
  it('OFF is "0"', () => expect(LightMode.OFF).toBe('0'));
  it('ON is "2" (400S binary value)', () => expect(LightMode.ON).toBe('2'));
  it('ON and OFF are distinct', () => expect(LightMode.ON).not.toBe(LightMode.OFF));
});

describe('PREFILTER_CYCLE mapping', () => {
  it('2 weeks → "1"', () => expect(PREFILTER_CYCLE[2]).toBe('1'));
  it('3 weeks → "2"', () => expect(PREFILTER_CYCLE[3]).toBe('2'));
  it('4 weeks → "3"', () => expect(PREFILTER_CYCLE[4]).toBe('3'));
});

describe('PM_CAPABILITIES per-model table', () => {
  it('400S (AP-2015E): pm10=true, pm25=false', () => {
    expect(PM_CAPABILITIES['AP-2015E']).toEqual({ pm10: true, pm25: false });
  });

  it('300S (AP-1521E): pm10=true, pm25=false', () => {
    expect(PM_CAPABILITIES['AP-1521E']).toEqual({ pm10: true, pm25: false });
  });

  it('MightyS (AP-1512HHS): pm10=true, pm25=false', () => {
    expect(PM_CAPABILITIES['AP-1512HHS']).toEqual({ pm10: true, pm25: false });
  });

  it('250S (AP-1719A): both pm10 and pm25', () => {
    expect(PM_CAPABILITIES['AP-1719A']).toEqual({ pm10: true, pm25: true });
  });

  it('250S new (AP-1720G): both pm10 and pm25', () => {
    expect(PM_CAPABILITIES['AP-1720G']).toEqual({ pm10: true, pm25: true });
  });

  it('IconS (AP-1722B): pm25=true, pm10=false', () => {
    expect(PM_CAPABILITIES['AP-1722B']).toEqual({ pm10: false, pm25: true });
  });

  it('unknown model falls back to all-false (safe: push nothing rather than fake 0)', () => {
    expect(PM_CAPABILITIES_UNKNOWN).toEqual({ pm10: false, pm25: false });
  });

  it('all documented models are present in the table', () => {
    for (const model of ['AP-2015E', 'AP-1521E', 'AP-1512HHS', 'AP-1719A', 'AP-1720G', 'AP-1722B']) {
      expect(PM_CAPABILITIES[model]).toBeDefined();
    }
  });
});

describe('PRESET_CAPABILITIES per-model table', () => {
  it('400S (AP-2015E): sleep=true, eco=false, smart=false', () => {
    expect(PRESET_CAPABILITIES['AP-2015E']).toEqual({ sleep: true, eco: false, smart: false });
  });

  it('300S (AP-1521E): sleep=true, eco=false, smart=false', () => {
    expect(PRESET_CAPABILITIES['AP-1521E']).toEqual({ sleep: true, eco: false, smart: false });
  });

  it('MightyS (AP-1512HHS): eco=true, sleep=false (Eco is quiet mode, no Night)', () => {
    expect(PRESET_CAPABILITIES['AP-1512HHS']).toEqual({ sleep: false, eco: true, smart: false });
  });

  it('250S (AP-1719A): sleep and smart', () => {
    expect(PRESET_CAPABILITIES['AP-1719A']).toEqual({ sleep: true, eco: false, smart: true });
  });

  it('250S new (AP-1720G): sleep and smart', () => {
    expect(PRESET_CAPABILITIES['AP-1720G']).toEqual({ sleep: true, eco: false, smart: true });
  });

  it('IconS (AP-1722B): sleep=true only', () => {
    expect(PRESET_CAPABILITIES['AP-1722B']).toEqual({ sleep: true, eco: false, smart: false });
  });

  it('unknown model fallback exposes only Sleep (safe minimum)', () => {
    expect(PRESET_CAPABILITIES_UNKNOWN).toEqual({ sleep: true, eco: false, smart: false });
  });

  it('all documented models are present in the table', () => {
    for (const model of ['AP-2015E', 'AP-1521E', 'AP-1512HHS', 'AP-1719A', 'AP-1720G', 'AP-1722B']) {
      expect(PRESET_CAPABILITIES[model]).toBeDefined();
    }
  });
});
