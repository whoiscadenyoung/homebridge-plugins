import { describe, it, expect } from 'bun:test';
import {
  PLATFORM_NAME,
  PLUGIN_NAME,
  DEFAULT_POLL_SECONDS,
  SKIP_PASSWORD_CHANGE_DEFAULT,
  SUPPORTED_MODELS,
} from '../src/settings.js';

describe('settings constants', () => {
  it('PLATFORM_NAME matches the homebridge platform registration key', () => {
    expect(PLATFORM_NAME).toBe('AirmegaPlatform');
  });

  it('PLUGIN_NAME matches the npm package name suffix', () => {
    expect(PLUGIN_NAME).toBe('homebridge-airmega-iocare');
  });

  it('DEFAULT_POLL_SECONDS is 60', () => {
    expect(DEFAULT_POLL_SECONDS).toBe(60);
  });

  it('SKIP_PASSWORD_CHANGE_DEFAULT is true', () => {
    expect(SKIP_PASSWORD_CHANGE_DEFAULT).toBe(true);
  });

  it('SUPPORTED_MODELS includes the expected Airmega family', () => {
    expect(SUPPORTED_MODELS).toContain('400S');
    expect(SUPPORTED_MODELS).toContain('300S');
    expect(SUPPORTED_MODELS).toContain('250S');
    expect(SUPPORTED_MODELS).toContain('MightyS');
    expect(SUPPORTED_MODELS).toContain('IconS');
  });

  it('DEFAULT_POLL_SECONDS satisfies the minimum safe polling rate', () => {
    // Config schema enforces ≥ 30s; default should be well above that
    expect(DEFAULT_POLL_SECONDS).toBeGreaterThanOrEqual(30);
  });
});
