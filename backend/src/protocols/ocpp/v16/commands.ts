import type { ChargePointCommand, ChargingProfileInput, CommandResult } from '@ev/shared';
import { AppError } from '../../../core/errors.js';
import { type CommandMapper, type OutgoingCall, defaultToResult } from '../common/OcppVersion.js';

/** GetConfiguration.conf (§5.8) → entradas normalizadas. */
const configurationResult = (response: unknown): CommandResult => {
  const r = (response ?? {}) as { configurationKey?: { key: string; readonly: boolean; value?: string }[]; unknownKey?: string[] };
  return {
    accepted: true,
    status: 'OK',
    response,
    configuration: (r.configurationKey ?? []).map((k) => ({ key: k.key, value: k.value, readonly: Boolean(k.readonly) })),
    unknownKeys: r.unknownKey ?? [],
  };
};

/** §7.15–7.17: los CiString de 1.6 son más cortos que los de 2.x; se valida antes de enviar. */
const ciString = (field: string, value: string, max: number) => {
  if (value.length > max) {
    throw new AppError(400, 'OCPP16_FIELD_TOO_LONG', `${field} supera CiString${max}Type en OCPP 1.6 (${value.length} caracteres)`);
  }
  return value;
};

const stripUndef = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** §7.13 ChargingSchedule (los opcionales se omiten si no vienen). */
const schedule = (s: ChargingProfileInput['schedule']) =>
  stripUndef({
    duration: s.duration,
    startSchedule: s.startSchedule,
    chargingRateUnit: s.unit,
    chargingSchedulePeriod: s.periods.map((x) => stripUndef({ startPeriod: x.startPeriod, limit: x.limit, numberPhases: x.numberPhases })),
    minChargingRate: s.minChargingRate,
  });

/** GetCompositeSchedule.conf (§6.25) → dominio. */
const compositeResult16 = (command: Extract<ChargePointCommand, { type: 'GetCompositeSchedule' }>, response: unknown): CommandResult => {
  const r = (response ?? {}) as {
    status?: string;
    connectorId?: number;
    scheduleStart?: string;
    chargingSchedule?: { duration?: number; chargingRateUnit?: 'A' | 'W'; chargingSchedulePeriod?: { startPeriod: number; limit: number; numberPhases?: number }[] };
  };
  const status = r.status ?? 'Unknown';
  return {
    accepted: status === 'Accepted',
    status,
    response,
    compositeSchedule: r.chargingSchedule
      ? {
          connectorId: r.connectorId ?? command.connectorId,
          scheduleStart: r.scheduleStart,
          duration: r.chargingSchedule.duration,
          unit: r.chargingSchedule.chargingRateUnit,
          periods: r.chargingSchedule.chargingSchedulePeriod ?? [],
        }
      : undefined,
  };
};

/** Comandos de dominio → acciones Central System → Charge Point de OCPP 1.6 (sección 5). */
export const ocpp16Commands: CommandMapper = {
  toCall(command: ChargePointCommand): OutgoingCall {
    switch (command.type) {
      case 'RemoteStart':
        return {
          action: 'RemoteStartTransaction',
          payload: { connectorId: command.connectorId, idTag: ciString('idTag', command.idTag, 20) },
        };
      case 'RemoteStop':
        return { action: 'RemoteStopTransaction', payload: { transactionId: Number(command.transactionId) } };
      case 'Reset':
        return { action: 'Reset', payload: { type: command.mode } };
      case 'UnlockConnector':
        return { action: 'UnlockConnector', payload: { connectorId: command.connectorId } };
      case 'ChangeAvailability':
        return {
          action: 'ChangeAvailability',
          payload: { connectorId: command.connectorId, type: command.available ? 'Operative' : 'Inoperative' },
        };
      case 'TriggerMessage':
        return {
          action: 'TriggerMessage',
          // §6.53: connectorId es opcional y > 0; para el cargador completo se omite.
          payload: { requestedMessage: command.message, ...(command.connectorId ? { connectorId: command.connectorId } : {}) },
        };
      case 'GetConfiguration':
        return {
          action: 'GetConfiguration',
          payload: command.keys?.length ? { key: command.keys.map((k) => ciString('key', k, 50)) } : {},
        };
      case 'ChangeConfiguration':
        return {
          action: 'ChangeConfiguration',
          payload: { key: ciString('key', command.key, 50), value: ciString('value', command.value, 500) },
        };
      case 'SetChargingProfile': {
        const p = command.profile;
        // §7.8: chargingProfileId, stackLevel, purpose, kind y chargingSchedule son 1..1.
        return {
          action: 'SetChargingProfile',
          payload: {
            connectorId: command.connectorId,
            csChargingProfiles: {
              chargingProfileId: p.id,
              ...(p.transactionId ? { transactionId: Number(p.transactionId) } : {}),
              stackLevel: p.stackLevel,
              chargingProfilePurpose: p.purpose,
              chargingProfileKind: p.kind,
              ...(p.recurrencyKind ? { recurrencyKind: p.recurrencyKind } : {}),
              ...(p.validFrom ? { validFrom: p.validFrom } : {}),
              ...(p.validTo ? { validTo: p.validTo } : {}),
              chargingSchedule: schedule(p.schedule),
            },
          },
        };
      }
      case 'ClearChargingProfile':
        return {
          action: 'ClearChargingProfile',
          payload: stripUndef({ id: command.id, connectorId: command.connectorId, chargingProfilePurpose: command.purpose, stackLevel: command.stackLevel }),
        };
      case 'GetCompositeSchedule':
        return {
          action: 'GetCompositeSchedule',
          payload: stripUndef({ connectorId: command.connectorId, duration: command.duration, chargingRateUnit: command.unit }),
        };
      case 'Raw':
        return { action: command.action, payload: command.payload };
    }
  },
  toResult: (command, response) =>
    command.type === 'GetConfiguration'
      ? configurationResult(response)
      : command.type === 'GetCompositeSchedule'
        ? compositeResult16(command, response)
        : defaultToResult(command, response),
};
