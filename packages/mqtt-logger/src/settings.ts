export const PLATFORM_NAME = 'MqttLogger';
export const PLUGIN_NAME = 'homebridge-mqtt-logger';

export const DEFAULT_PORT = 1883;
export const DEFAULT_TOPIC_PREFIX = 'homebridge';

export interface MqttLoggerConfig {
  platform: string;
  name: string;
  port?: number;
  topicPrefix?: string;
  supabase: { url: string; key: string };
}

/** Maps MQTT topic plugin segment → Supabase table name. Add entries here for new plugins. */
export const TOPIC_TABLE_MAP: Record<string, string> = {
  aranet4: 'aranet4_readings',
  airmega: 'airmega_readings',
};
