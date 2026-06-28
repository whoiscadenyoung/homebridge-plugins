import net from 'net';
import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';
import {
  DEFAULT_PORT,
  DEFAULT_TOPIC_PREFIX,
  MqttLoggerConfig,
  TOPIC_TABLE_MAP,
} from './settings';

// ---------------------------------------------------------------------------
// Aedes MQTT broker — loaded via require so we avoid esm/cjs interop issues
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AedesBroker = require('aedes') as new (opts?: object) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, cb: (...args: any[]) => void): void;
  handle(socket: net.Socket): void;
  close(cb?: () => void): void;
};

type AedesInstance = InstanceType<typeof AedesBroker>;

// ---------------------------------------------------------------------------
// Supabase helpers — inlined to avoid workspace:* dependency issues
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 10_000;

interface SupabaseConfig { url: string; key: string }

async function insertRow(
  config: SupabaseConfig,
  table: string,
  row: Record<string, unknown>,
  log: { warn(m: string): void; debug(m: string): void },
): Promise<void> {
  try {
    const res = await fetch(`${config.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': config.key,
        'Authorization': `Bearer ${config.key}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      log.warn(`[Supabase] Insert into ${table} failed: HTTP ${res.status}`);
    } else {
      log.debug(`[Supabase] Inserted row into ${table}`);
    }
  } catch (err) {
    log.warn(`[Supabase] Insert into ${table} error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function checkConnection(
  config: SupabaseConfig,
  table: string,
  log: { info(m: string): void; warn(m: string): void },
): Promise<boolean> {
  try {
    const res = await fetch(`${config.url}/rest/v1/${table}?select=id&limit=1`, {
      headers: {
        'apikey': config.key,
        'Authorization': `Bearer ${config.key}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) {
      log.info(`[Supabase] Connected — table ${table} accessible`);
      return true;
    }
    log.warn(`[Supabase] Connection check failed: HTTP ${res.status}`);
    return false;
  } catch (err) {
    log.warn(`[Supabase] Connection check error: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// MqttLoggerPlatform
// ---------------------------------------------------------------------------

export class MqttLoggerPlatform implements DynamicPlatformPlugin {
  private readonly supabase: SupabaseConfig;
  private readonly port: number;
  private readonly topicPrefix: string;
  private broker: AedesInstance | null = null;
  private server: net.Server | null = null;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    const cfg = config as unknown as MqttLoggerConfig;

    if (!cfg.supabase?.url || !cfg.supabase?.key) {
      this.log.error('[MqttLogger] supabase.url and supabase.key are required — broker will not start');
      this.supabase = { url: '', key: '' };
      this.port = DEFAULT_PORT;
      this.topicPrefix = DEFAULT_TOPIC_PREFIX;
      return;
    }

    this.supabase = cfg.supabase;
    this.port = cfg.port ?? DEFAULT_PORT;
    this.topicPrefix = cfg.topicPrefix ?? DEFAULT_TOPIC_PREFIX;

    this.api.on('didFinishLaunching', () => this.startBroker());
    this.api.on('shutdown', () => this.shutdown());
  }

  // Required by DynamicPlatformPlugin — this plugin registers no accessories
  configureAccessory(_accessory: PlatformAccessory): void {}

  private startBroker(): void {
    if (!this.supabase.url) return;

    void checkConnection(this.supabase, 'aranet4_readings', this.log);

    this.broker = new AedesBroker();

    this.broker.on('client', (client: { id: string }) => {
      this.log.info(`[MQTT] Client connected: ${client.id}`);
    });

    this.broker.on('clientDisconnect', (client: { id: string }) => {
      this.log.debug(`[MQTT] Client disconnected: ${client.id}`);
    });

    this.broker.on('publish', (
      packet: { topic: string; payload: Buffer | string },
      client: { id: string } | null,
    ) => {
      if (!client) return; // skip broker-internal retain/LWT messages
      const topic = packet.topic;
      if (!topic.startsWith(this.topicPrefix + '/')) return;
      const payload = Buffer.isBuffer(packet.payload)
        ? packet.payload
        : Buffer.from(packet.payload);
      this.handleMessage(topic, payload);
    });

    this.server = net.createServer((socket) => {
      this.broker!.handle(socket);
    });

    this.server.listen(this.port, () => {
      this.log.info(`[MQTT] Broker listening on port ${this.port}`);
    });

    this.server.on('error', (err: Error) => {
      this.log.error(`[MQTT] Server error: ${err.message}`);
    });
  }

  private handleMessage(topic: string, payload: Buffer): void {
    // topic format: "{prefix}/{pluginSegment}/{deviceId}"
    const rest = topic.slice(this.topicPrefix.length + 1);
    const slashIdx = rest.indexOf('/');
    if (slashIdx === -1) return;

    const pluginSegment = rest.slice(0, slashIdx);
    const deviceId = rest.slice(slashIdx + 1);

    const table = TOPIC_TABLE_MAP[pluginSegment];
    if (!table) {
      this.log.debug(`[MQTT] No table mapping for plugin segment '${pluginSegment}' — ignoring`);
      return;
    }

    let row: Record<string, unknown>;
    try {
      row = JSON.parse(payload.toString('utf8')) as Record<string, unknown>;
    } catch {
      this.log.warn(`[MQTT] Failed to parse JSON payload on topic ${topic}`);
      return;
    }

    if (!row.device_id) {
      row.device_id = deviceId;
    }

    this.log.debug(`[MQTT] ${topic} → ${table}`);
    void insertRow(this.supabase, table, row, this.log);
  }

  private shutdown(): void {
    this.log.info('[MQTT] Broker shutting down...');
    this.server?.close(() => {
      this.broker?.close(() => {
        this.log.info('[MQTT] Broker closed');
      });
    });
  }
}
