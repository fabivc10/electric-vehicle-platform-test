import type { OcppVersion } from '../common/OcppVersion.js';
import { statusOf } from '../common/OcppVersion.js';
import { ocpp201Commands } from './commands.js';
import { ocpp201Handlers } from './handlers.js';

const base = {
  handlers: ocpp201Handlers,
  commands: ocpp201Commands,
  errorCode: (kind: string) => kind, // 2.x usa los nombres canónicos
  summarizeResponse: statusOf,
};

export const ocpp201: OcppVersion = { protocol: 'ocpp2.0.1', ...base };

/**
 * OCPP 2.1 es compatible hacia atrás con 2.0.1 en los mensajes núcleo (Boot, Status,
 * TransactionEvent...). Si hace falta algo propio de 2.1 (p. ej. V2X, NotifyDERAlarm),
 * se extiende el registro sin tocar 2.0.1:  handlers: { ...ocpp201Handlers, NuevaAccion }.
 */
export const ocpp21: OcppVersion = { protocol: 'ocpp2.1', ...base };
