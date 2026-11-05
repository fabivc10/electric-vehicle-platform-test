import mqtt, { type MqttClient } from 'mqtt';
import type { z } from 'zod';
import type { ChargePointCommand, CommandResult } from '@ev/shared';
import type { ChargePointConnection } from '../../core/ports/ChargePointConnection.js';
import type { ActivityLog } from '../../core/services/ActivityLog.js';
import type { ChargingService } from '../../core/services/ChargingService.js';
import type { ConnectionRegistry } from '../../core/services/ConnectionRegistry.js';
import type { Logger } from '../../shared/logger.js';
import { summarizeReading } from '../ocpp/common/sampledValues.js';
import type { ProtocolGateway } from '../ProtocolGateway.js';
import * as M from './schemas.js';

export interface MqttGatewayDeps {
  url: string;
  topicPrefix: string;
  username?: string;
  password?: string;
  charging: ChargingService;
  activity: ActivityLog;
  connections: ConnectionRegistry;
  logger: Logger;
}

interface MqttRoute<S extends z.ZodType> {
  /** Nombre equivalente en OCPP para que el panel de eventos sea homogéneo. */
  action: string;
  schema: S;
  handle(chargePointId: string, msg: z.infer<S>): Promise<{ reply?: Record<string, unknown>; summary: string }>;
}

const route = <S extends z.ZodType>(r: MqttRoute<S>) => r as MqttRoute<z.ZodType>;

/** Conexión "virtual": MQTT no tiene request/response, los comandos se publican y se dan por enviados. */
class MqttChargePointConnection implements ChargePointConnection {
  readonly protocol = 'mqtt' as const;

  constructor(
    readonly chargePointId: string,
    private readonly client: MqttClient,
    private readonly prefix: string,
    private readonly activity: ActivityLog,
  ) {}

  async execute(command: ChargePointCommand): Promise<CommandResult> {
    const topic = `${this.prefix}/${this.chargePointId}/cmd/${command.type}`;
    await this.client.publishAsync(topic, JSON.stringify(command), { qos: 1 });
    await this.activity.record({
      chargePointId: this.chargePointId,
      direction: 'out',
      action: command.type,
      summary: 'Publicado',
    });
    return { accepted: true, status: 'Sent' };
  }

  close(): void {
    // No hay socket por cargador en MQTT; la presencia la controla el tópico `online`.
  }
}

/** Adapter MQTT: traduce el contrato de tópicos de schemas.ts al ChargingService. */
export class MqttGateway implements ProtocolGateway {
  readonly name = 'mqtt';
  private client?: MqttClient;
  private readonly connections = new Map<string, MqttChargePointConnection>();
  private readonly routes: Record<string, MqttRoute<z.ZodType>>;

  constructor(private readonly deps: MqttGatewayDeps) {
    const { charging } = deps;
    this.routes = {
      boot: route({
        action: 'BootNotification',
        schema: M.BootMsg,
        handle: async (id, m) => {
          const r = await charging.boot(id, m);
          return { reply: { status: r.status, interval: r.intervalSec, currentTime: r.currentTime }, summary: r.status };
        },
      }),
      heartbeat: route({
        action: 'Heartbeat',
        schema: M.HeartbeatMsg,
        handle: async (id) => ({ reply: { currentTime: await charging.heartbeat(id) }, summary: 'OK' }),
      }),
      status: route({
        action: 'StatusNotification',
        schema: M.StatusMsg,
        handle: async (id, m) => {
          await charging.connectorStatus(id, m);
          return { summary: m.status };
        },
      }),
      authorize: route({
        action: 'Authorize',
        schema: M.AuthorizeMsg,
        handle: async (id, m) => {
          const status = await charging.authorize(id, m.idTag);
          return { reply: { status }, summary: status };
        },
      }),
      'transaction/start': route({
        action: 'StartTransaction',
        schema: M.StartMsg,
        handle: async (id, m) => {
          const tx = await charging.startTransaction(id, { ...m, startedAt: m.timestamp });
          return { reply: { transactionId: tx.id, status: tx.authorization }, summary: `#${tx.id}` };
        },
      }),
      meter: route({
        action: 'MeterValues',
        schema: M.MeterMsg,
        handle: async (id, m) => {
          const { requestId: _r, ...sample } = m;
          await charging.meterValues(id, sample);
          return { summary: summarizeReading(sample) };
        },
      }),
      'transaction/stop': route({
        action: 'StopTransaction',
        schema: M.StopMsg,
        handle: async (id, m) => {
          await charging.stopTransaction(id, { ...m, stoppedAt: m.timestamp });
          return { summary: `#${m.transactionId} · ${m.reason ?? 'Local'}` };
        },
      }),
    };
  }

  async start(): Promise<void> {
    const { url, username, password, topicPrefix, logger } = this.deps;
    this.client = await mqtt.connectAsync(url, { username, password, reconnectPeriod: 5000 });
    this.client.on('message', (topic, payload) => void this.onMessage(topic, payload.toString()));
    this.client.on('error', (err) => logger.warn(`MQTT error: ${err.message}`));
    await this.client.subscribeAsync([`${topicPrefix}/+/online`, `${topicPrefix}/+/up/#`], { qos: 1 });
    logger.info(`MQTT conectado a ${url} (prefijo "${topicPrefix}")`);
  }

  async stop(): Promise<void> {
    await this.client?.endAsync();
  }

  private async onMessage(topic: string, raw: string): Promise<void> {
    const { topicPrefix, logger, charging, activity } = this.deps;
    const parts = topic.slice(topicPrefix.length + 1).split('/');
    const [chargePointId, kind, ...rest] = parts;
    if (!chargePointId || !kind) return;

    if (kind === 'online') {
      if (raw.trim() === '1') this.ensureConnection(chargePointId);
      else this.dropConnection(chargePointId);
      return;
    }
    if (kind !== 'up') return;

    const name = rest.join('/');
    const r = this.routes[name];
    if (!r) return logger.warn(`MQTT: tópico no soportado ${topic}`);

    this.ensureConnection(chargePointId);
    let json: unknown;
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      return logger.warn(`MQTT: JSON inválido en ${topic}`);
    }
    const parsed = r.schema.safeParse(json);
    if (!parsed.success) {
      await activity.record({ chargePointId, direction: 'in', action: r.action, summary: 'FormatViolation', ok: false });
      return;
    }

    try {
      const { reply, summary } = await r.handle(chargePointId, parsed.data);
      await charging.touch(chargePointId);
      await activity.record({ chargePointId, direction: 'in', action: r.action, summary });
      if (reply) {
        const requestId = (parsed.data as { requestId?: string }).requestId;
        await this.client?.publishAsync(
          `${topicPrefix}/${chargePointId}/down/${name}`,
          JSON.stringify(requestId ? { requestId, ...reply } : reply),
          { qos: 1 },
        );
      }
    } catch (error) {
      logger.error(`MQTT: fallo procesando ${topic}`, error);
    }
  }

  private ensureConnection(chargePointId: string): void {
    if (!this.client || this.connections.has(chargePointId)) return;
    const conn = new MqttChargePointConnection(chargePointId, this.client, this.deps.topicPrefix, this.deps.activity);
    this.connections.set(chargePointId, conn);
    this.deps.connections.register(conn);
    void this.deps.charging.connected(chargePointId, 'mqtt');
  }

  private dropConnection(chargePointId: string): void {
    const conn = this.connections.get(chargePointId);
    if (!conn) return;
    this.connections.delete(chargePointId);
    if (this.deps.connections.unregister(conn)) void this.deps.charging.disconnected(chargePointId);
  }
}
