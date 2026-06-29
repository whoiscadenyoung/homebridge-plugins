/**
 * Integration tests for MqttLoggerPlatform.
 *
 * Each test suite starts a real Aedes broker on a random port so tests run
 * independently of the production Homebridge instance on port 1883.
 *
 * Run with: bun test
 */

import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test';
import net from 'net';
import { connect } from 'mqtt';
import type { API, Logger, PlatformConfig } from 'homebridge';
import { Aedes } from 'aedes';
import { MqttLoggerPlatform } from '../src/platform.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/** Poll until a TCP port is accepting connections, or throw on timeout. */
function waitForPort(port: number, timeout = 3_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    function attempt() {
      const s = net.createConnection(port, '127.0.0.1');
      s.on('connect', () => { s.destroy(); resolve(); });
      s.on('error', () => {
        if (Date.now() >= deadline) return reject(new Error(`Port ${port} not ready`));
        setTimeout(attempt, 50);
      });
    }
    attempt();
  });
}

/** Connect an MQTT client and resolve once CONNACK is received. */
function mqttConnect(port: number): Promise<ReturnType<typeof connect>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connack timeout')), 3_000);
    const client = connect(`mqtt://127.0.0.1:${port}`, {
      connectTimeout: 3_000,
      reconnectPeriod: 0,
    });
    client.on('connect', () => { clearTimeout(t); resolve(client); });
    client.on('error', err => { clearTimeout(t); reject(err); });
  });
}

/** Publish a message and resolve once the broker acknowledges it. */
function mqttPublish(
  client: ReturnType<typeof connect>,
  topic: string,
  payload: Record<string, unknown>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    client.publish(topic, JSON.stringify(payload), { qos: 0 }, err =>
      err ? reject(err) : resolve(),
    );
  });
}

function createMockLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    log: () => {},
    success: () => {},
  } as unknown as Logger;
}

type MockAPI = {
  on(event: string, handler: () => void): void;
  fire(event: string): void;
};

function createMockAPI(): MockAPI {
  const handlers = new Map<string, Array<() => void>>();
  return {
    on(event: string, handler: () => void) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    },
    fire(event: string) {
      handlers.get(event)?.forEach(h => h());
    },
  };
}

// ---------------------------------------------------------------------------
// Aedes API smoke test — this test would have caught the new Aedes() bug
// ---------------------------------------------------------------------------

describe('Aedes.createBroker()', () => {
  it('produces a broker that sends CONNACK to connecting clients', async () => {
    const broker = await Aedes.createBroker();
    const server = net.createServer(broker.handle);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;

    try {
      const client = await mqttConnect(port);
      client.end();
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      await new Promise<void>(resolve => broker.close(() => resolve()));
    }
  });
});

// ---------------------------------------------------------------------------
// Platform integration tests
// ---------------------------------------------------------------------------

describe('MqttLoggerPlatform', () => {
  const TEST_SUPABASE = { url: 'https://test.supabase.co', key: 'test-key' };

  let port: number;
  let mockAPI: MockAPI;
  let insertedRows: Array<{ table: string; row: Record<string, unknown> }>;

  beforeAll(async () => {
    port = await getFreePort();
    insertedRows = [];

    // Intercept all Supabase REST calls
    const originalFetch = global.fetch;
    global.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith(TEST_SUPABASE.url)) {
        return originalFetch(input, init);
      }
      const tableMatch = url.match(/\/rest\/v1\/([^?]+)/);
      if (tableMatch && init?.method === 'POST' && init.body) {
        insertedRows.push({
          table: tableMatch[1],
          row: JSON.parse(String(init.body)) as Record<string, unknown>,
        });
        return new Response(null, { status: 201 });
      }
      return new Response('[]', { status: 200 }); // connection-check GET
    }) as typeof global.fetch;

    mockAPI = createMockAPI();
    new MqttLoggerPlatform(
      createMockLogger(),
      { platform: 'MqttLogger', name: 'MqttLogger', port, supabase: TEST_SUPABASE } as PlatformConfig,
      mockAPI as unknown as API,
    );
    mockAPI.fire('didFinishLaunching');
    await waitForPort(port);
  });

  afterAll(async () => {
    mockAPI.fire('shutdown');
    await new Promise(resolve => setTimeout(resolve, 200));
  });

  it('accepts MQTT connections from plugins', async () => {
    const client = await mqttConnect(port);
    client.end();
  });

  it('routes homebridge/aranet4/{id} to aranet4_readings', async () => {
    const before = insertedRows.length;
    const client = await mqttConnect(port);
    await mqttPublish(client, 'homebridge/aranet4/ef4f02c5f083', {
      co2: 850,
      temperature: 22.5,
      humidity: 45,
      battery: 80,
      pressure: 1013,
    });
    client.end();
    await new Promise(resolve => setTimeout(resolve, 100));

    const inserted = insertedRows.slice(before);
    const match = inserted.find(r => r.table === 'aranet4_readings');
    expect(match).toBeDefined();
    expect(match!.row.co2).toBe(850);
    expect(match!.row.device_id).toBe('ef4f02c5f083');
  });

  it('routes homebridge/airmega/{id} to airmega_readings', async () => {
    const before = insertedRows.length;
    const client = await mqttConnect(port);
    await mqttPublish(client, 'homebridge/airmega/device123', {
      pm25: 5,
      pm10: 8,
      aqi: 10,
    });
    client.end();
    await new Promise(resolve => setTimeout(resolve, 100));

    const inserted = insertedRows.slice(before);
    const match = inserted.find(r => r.table === 'airmega_readings');
    expect(match).toBeDefined();
    expect(match!.row.pm25).toBe(5);
    expect(match!.row.device_id).toBe('device123');
  });

  it('does not call Supabase for messages on unknown topic segments', async () => {
    const before = insertedRows.length;
    const client = await mqttConnect(port);
    await mqttPublish(client, 'homebridge/unknown-plugin/device', { foo: 'bar' });
    client.end();
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(insertedRows.length).toBe(before);
  });

  it('skips messages published outside the homebridge/ prefix', async () => {
    const before = insertedRows.length;
    const client = await mqttConnect(port);
    await mqttPublish(client, 'other-prefix/aranet4/device', { co2: 900 });
    client.end();
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(insertedRows.length).toBe(before);
  });

  it('does not crash on malformed JSON payloads', async () => {
    const before = insertedRows.length;
    const client = await mqttConnect(port);
    await new Promise<void>((resolve, reject) => {
      client.publish('homebridge/aranet4/device', 'not-json', { qos: 0 }, err =>
        err ? reject(err) : resolve(),
      );
    });
    client.end();
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(insertedRows.length).toBe(before);
  });
});
