import type { ProtocolId } from '@ev/shared';

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value !== '' ? parsed : fallback;
};

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export type BootPolicy = 'accept-all' | 'known-only';
export type AuthPolicy = 'accept-all' | 'local-list';

export interface AppConfig {
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  ocpp: {
    /** Subprotocolo asumido cuando el cargador no envía Sec-WebSocket-Protocol. */
    defaultProtocol: Exclude<ProtocolId, 'mqtt'>;
    heartbeatIntervalSec: number;
    callTimeoutMs: number;
    bootPolicy: BootPolicy;
    /** Cargadores conocidos (para bootPolicy=known-only). */
    knownChargePoints: string[];
    transactionIdStart: number;
  };
  auth: {
    policy: AuthPolicy;
    /** idTags aceptados cuando policy=local-list. */
    idTags: string[];
  };
  mqtt: {
    url?: string;
    topicPrefix: string;
    username?: string;
    password?: string;
  };
  retention: {
    activityPerChargePoint: number;
    meterSamplesPerChargePoint: number;
  };
}

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => ({
  port: num(env.PORT, 3000),
  logLevel: (env.LOG_LEVEL as AppConfig['logLevel']) ?? 'info',
  ocpp: {
    defaultProtocol: (env.OCPP_DEFAULT_PROTOCOL as AppConfig['ocpp']['defaultProtocol']) ?? 'ocpp1.6',
    heartbeatIntervalSec: num(env.OCPP_HEARTBEAT_INTERVAL, 60),
    callTimeoutMs: num(env.OCPP_CALL_TIMEOUT_MS, 30_000),
    bootPolicy: env.OCPP_BOOT_POLICY === 'known-only' ? 'known-only' : 'accept-all',
    knownChargePoints: list(env.OCPP_KNOWN_CHARGE_POINTS),
    transactionIdStart: num(env.OCPP_TRANSACTION_ID_START, 1000),
  },
  auth: {
    policy: env.AUTH_POLICY === 'local-list' ? 'local-list' : 'accept-all',
    idTags: list(env.AUTH_ID_TAGS),
  },
  mqtt: {
    url: env.MQTT_URL || undefined,
    topicPrefix: env.MQTT_TOPIC_PREFIX ?? 'ev',
    username: env.MQTT_USERNAME || undefined,
    password: env.MQTT_PASSWORD || undefined,
  },
  retention: {
    activityPerChargePoint: num(env.RETENTION_ACTIVITY, 200),
    meterSamplesPerChargePoint: num(env.RETENTION_METER_SAMPLES, 720),
  },
});
