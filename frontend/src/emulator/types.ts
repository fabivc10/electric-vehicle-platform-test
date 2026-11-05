import type { ChargingProfile, EffectiveLimit } from './smartCharging';
import type { BootStatus, ConnectorStatus } from '@ev/shared';

/** Versiones OCPP que el emulador sabe hablar (las mismas que acepta el CSMS). */
export type EmuProtocol = 'ocpp1.6' | 'ocpp2.0.1' | 'ocpp2.1';
export const EMU_PROTOCOLS: EmuProtocol[] = ['ocpp1.6', 'ocpp2.0.1', 'ocpp2.1'];

/** AC (p. ej. J1772 monofásico) no conoce el SoC; DC (CCS/CHAdeMO) sí lo recibe del vehículo. */
export type ChargerType = 'AC' | 'DC';

export type LinkState = 'offline' | 'connecting' | 'connected';

/** Identidad y destino del cargador emulado. */
export interface EmulatorConfig {
  chargePointId: string;
  protocol: EmuProtocol;
  /** URL base del CSMS; el emulador agrega `/{chargePointId}`. */
  baseUrl: string;
  chargerType: ChargerType;
  vendor: string;
  model: string;
  serialNumber: string;
  firmwareVersion: string;
}

export interface EmulatorSettings {
  /** Palanca de prueba (no es comportamiento OCPP): responde Rejected a los comandos remotos. */
  rejectRemote: boolean;
  /** Ruido eléctrico (tensión ±2 %, potencia ±1,5 %) y calentamiento del equipo con la carga. */
  fluctuations: boolean;
  /** Eventos típicos de una sesión real: pausas del EV y fallos de comunicación con el vehículo. */
  randomEvents: boolean;
  /** Calidad del enlace con el CSMS: estable, lento (latencia) o inestable (cortes + WeakSignal). */
  network: NetworkQuality;
}

export type NetworkQuality = 'stable' | 'slow' | 'unstable';

/** Estado físico del medidor y del vehículo. Unidades: W, Wh, V, A, °C, %. */
export interface Physics {
  /** Registro del medidor (monótono creciente, no se reinicia por transacción, §7.31). */
  energyWh: number;
  offeredW: number;
  powerW: number;
  voltageV: number;
  currentA: number;
  socPercent: number;
  temperatureC: number;
  batteryWh: number;
  /** Lo que mide el equipo (consigna del panel + fluctuaciones). Es lo que va en MeterValues. */
  measuredVoltageV: number;
  measuredTemperatureC: number;
  /** Factor de reducción de potencia por temperatura (1 = sin reducción). */
  derate: number;
  /** Potencia que el EVSE ofrece al EV: hardware × reducción, limitada por Smart Charging. */
  availableW: number;
}

export type FrameKind = 'CALL' | 'CALLRESULT' | 'CALLERROR' | 'RAW' | 'INFO';

/** Una línea del tráfico OCPP visto desde el cargador. */
export interface FrameEntry {
  seq: number;
  at: string;
  /** tx = cargador → CSMS; rx = CSMS → cargador; sys = evento local. */
  dir: 'tx' | 'rx' | 'sys';
  kind: FrameKind;
  action?: string;
  messageId?: string;
  text: string;
  latencyMs?: number;
  error?: boolean;
}

export interface EmuTransaction {
  /** 1.6: lo asigna el CSMS en StartTransaction.conf (vacío hasta recibirlo). 2.x: lo genera el cargador. */
  id: string;
  idTag: string;
  parentIdTag?: string;
  startedAt: string;
  meterStartWh: number;
  remote: boolean;
}

export interface ConfigEntryView {
  key: string;
  /** Nombre en la versión activa (clave 1.6 o Componente.Variable de 2.x). */
  name: string;
  value: string;
  readonly: boolean;
  /** Tipo según §9: boolean, integer o CSL. */
  type: 'boolean' | 'integer' | 'CSL' | 'string';
  unit?: string;
  changedBy?: 'CSMS' | 'local';
  description: string;
}

/** Última muestra de medidor aceptada por el CSMS (para comparar). */
export interface SentSample {
  timestamp: string;
  context: string;
  values: Record<string, number>;
}

export interface EmulatorSnapshot {
  config: EmulatorConfig;
  settings: EmulatorSettings;
  powered: boolean;
  link: LinkState;
  negotiated?: string;
  bootStatus?: BootStatus;
  nextBootAt?: string;
  lastHeartbeatAt?: string;
  /** Diferencia reloj del CSMS − reloj local (sincronizado con Boot/Heartbeat.conf). */
  clockOffsetMs: number;
  connectorId: number;
  status: ConnectorStatus;
  /** Estado del cargador completo (connectorId 0): solo Available/Unavailable/Faulted. */
  stationStatus: ConnectorStatus;
  errorCode: string;
  info?: string;
  /** Falla activada a mano (checkbox). */
  faulted: boolean;
  /** errorCode elegido a mano (el informado puede venir de las protecciones). */
  manualErrorCode: string;
  /** Falla o aviso detectado por las protecciones del equipo (§7.6). */
  protection?: { code: string; faulted: boolean };
  plugged: boolean;
  operative: boolean;
  stationOperative: boolean;
  scheduledAvailability?: boolean;
  evSuspended: boolean;
  evseSuspended: boolean;
  /** Autorizado y esperando el cable (Preparing) hasta `authorizedUntil` (ConnectionTimeOut). */
  authorizedIdTag?: string;
  authorizedUntil?: string;
  lastAuthorization?: { idTag: string; status: string };
  transaction?: EmuTransaction;
  physics: Physics;
  chargingProfiles: ChargingProfile[];
  smartLimit: EffectiveLimit & { blocked: boolean };
  lastSample?: SentSample;
  /** Mensajes de transacción esperando envío (offline o reintentos, §3.7). */
  queueLength: number;
  configuration: ConfigEntryView[];
  supportedMeasurands: string[];
  frames: FrameEntry[];
  lastError?: string;
}

/** ChargePointErrorCode (OCPP 1.6 §7.6). En 2.x el detalle de fallas va por NotifyEvent. */
export const ERROR_CODES = [
  'NoError',
  'ConnectorLockFailure',
  'EVCommunicationError',
  'GroundFailure',
  'HighTemperature',
  'InternalError',
  'LocalListConflict',
  'OtherError',
  'OverCurrentFailure',
  'OverVoltage',
  'PowerMeterFailure',
  'PowerSwitchFailure',
  'ReaderFailure',
  'ResetFailure',
  'UnderVoltage',
  'WeakSignal',
] as const;
