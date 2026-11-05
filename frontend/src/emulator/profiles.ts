import type { ChargingProfile, Purpose, RateUnit, SchedulePeriod } from './smartCharging';
import { RpcError } from './rpc';
import type { ConnectorStatus } from '@ev/shared';
import type { Sample } from './measurands';
import type { EmulatorConfig, EmuProtocol } from './types';

export interface OutCall {
  action: string;
  payload: Record<string, unknown>;
}

/** Reason de StopTransaction (OCPP 1.6 §7.36). */
export type StopReason =
  | 'Local'
  | 'Remote'
  | 'EVDisconnected'
  | 'DeAuthorized'
  | 'SoftReset'
  | 'HardReset'
  | 'UnlockCommand'
  | 'PowerLoss';
export type BootReason = 'PowerUp' | 'RemoteReset' | 'Triggered';
export type UpdateTrigger = 'MeterValuePeriodic' | 'MeterValueClock' | 'Trigger' | 'ChargingStateChanged';

export interface TxRef {
  connectorId: number;
  transactionId: string;
  idTag: string;
  idTokenType: string;
  remoteStartId?: number;
  /** 2.x: correlativo de TransactionEvent. */
  seqNo: number;
  /** 2.x: el mensaje se generó sin conexión (§3.7 / E04). */
  offline: boolean;
  status: ConnectorStatus;
  /** 2.x: triggerReason del Started (lo que completó las condiciones de inicio). */
  startTrigger?: string;
}

/** Lo que el CSMS le pide al cargador, ya independiente de la versión. */
export type DeviceRequest =
  | { kind: 'RemoteStart'; idTag: string; idTokenType: string; connectorId?: number; remoteStartId?: number; chargingProfile?: ChargingProfile }
  | { kind: 'SetChargingProfile'; profile: ChargingProfile }
  | { kind: 'ClearChargingProfile'; id?: number; connectorId?: number; purpose?: Purpose; stackLevel?: number }
  | { kind: 'GetCompositeSchedule'; connectorId: number; duration: number; unit?: RateUnit }
  | { kind: 'RemoteStop'; transactionId: string }
  | { kind: 'Reset'; graceful: boolean }
  | { kind: 'Unlock'; connectorId: number }
  | { kind: 'ChangeAvailability'; connectorId: number; operative: boolean }
  | { kind: 'Trigger'; message: string; connectorId?: number }
  | { kind: 'GetConfiguration'; keys?: string[] }
  | { kind: 'ChangeConfiguration'; key: string; value: string }
  | { kind: 'GetVariables'; items: { component: string; variable: string; attributeType?: string }[] }
  | { kind: 'SetVariables'; items: { component: string; variable: string; value: string; attributeType?: string }[] }
  | { kind: 'Unsupported'; action: string };

/**
 * Strategy por versión OCPP del lado cargador: arma los .req salientes con los campos
 * que define cada versión e interpreta los CALL entrantes.
 */
export interface OcppProfile {
  protocol: EmuProtocol;
  boot(cfg: EmulatorConfig, reason: BootReason): OutCall;
  heartbeat(): OutCall;
  /** GetCompositeSchedule.conf de cada versión. */
  compositeResult(
    status: 'Accepted' | 'Rejected',
    connectorId: number,
    schedule?: { scheduleStart: string; duration: number; unit: RateUnit; periods: SchedulePeriod[] },
  ): Record<string, unknown>;
  /** Lo que la versión distingue en StatusNotification (2.x solo ve Available/Occupied/…). */
  statusKey(status: ConnectorStatus, errorCode: string, info?: string): string;
  statusNotification(connectorId: number, status: ConnectorStatus, errorCode: string, info: string | undefined, at: string): OutCall;
  authorize(idTag: string, idTokenType: string): OutCall;
  authResult(res: unknown): { status: string; parentIdTag?: string };
  startTransaction(tx: TxRef, meterStartWh: number, at: string, begin?: Sample): OutCall;
  startResult(res: unknown, tx: TxRef): { transactionId: string; status: string; parentIdTag?: string };
  /** Muestra durante la transacción (1.6 MeterValues con transactionId; 2.x TransactionEvent Updated). */
  txUpdate(tx: TxRef, trigger: UpdateTrigger, at: string, sample?: Sample): OutCall | undefined;
  /** MeterValues sin transacción (o disparado por TriggerMessage). */
  meterValues(connectorId: number, sample: Sample, transactionId?: string): OutCall;
  stopTransaction(tx: TxRef, reason: StopReason, meterStopWh: number, at: string, data: Sample[], idTag?: string): OutCall;
  idleStatus(message: 'DiagnosticsStatusNotification' | 'FirmwareStatusNotification' | 'LogStatusNotification'): OutCall;
  parseIncoming(action: string, payload: unknown): DeviceRequest;
}

const obj = (p: unknown): Record<string, unknown> => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);

/**
 * ChargingProfile entrante → modelo interno, validando tipos y cardinalidad de §7.8, §7.13, §7.14.
 * `v2` = forma de 2.x (id, chargingSchedule[] y ChargingStationMaxProfile).
 */
const parseProfile = (raw: unknown, connectorId: number, v2: boolean): ChargingProfile => {
  const codes = v2
    ? { occ: 'OccurrenceConstraintViolation', type: 'TypeConstraintViolation', prop: 'PropertyConstraintViolation' }
    : { occ: 'OccurenceConstraintViolation', type: 'TypeConstraintViolation', prop: 'PropertyConstraintViolation' };
  const p = obj(raw);
  const int = (o: Record<string, unknown>, k: string, req: boolean, path: string) => {
    const v = o[k];
    if (v === undefined) {
      if (req) throw new RpcError(codes.occ, `${path}.${k} es requerido`);
      return undefined;
    }
    if (typeof v !== 'number' || !Number.isInteger(v)) throw new RpcError(codes.type, `${path}.${k} debe ser integer`);
    return v;
  };
  const dec = (o: Record<string, unknown>, k: string, req: boolean, path: string) => {
    const v = o[k];
    if (v === undefined) {
      if (req) throw new RpcError(codes.occ, `${path}.${k} es requerido`);
      return undefined;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new RpcError(codes.type, `${path}.${k} debe ser decimal`);
    return v;
  };
  const date = (o: Record<string, unknown>, k: string, path: string) => {
    const v = o[k];
    if (v === undefined) return undefined;
    if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) throw new RpcError(codes.type, `${path}.${k} debe ser dateTime`);
    return v;
  };
  const oneOf = <T extends string>(o: Record<string, unknown>, k: string, values: readonly T[], req: boolean, path: string) => {
    const v = o[k];
    if (v === undefined) {
      if (req) throw new RpcError(codes.occ, `${path}.${k} es requerido`);
      return undefined;
    }
    if (typeof v !== 'string') throw new RpcError(codes.type, `${path}.${k} debe ser string`);
    if (!values.includes(v as T)) throw new RpcError(codes.prop, `${path}.${k} "${v}" no es uno de: ${values.join(', ')}`);
    return v as T;
  };
  const path = v2 ? 'chargingProfile' : 'csChargingProfiles';
  if (raw === undefined) throw new RpcError(codes.occ, `${path} es requerido`);
  const purposeRaw = oneOf(p, 'chargingProfilePurpose', v2 ? ['ChargingStationMaxProfile', 'TxDefaultProfile', 'TxProfile'] as const : ['ChargePointMaxProfile', 'TxDefaultProfile', 'TxProfile'] as const, true, path)!;
  const schedRaw = v2 ? (Array.isArray(p.chargingSchedule) ? p.chargingSchedule[0] : undefined) : p.chargingSchedule;
  if (schedRaw === undefined) throw new RpcError(codes.occ, `${path}.chargingSchedule es requerido`);
  const s = obj(schedRaw);
  const sp = `${path}.chargingSchedule`;
  const periodsRaw = s.chargingSchedulePeriod;
  if (!Array.isArray(periodsRaw) || !periodsRaw.length) throw new RpcError(codes.occ, `${sp}.chargingSchedulePeriod requiere 1..*`);
  const tx = p.transactionId;
  return {
    id: int(p, v2 ? 'id' : 'chargingProfileId', true, path)!,
    connectorId,
    transactionId: tx === undefined ? undefined : String(tx),
    stackLevel: int(p, 'stackLevel', true, path)!,
    purpose: purposeRaw === 'ChargingStationMaxProfile' ? 'ChargePointMaxProfile' : purposeRaw,
    kind: oneOf(p, 'chargingProfileKind', ['Absolute', 'Recurring', 'Relative'] as const, true, path)!,
    recurrencyKind: oneOf(p, 'recurrencyKind', ['Daily', 'Weekly'] as const, false, path),
    validFrom: date(p, 'validFrom', path),
    validTo: date(p, 'validTo', path),
    schedule: {
      duration: int(s, 'duration', false, sp),
      startSchedule: date(s, 'startSchedule', sp),
      unit: oneOf(s, 'chargingRateUnit', ['A', 'W'] as const, true, sp)!,
      minChargingRate: dec(s, 'minChargingRate', false, sp),
      periods: periodsRaw.map((x, i) => {
        const o = obj(x);
        const pp = `${sp}.chargingSchedulePeriod[${i}]`;
        return { startPeriod: int(o, 'startPeriod', true, pp)!, limit: dec(o, 'limit', true, pp)!, numberPhases: int(o, 'numberPhases', false, pp) };
      }),
    },
  };
};

// ───────────────────────────── OCPP 1.6J ─────────────────────────────

/** sampledValue de 1.6: `value` es string (§7.43). */
const meterValue16 = (s: Sample) => ({
  timestamp: s.timestamp,
  sampledValue: s.readings.map((r) => ({
    value: String(r.value),
    context: r.context,
    measurand: r.measurand,
    unit: r.unit,
    ...(r.location ? { location: r.location } : {}),
  })),
});

const ocpp16: OcppProfile = {
  protocol: 'ocpp1.6',

  boot: (cfg) => ({
    action: 'BootNotification',
    payload: {
      chargePointVendor: cfg.vendor.slice(0, 20),
      chargePointModel: cfg.model.slice(0, 20),
      ...(cfg.serialNumber ? { chargePointSerialNumber: cfg.serialNumber.slice(0, 25) } : {}),
      ...(cfg.firmwareVersion ? { firmwareVersion: cfg.firmwareVersion.slice(0, 50) } : {}),
    },
  }),
  heartbeat: () => ({ action: 'Heartbeat', payload: {} }),
  // §6.25 GetCompositeSchedule.conf
  compositeResult: (status, connectorId, s) =>
    status === 'Rejected' || !s
      ? { status: 'Rejected' }
      : {
          status,
          connectorId,
          scheduleStart: s.scheduleStart,
          chargingSchedule: { duration: s.duration, startSchedule: s.scheduleStart, chargingRateUnit: s.unit, chargingSchedulePeriod: s.periods },
        },
  statusKey: (status, errorCode, info) => `${status}|${errorCode}|${info ?? ''}`,
  statusNotification: (connectorId, status, errorCode, info, at) => ({
    action: 'StatusNotification',
    payload: { connectorId, errorCode, status, timestamp: at, ...(info ? { info: info.slice(0, 50) } : {}) },
  }),
  authorize: (idTag) => ({ action: 'Authorize', payload: { idTag } }),
  authResult: (res) => {
    const info = obj(obj(res).idTagInfo);
    return { status: str(info.status) ?? 'Invalid', parentIdTag: str(info.parentIdTag) };
  },

  startTransaction: (tx, meterStartWh, at) => ({
    action: 'StartTransaction',
    payload: { connectorId: tx.connectorId, idTag: tx.idTag, meterStart: Math.round(meterStartWh), timestamp: at },
  }),
  startResult: (res) => {
    const r = obj(res);
    const info = obj(r.idTagInfo);
    return {
      transactionId: String(r.transactionId ?? ''),
      status: str(info.status) ?? 'Invalid',
      parentIdTag: str(info.parentIdTag),
    };
  },

  // 1.6 no tiene un mensaje de "cambio de estado de carga": eso va por StatusNotification.
  txUpdate: (tx, trigger, _at, sample) =>
    trigger === 'ChargingStateChanged' || !sample
      ? undefined
      : {
          action: 'MeterValues',
          payload: { connectorId: tx.connectorId, transactionId: Number(tx.transactionId), meterValue: [meterValue16(sample)] },
        },
  meterValues: (connectorId, sample, transactionId) => ({
    action: 'MeterValues',
    payload: {
      connectorId,
      ...(transactionId ? { transactionId: Number(transactionId) } : {}),
      meterValue: [meterValue16(sample)],
    },
  }),
  stopTransaction: (tx, reason, meterStopWh, at, data, idTag) => ({
    action: 'StopTransaction',
    payload: {
      transactionId: Number(tx.transactionId),
      meterStop: Math.round(meterStopWh),
      timestamp: at,
      reason,
      ...(idTag ? { idTag } : {}),
      // §3.16.5: con StopTxnSampledData y StopTxnAlignedData vacíos no se envía transactionData.
      ...(data.length ? { transactionData: data.map(meterValue16) } : {}),
    },
  }),
  idleStatus: (message) => ({ action: message, payload: { status: 'Idle' } }),

  parseIncoming(action, payload) {
    const p = obj(payload);
    switch (action) {
      case 'RemoteStartTransaction':
        return {
          kind: 'RemoteStart',
          idTag: str(p.idTag) ?? '',
          idTokenType: 'Central',
          connectorId: num(p.connectorId),
          chargingProfile: p.chargingProfile === undefined ? undefined : parseProfile(p.chargingProfile, num(p.connectorId) ?? 1, false),
        };
      case 'SetChargingProfile':
        return { kind: 'SetChargingProfile', profile: parseProfile(p.csChargingProfiles, num(p.connectorId) ?? -1, false) };
      case 'ClearChargingProfile':
        return {
          kind: 'ClearChargingProfile',
          id: num(p.id),
          connectorId: num(p.connectorId),
          purpose: str(p.chargingProfilePurpose) as Purpose | undefined,
          stackLevel: num(p.stackLevel),
        };
      case 'GetCompositeSchedule':
        return { kind: 'GetCompositeSchedule', connectorId: num(p.connectorId) ?? -1, duration: num(p.duration) ?? 0, unit: str(p.chargingRateUnit) as RateUnit | undefined };
      case 'RemoteStopTransaction':
        return { kind: 'RemoteStop', transactionId: String(p.transactionId) };
      case 'Reset':
        return { kind: 'Reset', graceful: p.type !== 'Hard' };
      case 'UnlockConnector':
        return { kind: 'Unlock', connectorId: num(p.connectorId) ?? -1 };
      case 'ChangeAvailability':
        return { kind: 'ChangeAvailability', connectorId: num(p.connectorId) ?? -1, operative: p.type === 'Operative' };
      case 'TriggerMessage':
        return { kind: 'Trigger', message: str(p.requestedMessage) ?? '', connectorId: num(p.connectorId) };
      case 'GetConfiguration':
        return { kind: 'GetConfiguration', keys: Array.isArray(p.key) ? p.key.map(String) : undefined };
      case 'ChangeConfiguration':
        return { kind: 'ChangeConfiguration', key: str(p.key) ?? '', value: str(p.value) ?? '' };
      default:
        return { kind: 'Unsupported', action };
    }
  },
};

// ───────────────────────────── OCPP 2.0.1 / 2.1 ─────────────────────────────

/** ConnectorStatusEnumType de 2.x: los cinco estados "ocupados" de 1.6 son Occupied. */
const to201Status = (s: ConnectorStatus) =>
  s === 'Available' || s === 'Reserved' || s === 'Unavailable' || s === 'Faulted' ? s : 'Occupied';

/** ChargingStateEnumType de 2.x. */
const chargingState = (s: ConnectorStatus) =>
  s === 'Charging'
    ? 'Charging'
    : s === 'SuspendedEV'
      ? 'SuspendedEV'
      : s === 'SuspendedEVSE'
        ? 'SuspendedEVSE'
        : s === 'Available'
          ? 'Idle'
          : 'EVConnected';

/** sampledValue de 2.x: `value` numérico y `unitOfMeasure` como objeto. */
const meterValue201 = (s: Sample) => ({
  timestamp: s.timestamp,
  sampledValue: s.readings.map((r) => ({
    value: r.value,
    context: r.context,
    measurand: r.measurand,
    unitOfMeasure: { unit: r.unit },
    ...(r.location ? { location: r.location } : {}),
  })),
});

const STOP_201: Record<StopReason, { trigger: string; reason: string }> = {
  Local: { trigger: 'StopAuthorized', reason: 'Local' },
  Remote: { trigger: 'RemoteStop', reason: 'Remote' },
  EVDisconnected: { trigger: 'EVCommunicationLost', reason: 'EVDisconnected' },
  DeAuthorized: { trigger: 'Deauthorized', reason: 'DeAuthorized' },
  SoftReset: { trigger: 'ResetCommand', reason: 'Reboot' },
  HardReset: { trigger: 'ResetCommand', reason: 'ImmediateReset' },
  UnlockCommand: { trigger: 'UnlockCommand', reason: 'Other' },
  PowerLoss: { trigger: 'AbnormalCondition', reason: 'PowerLoss' },
};

const txEvent = (tx: TxRef, eventType: string, triggerReason: string, at: string, extra: Record<string, unknown>) => ({
  action: 'TransactionEvent',
  payload: {
    eventType,
    timestamp: at,
    triggerReason,
    seqNo: tx.seqNo,
    ...(tx.offline ? { offline: true } : {}),
    ...extra,
  },
});

const make201 = (protocol: EmuProtocol): OcppProfile => ({
  protocol,

  boot: (cfg, reason) => ({
    action: 'BootNotification',
    payload: {
      reason,
      chargingStation: {
        model: cfg.model.slice(0, 20),
        vendorName: cfg.vendor.slice(0, 50),
        ...(cfg.serialNumber ? { serialNumber: cfg.serialNumber.slice(0, 25) } : {}),
        ...(cfg.firmwareVersion ? { firmwareVersion: cfg.firmwareVersion.slice(0, 50) } : {}),
      },
    },
  }),
  compositeResult: (status, connectorId, s) =>
    status === 'Rejected' || !s
      ? { status: 'Rejected' }
      : {
          status,
          schedule: { evseId: connectorId, duration: s.duration, scheduleStart: s.scheduleStart, chargingRateUnit: s.unit, chargingSchedulePeriod: s.periods },
        },
  heartbeat: () => ({ action: 'Heartbeat', payload: {} }),
  statusKey: (status) => to201Status(status),
  statusNotification: (connectorId, status, _errorCode, _info, at) => ({
    action: 'StatusNotification',
    payload: { timestamp: at, connectorStatus: to201Status(status), evseId: connectorId, connectorId: 1 },
  }),
  authorize: (idTag, idTokenType) => ({ action: 'Authorize', payload: { idToken: { idToken: idTag, type: idTokenType } } }),
  authResult: (res) => {
    const info = obj(obj(res).idTokenInfo);
    return { status: str(info.status) ?? 'Invalid', parentIdTag: str(obj(info.groupIdToken).idToken) };
  },

  startTransaction: (tx, _meterStartWh, at, begin) =>
    txEvent(tx, 'Started', tx.startTrigger ?? 'Authorized', at, {
      transactionInfo: {
        transactionId: tx.transactionId,
        chargingState: chargingState(tx.status),
        ...(tx.remoteStartId !== undefined ? { remoteStartId: tx.remoteStartId } : {}),
      },
      idToken: { idToken: tx.idTag, type: tx.idTokenType },
      evse: { id: tx.connectorId, connectorId: 1 },
      ...(begin ? { meterValue: [meterValue201(begin)] } : {}),
    }),
  startResult: (res, tx) => {
    const info = obj(obj(res).idTokenInfo);
    return {
      transactionId: tx.transactionId,
      // Sin idTokenInfo en la respuesta, el idToken se considera aceptado.
      status: str(info.status) ?? 'Accepted',
      parentIdTag: str(obj(info.groupIdToken).idToken),
    };
  },

  txUpdate: (tx, trigger, at, sample) =>
    txEvent(tx, 'Updated', trigger, at, {
      transactionInfo: { transactionId: tx.transactionId, chargingState: chargingState(tx.status) },
      ...(sample ? { meterValue: [meterValue201(sample)] } : {}),
    }),
  meterValues: (connectorId, sample) => ({
    action: 'MeterValues',
    payload: { evseId: connectorId, meterValue: [meterValue201(sample)] },
  }),
  stopTransaction: (tx, reason, _meterStopWh, at, data, idTag) =>
    txEvent(tx, 'Ended', STOP_201[reason].trigger, at, {
      transactionInfo: {
        transactionId: tx.transactionId,
        stoppedReason: STOP_201[reason].reason,
        chargingState: chargingState(tx.status),
      },
      ...(idTag ? { idToken: { idToken: idTag, type: tx.idTokenType } } : {}),
      ...(data.length ? { meterValue: data.map(meterValue201) } : {}),
    }),
  idleStatus: (message) => ({
    action: message === 'DiagnosticsStatusNotification' ? 'LogStatusNotification' : message,
    payload: { status: 'Idle' },
  }),

  parseIncoming(action, payload) {
    const p = obj(payload);
    switch (action) {
      case 'RequestStartTransaction': {
        const token = obj(p.idToken);
        return {
          kind: 'RemoteStart',
          idTag: str(token.idToken) ?? '',
          idTokenType: str(token.type) ?? 'Central',
          connectorId: num(p.evseId),
          remoteStartId: num(p.remoteStartId),
          chargingProfile: p.chargingProfile === undefined ? undefined : parseProfile(p.chargingProfile, num(p.evseId) ?? 1, true),
        };
      }
      case 'SetChargingProfile':
        return { kind: 'SetChargingProfile', profile: parseProfile(p.chargingProfile, num(p.evseId) ?? -1, true) };
      case 'ClearChargingProfile': {
        const c = obj(p.chargingProfileCriteria);
        const purpose = str(c.chargingProfilePurpose);
        return {
          kind: 'ClearChargingProfile',
          id: num(p.chargingProfileId),
          connectorId: num(c.evseId),
          purpose: (purpose === 'ChargingStationMaxProfile' ? 'ChargePointMaxProfile' : purpose) as Purpose | undefined,
          stackLevel: num(c.stackLevel),
        };
      }
      case 'GetCompositeSchedule':
        return { kind: 'GetCompositeSchedule', connectorId: num(p.evseId) ?? -1, duration: num(p.duration) ?? 0, unit: str(p.chargingRateUnit) as RateUnit | undefined };
      case 'RequestStopTransaction':
        return { kind: 'RemoteStop', transactionId: String(p.transactionId) };
      case 'Reset':
        return { kind: 'Reset', graceful: p.type !== 'Immediate' };
      case 'UnlockConnector':
        return { kind: 'Unlock', connectorId: num(p.evseId) ?? -1 };
      case 'ChangeAvailability':
        return {
          kind: 'ChangeAvailability',
          connectorId: num(obj(p.evse).id) ?? 0,
          operative: p.operationalStatus === 'Operative',
        };
      case 'TriggerMessage':
        return { kind: 'Trigger', message: str(p.requestedMessage) ?? '', connectorId: num(obj(p.evse).id) };
      case 'GetVariables':
        return {
          kind: 'GetVariables',
          items: (Array.isArray(p.getVariableData) ? p.getVariableData : []).map((d) => {
            const o = obj(d);
            return { component: str(obj(o.component).name) ?? '', variable: str(obj(o.variable).name) ?? '', attributeType: str(o.attributeType) };
          }),
        };
      case 'SetVariables':
        return {
          kind: 'SetVariables',
          items: (Array.isArray(p.setVariableData) ? p.setVariableData : []).map((d) => {
            const o = obj(d);
            return {
              component: str(obj(o.component).name) ?? '',
              variable: str(obj(o.variable).name) ?? '',
              value: String(o.attributeValue ?? ''),
              attributeType: str(o.attributeType),
            };
          }),
        };
      default:
        return { kind: 'Unsupported', action };
    }
  },
});

const PROFILES: Record<EmuProtocol, OcppProfile> = {
  'ocpp1.6': ocpp16,
  'ocpp2.0.1': make201('ocpp2.0.1'),
  'ocpp2.1': make201('ocpp2.1'),
};

export const getProfile = (protocol: EmuProtocol): OcppProfile => PROFILES[protocol];
