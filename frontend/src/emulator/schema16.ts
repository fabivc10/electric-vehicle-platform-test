import { RpcError } from './rpc';

/**
 * Validación de los .req que el Central System envía al Charge Point en OCPP 1.6
 * (campos, cardinalidad y tamaños de §6; tipos CiString20/25/50/255/500 de §7.15–7.19;
 * enumeraciones de §7). Un payload inválido se responde con el CALLERROR que corresponde
 * según OCPP-J 1.6 (nombres con la errata oficial):
 *   - no es un objeto / campo desconocido → FormationViolation
 *   - falta un campo requerido (1..1)     → OccurenceConstraintViolation
 *   - tipo JSON incorrecto                → TypeConstraintViolation
 *   - largo, rango o valor fuera del enum → PropertyConstraintViolation
 */

type Field =
  | { t: 'int'; req?: boolean; min?: number }
  | { t: 'string'; req?: boolean; max: number }
  | { t: 'enum'; req?: boolean; values: readonly string[] }
  | { t: 'dateTime'; req?: boolean }
  | { t: 'object'; req?: boolean }
  | { t: 'stringArray'; req?: boolean; max: number };

type Schema = Record<string, Field>;

export const CI = { s20: 20, s25: 25, s50: 50, s255: 255, s500: 500 } as const;

const MESSAGE_TRIGGER = [
  'BootNotification',
  'DiagnosticsStatusNotification',
  'FirmwareStatusNotification',
  'Heartbeat',
  'MeterValues',
  'StatusNotification',
] as const;

/** §6: mensajes iniciados por el Central System que el emulador implementa. */
export const CS_REQUESTS: Record<string, Schema> = {
  RemoteStartTransaction: {
    connectorId: { t: 'int', min: 1 },
    idTag: { t: 'string', req: true, max: CI.s20 },
    chargingProfile: { t: 'object' },
  },
  RemoteStopTransaction: { transactionId: { t: 'int', req: true } },
  Reset: { type: { t: 'enum', req: true, values: ['Hard', 'Soft'] } },
  UnlockConnector: { connectorId: { t: 'int', req: true, min: 1 } },
  ChangeAvailability: {
    connectorId: { t: 'int', req: true, min: 0 },
    type: { t: 'enum', req: true, values: ['Inoperative', 'Operative'] },
  },
  TriggerMessage: {
    requestedMessage: { t: 'enum', req: true, values: MESSAGE_TRIGGER },
    connectorId: { t: 'int', min: 1 },
  },
  GetConfiguration: { key: { t: 'stringArray', max: CI.s50 } },
  ChangeConfiguration: { key: { t: 'string', req: true, max: CI.s50 }, value: { t: 'string', req: true, max: CI.s500 } },
  // §6.43 / §6.9 / §6.23 (el contenido del perfil se valida en profiles.ts con §7.8–7.14)
  SetChargingProfile: { connectorId: { t: 'int', req: true, min: 0 }, csChargingProfiles: { t: 'object', req: true } },
  ClearChargingProfile: {
    id: { t: 'int' },
    connectorId: { t: 'int', min: 0 },
    chargingProfilePurpose: { t: 'enum', values: ['ChargePointMaxProfile', 'TxDefaultProfile', 'TxProfile'] },
    stackLevel: { t: 'int', min: 0 },
  },
  GetCompositeSchedule: {
    connectorId: { t: 'int', req: true, min: 0 },
    duration: { t: 'int', req: true, min: 0 },
    chargingRateUnit: { t: 'enum', values: ['A', 'W'] },
  },
  DataTransfer: {
    vendorId: { t: 'string', req: true, max: CI.s255 },
    messageId: { t: 'string', max: CI.s50 },
    data: { t: 'string', max: Number.MAX_SAFE_INTEGER },
  },
};

/** Acciones de 1.6 que existen en la spec pero este equipo no soporta (perfiles no declarados). */
export const KNOWN_UNSUPPORTED_16 = new Set([
  'CancelReservation',
  'ClearCache',
  'GetDiagnostics',
  'GetLocalListVersion',
  'ReserveNow',
  'SendLocalList',
  'UpdateFirmware',
]);

const fail = (code: string, msg: string) => new RpcError(code, msg);

/** Lanza RpcError con el código OCPP-J 1.6 adecuado si el payload no cumple §6. */
export const validate16 = (action: string, payload: unknown): void => {
  const schema = CS_REQUESTS[action];
  if (!schema) return;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw fail('FormationViolation', `${action}: el payload debe ser un objeto JSON`);
  }
  const p = payload as Record<string, unknown>;
  for (const k of Object.keys(p)) {
    if (!(k in schema)) throw fail('FormationViolation', `${action}: campo no definido en §6 "${k}"`);
  }
  for (const [name, f] of Object.entries(schema)) {
    const v = p[name];
    if (v === undefined || v === null) {
      if (f.req) throw fail('OccurenceConstraintViolation', `${action}.${name} es requerido (1..1)`);
      continue;
    }
    switch (f.t) {
      case 'int':
        if (typeof v !== 'number' || !Number.isInteger(v)) throw fail('TypeConstraintViolation', `${action}.${name} debe ser integer`);
        if (f.min !== undefined && v < f.min) throw fail('PropertyConstraintViolation', `${action}.${name} debe ser ≥ ${f.min}`);
        break;
      case 'string':
        if (typeof v !== 'string') throw fail('TypeConstraintViolation', `${action}.${name} debe ser string`);
        if (v.length > f.max) throw fail('PropertyConstraintViolation', `${action}.${name} supera CiString${f.max} (${v.length} caracteres)`);
        break;
      case 'enum':
        if (typeof v !== 'string') throw fail('TypeConstraintViolation', `${action}.${name} debe ser string`);
        if (!f.values.includes(v)) throw fail('PropertyConstraintViolation', `${action}.${name} "${v}" no es uno de: ${f.values.join(', ')}`);
        break;
      case 'dateTime':
        if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) throw fail('TypeConstraintViolation', `${action}.${name} debe ser dateTime`);
        break;
      case 'object':
        if (typeof v !== 'object' || Array.isArray(v)) throw fail('TypeConstraintViolation', `${action}.${name} debe ser un objeto`);
        break;
      case 'stringArray':
        if (!Array.isArray(v)) throw fail('TypeConstraintViolation', `${action}.${name} debe ser un arreglo`);
        for (const it of v) {
          if (typeof it !== 'string') throw fail('TypeConstraintViolation', `${action}.${name}[] debe ser string`);
          if (it.length > f.max) throw fail('PropertyConstraintViolation', `${action}.${name}[] supera CiString${f.max}`);
        }
        break;
    }
  }
};
