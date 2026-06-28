import { connect } from 'mqtt';
import type { MqttClient } from 'mqtt';

type Log = {
  info(m: string): void;
  debug(m: string): void;
  warn(m: string): void;
};

export class MqttPublisher {
  private readonly client: MqttClient;
  private readonly topicBase: string;

  constructor(brokerUrl: string, pluginName: string, private readonly log: Log) {
    this.topicBase = `homebridge/${pluginName}`;

    this.client = connect(brokerUrl, {
      clientId: `homebridge-${pluginName}-${Math.random().toString(16).slice(2, 8)}`,
      clean: true,
      connectTimeout: 4_000,
      reconnectPeriod: 2_000,
    });

    this.client.on('connect', () => {
      log.info(`[MQTT] Connected to broker at ${brokerUrl}`);
    });
    this.client.on('reconnect', () => {
      log.debug('[MQTT] Reconnecting to broker...');
    });
    this.client.on('error', (err) => {
      log.warn(`[MQTT] Client error: ${err.message}`);
    });
  }

  publish(deviceId: string, payload: Record<string, unknown>): void {
    const topic = `${this.topicBase}/${deviceId}`;
    this.client.publish(topic, JSON.stringify(payload), { qos: 0 }, (err?: Error) => {
      if (err) {
        this.log.warn(`[MQTT] Publish to '${topic}' failed: ${err.message}`);
      } else {
        this.log.debug(`[MQTT] Published to '${topic}'`);
      }
    });
  }

  disconnect(): void {
    this.client.end(false, undefined, () => {
      this.log.debug('[MQTT] Client disconnected');
    });
  }
}
