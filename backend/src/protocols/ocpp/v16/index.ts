import type { OcppVersion } from '../common/OcppVersion.js';
import { statusOf } from '../common/OcppVersion.js';
import type { RpcErrorKind } from '../rpc/frames.js';
import { ocpp16Commands } from './commands.js';
import { ocpp16Handlers } from './handlers.js';

/** OCPP 1.6 conserva dos nombres históricos (con errata incluida) en sus códigos de error. */
const ERROR_CODES_16: Partial<Record<RpcErrorKind, string>> = {
  FormatViolation: 'FormationViolation',
  OccurrenceConstraintViolation: 'OccurenceConstraintViolation',
};

export const ocpp16: OcppVersion = {
  protocol: 'ocpp1.6',
  handlers: ocpp16Handlers,
  commands: ocpp16Commands,
  errorCode: (kind) => ERROR_CODES_16[kind] ?? kind,
  summarizeResponse: statusOf,
};
