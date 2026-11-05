/**
 * Modelo de dominio NORMALIZADO, independiente del protocolo.
 *
 * Ni el frontend ni los servicios del backend conocen OCPP 1.6, OCPP 2.x o MQTT:
 * cada adaptador de protocolo traduce sus mensajes a estos tipos.
 *
 * Este paquete solo exporta tipos. Importar siempre con `import type`.
 * Unidades: potencia en W, energía en Wh, tensión en V, corriente en A, temperatura en °C.
 */

/** Protocolos que la plataforma acepta. */
export type ProtocolId = 'ocpp1.6' | 'ocpp2.0.1' | 'ocpp2.1' | 'mqtt';

export const PROTOCOL_LABELS: Record<ProtocolId, string> = {
  'ocpp1.6': 'OCPP 1.6J',
  'ocpp2.0.1': 'OCPP 2.0.1',
  'ocpp2.1': 'OCPP 2.1',
  mqtt: 'MQTT',
};

/**
 * Estado de conector. Se usa el vocabulario de OCPP 1.6 por ser el más detallado;
 * los adaptadores de 2.x (Available/Occupied/...) y MQTT lo mapean a estos valores.
 */
export type ConnectorStatus =
  | 'Available'
  | 'Preparing'
  | 'Charging'
  | 'SuspendedEVSE'
  | 'SuspendedEV'
  | 'Finishing'
  | 'Reserved'
  | 'Unavailable'
  | 'Faulted';

export type BootStatus = 'Accepted' | 'Pending' | 'Rejected';

export type AuthorizationStatus = 'Accepted' | 'Blocked' | 'Expired' | 'Invalid' | 'ConcurrentTx';

export interface Connector {
  /** En OCPP 2.x corresponde al `evseId`. El 0 representa al cargador completo. */
  id: number;
  status: ConnectorStatus;
  /** Solo 1.6 informa errorCode; en 2.x queda sin definir. */
  errorCode?: string;
  info?: string;
  updatedAt: string;
}

export interface AuthorizationRecord {
  idTag: string;
  status: AuthorizationStatus;
  at: string;
}

export interface ChargePoint {
  /** Identidad del cargador (último segmento de la URL OCPP o del tópico MQTT). */
  id: string;
  name?: string;
  protocol: ProtocolId;
  online: boolean;
  vendor?: string;
  model?: string;
  serialNumber?: string;
  firmwareVersion?: string;
  bootStatus?: BootStatus;
  heartbeatIntervalSec: number;
  lastHeartbeatAt?: string;
  lastSeenAt?: string;
  connectedAt?: string;
  connectors: Connector[];
  lastAuthorization?: AuthorizationRecord;
}

export interface MeterSample {
  chargePointId: string;
  connectorId: number;
  transactionId?: string;
  timestamp: string;
  powerW?: number;
  energyWh?: number;
  voltageV?: number;
  currentA?: number;
  socPercent?: number;
  temperatureC?: number;
  powerOfferedW?: number;
}

export type TransactionState = 'active' | 'completed';

export interface Transaction {
  /** En 1.6 es el entero asignado por el CSMS (como string); en 2.x lo asigna el cargador. */
  id: string;
  chargePointId: string;
  connectorId: number;
  idTag: string;
  authorization: AuthorizationStatus;
  state: TransactionState;
  /** Registro al inicio. En 2.x puede faltar si TxStartedMeasurands está vacío: se toma la primera lectura. */
  meterStartWh?: number;
  meterStopWh?: number;
  startedAt: string;
  stoppedAt?: string;
  stopReason?: string;
  /** Energía entregada en la sesión (último registro - meterStart). */
  energyWh: number;
  lastMeter?: MeterSample;
}

export type ActivityDirection = 'in' | 'out';

/** Una línea del panel "Eventos OCPP". */
export interface ActivityEntry {
  id: string;
  chargePointId: string;
  timestamp: string;
  direction: ActivityDirection;
  /** Nombre de la acción en el vocabulario del protocolo (BootNotification, TransactionEvent...). */
  action: string;
  summary: string;
  /** Texto para personas (el detalle técnico queda en action/summary). */
  message?: string;
  ok: boolean;
}

/** Comandos que el CSMS puede enviar a un cargador, independientes del protocolo. */
/** OCPP 1.6 §7.8 ChargingProfile (en 2.x: ChargingProfileType con un solo chargingSchedule). */
export type ChargingProfilePurpose = 'ChargePointMaxProfile' | 'TxDefaultProfile' | 'TxProfile';
export interface ChargingSchedulePeriod {
  /** Segundos desde el inicio del schedule. */
  startPeriod: number;
  /** Límite en la unidad del schedule (A o W). */
  limit: number;
  numberPhases?: number;
}
export interface ChargingProfileInput {
  id: number;
  stackLevel: number;
  purpose: ChargingProfilePurpose;
  kind: 'Absolute' | 'Recurring' | 'Relative';
  recurrencyKind?: 'Daily' | 'Weekly';
  validFrom?: string;
  validTo?: string;
  /** Solo TxProfile. */
  transactionId?: string;
  schedule: {
    duration?: number;
    startSchedule?: string;
    unit: 'A' | 'W';
    periods: ChargingSchedulePeriod[];
    minChargingRate?: number;
  };
}
export interface CompositeSchedule {
  connectorId: number;
  scheduleStart?: string;
  duration?: number;
  unit?: 'A' | 'W';
  periods: ChargingSchedulePeriod[];
}

export type ChargePointCommand =
  | { type: 'RemoteStart'; connectorId: number; idTag: string }
  | { type: 'RemoteStop'; transactionId: string }
  | { type: 'Reset'; mode: 'Soft' | 'Hard' }
  | { type: 'UnlockConnector'; connectorId: number }
  | { type: 'ChangeAvailability'; connectorId: number; available: boolean }
  | {
      type: 'TriggerMessage';
      message: 'BootNotification' | 'Heartbeat' | 'StatusNotification' | 'MeterValues';
      connectorId?: number;
    }
  /**
   * Leer configuración. 1.6: claves de GetConfiguration (vacío = todas).
   * 2.x: "Componente.Variable" del Device Model (vacío = las variables estándar conocidas).
   */
  | { type: 'GetConfiguration'; keys?: string[] }
  /** Smart Charging: 1.6 SetChargingProfile / 2.x SetChargingProfile (evseId). */
  | { type: 'SetChargingProfile'; connectorId: number; profile: ChargingProfileInput }
  | { type: 'ClearChargingProfile'; id?: number; connectorId?: number; purpose?: ChargingProfilePurpose; stackLevel?: number }
  | { type: 'GetCompositeSchedule'; connectorId: number; duration: number; unit?: 'A' | 'W' }
  /** Cambiar una clave (1.6 ChangeConfiguration) o variable "Componente.Variable" (2.x SetVariables). */
  | { type: 'ChangeConfiguration'; key: string; value: string }
  /** Escape hatch: acción cruda del protocolo nativo del cargador. */
  | { type: 'Raw'; action: string; payload: Record<string, unknown> };

export interface ConfigurationEntry {
  /** Clave 1.6 o "Componente.Variable" en 2.x. */
  key: string;
  value?: string;
  readonly: boolean;
}

export interface CommandResult {
  accepted: boolean;
  status: string;
  response?: unknown;
  /** Solo en GetConfiguration: valores normalizados (1.6 y 2.x). */
  configuration?: ConfigurationEntry[];
  /** Solo en GetConfiguration: claves que el cargador no reconoce. */
  unknownKeys?: string[];
  /** Solo en GetCompositeSchedule. */
  compositeSchedule?: CompositeSchedule;
}

export interface ChargePointSnapshot {
  chargePoint: ChargePoint;
  activeTransactions: Transaction[];
  meterHistory: MeterSample[];
  activity: ActivityEntry[];
}

/** Eventos que el backend empuja al dashboard por WebSocket (`/live`). */
export type LiveEvent =
  | { type: 'chargePoint'; chargePoint: ChargePoint }
  | { type: 'transaction'; transaction: Transaction }
  | { type: 'meter'; sample: MeterSample }
  | { type: 'activity'; entry: ActivityEntry }
  | { type: 'chargePointRemoved'; chargePointId: string };
