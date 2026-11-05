import type { ChargePointCommand, CommandResult } from '@ev/shared';
import { ACCEPTED_STATUSES, type CommandMapper, type OutgoingCall, defaultToResult } from '../common/OcppVersion.js';

/** Variables estándar del Device Model equivalentes a las claves Core de 1.6. */
export const STANDARD_VARIABLES = [
  'OCPPCommCtrlr.HeartbeatInterval',
  'OCPPCommCtrlr.MessageAttempts',
  'OCPPCommCtrlr.MessageAttemptInterval',
  'AuthCtrlr.AuthorizeRemoteStart',
  'AuthCtrlr.LocalAuthorizeOffline',
  'AuthCtrlr.LocalPreAuthorize',
  'TxCtrlr.EVConnectionTimeOut',
  'TxCtrlr.StopTxOnEVSideDisconnect',
  'TxCtrlr.StopTxOnInvalidId',
  'SampledDataCtrlr.TxStartedMeasurands',
  'SampledDataCtrlr.TxUpdatedMeasurands',
  'SampledDataCtrlr.TxUpdatedInterval',
  'SampledDataCtrlr.TxEndedMeasurands',
  'SampledDataCtrlr.TxEndedInterval',
  'AlignedDataCtrlr.Interval',
  'AlignedDataCtrlr.Measurands',
  'AlignedDataCtrlr.TxEndedMeasurands',
];

const splitKey = (key: string) => {
  const i = key.indexOf('.');
  return { component: { name: i > 0 ? key.slice(0, i) : key }, variable: { name: i > 0 ? key.slice(i + 1) : '' } };
};
const joinKey = (r: { component?: { name?: string }; variable?: { name?: string } }) =>
  `${r.component?.name ?? ''}.${r.variable?.name ?? ''}`;

type VarResult = { attributeStatus: string; attributeValue?: string; component?: { name?: string }; variable?: { name?: string } };

const toResult201 = (command: ChargePointCommand, response: unknown): CommandResult => {
  if (command.type === 'GetConfiguration') {
    const results = ((response ?? {}) as { getVariableResult?: VarResult[] }).getVariableResult ?? [];
    return {
      accepted: true,
      status: 'OK',
      response,
      // El Device Model no expone "readonly" en GetVariables (haría falta GetReport).
      configuration: results
        .filter((r) => r.attributeStatus === 'Accepted')
        .map((r) => ({ key: joinKey(r), value: r.attributeValue, readonly: false })),
      unknownKeys: results.filter((r) => r.attributeStatus !== 'Accepted').map((r) => `${joinKey(r)} (${r.attributeStatus})`),
    };
  }
  if (command.type === 'ChangeConfiguration') {
    const first = ((response ?? {}) as { setVariableResult?: VarResult[] }).setVariableResult?.[0];
    const status = first?.attributeStatus ?? 'Unknown';
    return { accepted: ACCEPTED_STATUSES.has(status), status, response };
  }
  if (command.type === 'GetCompositeSchedule') {
    const r = (response ?? {}) as {
      status?: string;
      schedule?: { evseId?: number; duration?: number; scheduleStart?: string; chargingRateUnit?: 'A' | 'W'; chargingSchedulePeriod?: { startPeriod: number; limit: number; numberPhases?: number }[] };
    };
    const status = r.status ?? 'Unknown';
    return {
      accepted: status === 'Accepted',
      status,
      response,
      compositeSchedule: r.schedule
        ? {
            connectorId: r.schedule.evseId ?? command.connectorId,
            scheduleStart: r.schedule.scheduleStart,
            duration: r.schedule.duration,
            unit: r.schedule.chargingRateUnit,
            periods: r.schedule.chargingSchedulePeriod ?? [],
          }
        : undefined,
    };
  }
  return defaultToResult(command, response);
};

const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

let remoteStartId = 0;

/** Comandos de dominio → acciones CSMS → Charging Station de OCPP 2.0.1 / 2.1. */
export const ocpp201Commands: CommandMapper = {
  toCall(command: ChargePointCommand): OutgoingCall {
    switch (command.type) {
      case 'RemoteStart':
        return {
          action: 'RequestStartTransaction',
          payload: {
            idToken: { idToken: command.idTag, type: 'Central' },
            remoteStartId: ++remoteStartId,
            evseId: command.connectorId,
          },
        };
      case 'RemoteStop':
        return { action: 'RequestStopTransaction', payload: { transactionId: command.transactionId } };
      case 'Reset':
        return { action: 'Reset', payload: { type: command.mode === 'Hard' ? 'Immediate' : 'OnIdle' } };
      case 'UnlockConnector':
        return { action: 'UnlockConnector', payload: { evseId: command.connectorId, connectorId: 1 } };
      case 'ChangeAvailability':
        return {
          action: 'ChangeAvailability',
          payload: {
            operationalStatus: command.available ? 'Operative' : 'Inoperative',
            ...(command.connectorId > 0 ? { evse: { id: command.connectorId } } : {}),
          },
        };
      case 'TriggerMessage':
        return {
          action: 'TriggerMessage',
          payload: {
            requestedMessage: command.message,
            ...(command.connectorId ? { evse: { id: command.connectorId } } : {}),
          },
        };
      case 'GetConfiguration':
        return {
          action: 'GetVariables',
          payload: { getVariableData: (command.keys?.length ? command.keys : STANDARD_VARIABLES).map(splitKey) },
        };
      case 'ChangeConfiguration':
        return {
          action: 'SetVariables',
          payload: { setVariableData: [{ attributeValue: command.value, ...splitKey(command.key) }] },
        };
      case 'SetChargingProfile': {
        const p = command.profile;
        const s = p.schedule;
        return {
          action: 'SetChargingProfile',
          payload: {
            evseId: command.connectorId,
            chargingProfile: strip({
              id: p.id,
              stackLevel: p.stackLevel,
              chargingProfilePurpose: p.purpose === 'ChargePointMaxProfile' ? 'ChargingStationMaxProfile' : p.purpose,
              chargingProfileKind: p.kind,
              recurrencyKind: p.recurrencyKind,
              validFrom: p.validFrom,
              validTo: p.validTo,
              transactionId: p.transactionId,
              chargingSchedule: [
                strip({
                  id: p.id,
                  startSchedule: s.startSchedule,
                  duration: s.duration,
                  chargingRateUnit: s.unit,
                  chargingSchedulePeriod: s.periods.map((x) => strip({ startPeriod: x.startPeriod, limit: x.limit, numberPhases: x.numberPhases })),
                  minChargingRate: s.minChargingRate,
                }),
              ],
            }),
          },
        };
      }
      case 'ClearChargingProfile': {
        const criteria = strip({
          evseId: command.connectorId,
          chargingProfilePurpose: command.purpose === 'ChargePointMaxProfile' ? 'ChargingStationMaxProfile' : command.purpose,
          stackLevel: command.stackLevel,
        });
        return {
          action: 'ClearChargingProfile',
          payload: strip({ chargingProfileId: command.id, chargingProfileCriteria: Object.keys(criteria).length ? criteria : undefined }),
        };
      }
      case 'GetCompositeSchedule':
        return {
          action: 'GetCompositeSchedule',
          payload: strip({ duration: command.duration, chargingRateUnit: command.unit, evseId: command.connectorId }),
        };
      case 'Raw':
        return { action: command.action, payload: command.payload };
    }
  },
  toResult: toResult201,
};
