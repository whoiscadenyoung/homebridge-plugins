import { describe, it, expect } from 'bun:test';
import { redactBody, maskEmail } from '../src/api/redact.js';

describe('redactBody', () => {
  it('redacts known sensitive keys at the top level', () => {
    const body = { accessToken: 'secret', refreshToken: 'also-secret', name: 'keep-me' };
    const result = redactBody(body);
    expect(result).toContain('[redacted]');
    expect(result).toContain('"name":"keep-me"');
    expect(result).not.toContain('secret');
    expect(result).not.toContain('also-secret');
  });

  it('redacts nested sensitive keys', () => {
    const body = { data: { accessToken: 'token', userId: '123' }, safe: 'visible' };
    const result = redactBody(body);
    expect(result).not.toContain('token');
    expect(result).not.toContain('123');
    expect(result).toContain('"safe":"visible"');
  });

  it('redacts auth material keys', () => {
    for (const key of ['accessToken', 'refreshToken', 'authCode', 'password', 'authorization', 'cookie']) {
      const body = { [key]: 'sensitive-value' };
      expect(redactBody(body)).toContain('[redacted]');
      expect(redactBody(body)).not.toContain('sensitive-value');
    }
  });

  it('redacts PII keys', () => {
    for (const key of ['email', 'mobileNo', 'firstName', 'lastName', 'memberId', 'deviceSerial', 'placeName']) {
      const body = { [key]: 'pii-value' };
      expect(redactBody(body)).toContain('[redacted]');
      expect(redactBody(body)).not.toContain('pii-value');
    }
  });

  it('preserves non-sensitive keys', () => {
    // 'code' is a sensitive key (auth codes); use 'errorType' instead
    const body = { error: { errorType: 'NOT_FOUND', message: 'not found' }, status: 404 };
    const result = redactBody(body);
    expect(result).toContain('NOT_FOUND');
    expect(result).toContain('not found');
    expect(result).toContain('404');
  });

  it('handles arrays with sensitive entries', () => {
    const body = [{ accessToken: 'secret' }, { name: 'keep' }];
    const result = redactBody(body);
    expect(result).not.toContain('secret');
    expect(result).toContain('"name":"keep"');
  });

  it('handles deeply nested sensitive keys', () => {
    const body = { level1: { level2: { accessToken: 'deep-secret' } } };
    expect(redactBody(body)).not.toContain('deep-secret');
  });

  it('truncates bodies exceeding maxLength', () => {
    const body = { data: 'x'.repeat(1000) };
    const result = redactBody(body);
    expect(result).toContain('...[truncated]');
    expect(result.length).toBeLessThanOrEqual(500 + '...[truncated]'.length);
  });

  it('respects a custom maxLength', () => {
    const body = { value: 'y'.repeat(100) };
    const result = redactBody(body, 20);
    expect(result).toContain('...[truncated]');
  });

  it('handles circular references', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(redactBody(circular)).toBe('[unserializable body]');
  });

  it('handles null', () => {
    expect(redactBody(null)).toBe('null');
  });

  it('handles undefined', () => {
    expect(redactBody(undefined)).toBe('undefined');
  });

  it('handles empty object', () => {
    expect(redactBody({})).toBe('{}');
  });

  it('handles primitive number', () => {
    expect(redactBody(42)).toBe('42');
  });
});

describe('maskEmail', () => {
  it('masks the local part, keeping first char and full domain', () => {
    expect(maskEmail('user@example.com')).toBe('u***@example.com');
  });

  it('preserves different first characters', () => {
    expect(maskEmail('alice@domain.org')).toBe('a***@domain.org');
    expect(maskEmail('bob@test.io')).toBe('b***@test.io');
  });

  it('returns *** for strings with no @', () => {
    expect(maskEmail('notanemail')).toBe('***');
  });

  it('returns *** for strings starting with @', () => {
    expect(maskEmail('@domain.com')).toBe('***');
  });

  it('returns *** for empty string', () => {
    expect(maskEmail('')).toBe('***');
  });

  it('handles subdomain emails', () => {
    const result = maskEmail('user@mail.sub.example.com');
    expect(result).toBe('u***@mail.sub.example.com');
  });
});
