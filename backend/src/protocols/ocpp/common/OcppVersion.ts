import type { ChargePointCommand, CommandResult, ProtocolId } from '@ev/shared';
import type { Payload, RpcErrorKind } from '../rpc/frames.js';
import type { HandlerRegistry } from './handler.js';

export type OcppProtocolId = Exclude<ProtocolId, 'mqtt'>;

export interface OutgoingCall {
  action: string;
  payload: Payload;
}

/** Adapter: traduce comandos de dominio a CALLs del protocolo y sus respuestas a CommandResult. */
export interface CommandMapper {
  toCall(command: ChargePointCommand): OutgoingCall;
  toResult(command: ChargePointCommand, response: unknown): CommandResult;
}

/**
 * Strategy por versión de OCPP: todo lo que cambia entre 1.6, 2.0.1 y 2.1 vive aquí.
 * La conexión RPC (OcppRpcConnection) es la misma para todas las versiones.
 */
export interface OcppVersion {
  readonly protocol: OcppProtocolId;
  readonly handlers: HandlerRegistry;
  readonly commands: CommandMapper;
  /** Nombre del código de error en esta versión (1.6 usa "FormationViolation", 2.x "FormatViolation"...). */
  errorCode(kind: RpcErrorKind): string;
  /** Resumen corto de la respuesta a un CALL saliente, para el panel de eventos. */
  summarizeResponse(response: unknown): string;
}

export const statusOf = (response: unknown): string => {
  if (response && typeof response === 'object' && 'status' in response) return String(response.status);
  return 'OK';
};

export const ACCEPTED_STATUSES = new Set(['Accepted', 'Unlocked', 'Scheduled', 'AcceptedCanceled', 'RebootRequired']);

export const defaultToResult = (_command: ChargePointCommand, response: unknown): CommandResult => {
  const status = statusOf(response);
  return { accepted: ACCEPTED_STATUSES.has(status) || status === 'OK', status, response };
};
