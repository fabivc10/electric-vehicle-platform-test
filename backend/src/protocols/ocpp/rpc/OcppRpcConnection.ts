import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { ChargePointCommand, CommandResult } from '@ev/shared';
import type { ChargePointConnection } from '../../../core/ports/ChargePointConnection.js';
import type { ActivityLog } from '../../../core/services/ActivityLog.js';
import type { ChargingService } from '../../../core/services/ChargingService.js';
import type { Logger } from '../../../shared/logger.js';
import type { OcppVersion } from '../common/OcppVersion.js';
import { commandText, rpcErrorText, where } from '../common/humanize.js';

const commandDetail = (c: ChargePointCommand): string | undefined => {
  switch (c.type) {
    case 'RemoteStart':
      return `${where(c.connectorId).toLowerCase()}, tarjeta ${c.idTag}`;
    case 'RemoteStop':
      return `#${c.transactionId}`;
    case 'Reset':
      return c.mode === 'Hard' ? 'completo' : 'suave';
    case 'ChangeAvailability':
      return `${where(c.connectorId).toLowerCase()} → ${c.available ? 'en servicio' : 'fuera de servicio'}`;
    case 'TriggerMessage':
      return c.message;
    case 'ChangeConfiguration':
      return `${c.key} = ${c.value}`;
    case 'SetChargingProfile':
      return `perfil #${c.profile.id} ${c.profile.purpose}, ${where(c.connectorId).toLowerCase()}`;
    case 'ClearChargingProfile':
      return c.id !== undefined ? `perfil #${c.id}` : 'según filtro';
    case 'GetCompositeSchedule':
      return `${where(c.connectorId).toLowerCase()}, ${c.duration} s`;
    case 'Raw':
      return c.action;
    default:
      return undefined;
  }
};
import {
  type Payload,
  FrameParseError,
  MessageType,
  OcppCallFailed,
  OcppError,
  encodeCall,
  encodeError,
  encodeResult,
  parseFrame,
} from './frames.js';

interface PendingCall {
  action: string;
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface OcppRpcDeps {
  charging: ChargingService;
  activity: ActivityLog;
  logger: Logger;
  callTimeoutMs: number;
}

/**
 * Una conexión WebSocket OCPP-J con un cargador. Es igual para todas las versiones;
 * lo específico (handlers, comandos, códigos de error) lo aporta `OcppVersion`.
 *
 * Reglas OCPP respetadas:
 *  - Los CALL entrantes se procesan en orden (cola serie) — p. ej. StartTransaction antes de MeterValues.
 *  - Solo un CALL saliente pendiente a la vez por conexión (cola serie con timeout).
 */
export class OcppRpcConnection implements ChargePointConnection {
  readonly protocol;
  private readonly pending = new Map<string, PendingCall>();
  private inboundQueue: Promise<void> = Promise.resolve();
  private outboundQueue: Promise<unknown> = Promise.resolve();
  private readonly log: Logger;

  constructor(
    readonly chargePointId: string,
    private readonly ws: WebSocket,
    private readonly version: OcppVersion,
    private readonly deps: OcppRpcDeps,
  ) {
    this.protocol = version.protocol;
    this.log = deps.logger.child(chargePointId);
    ws.on('message', (data) => this.onMessage(data.toString()));
    ws.on('close', () => this.rejectAllPending(new Error('Conexión cerrada')));
  }

  // ───────────────────────── Salida: comandos de dominio ─────────────────────────

  async execute(command: ChargePointCommand): Promise<CommandResult> {
    const { action, payload } = this.version.commands.toCall(command);
    try {
      const response = await this.call(action, payload);
      const result = this.version.commands.toResult(command, response);
      await this.deps.activity.record({
        chargePointId: this.chargePointId,
        direction: 'out',
        action,
        summary: this.version.summarizeResponse(response),
        message: commandText(command.type, result.status, commandDetail(command)),
        ok: result.accepted,
      });
      return result;
    } catch (error) {
      const status = error instanceof OcppCallFailed ? error.code : 'Timeout';
      await this.deps.activity.record({
        chargePointId: this.chargePointId,
        direction: 'out',
        action,
        summary: status,
        message: commandText(command.type, status === 'Timeout' ? 'Timeout' : status, commandDetail(command)),
        ok: false,
      });
      return { accepted: false, status, response: error instanceof Error ? error.message : undefined };
    }
  }

  /** Envía un CALL y espera su CALLRESULT/CALLERROR. Serializado: uno a la vez. */
  call(action: string, payload: Payload): Promise<unknown> {
    const run = () =>
      new Promise<unknown>((resolve, reject) => {
        if (this.ws.readyState !== this.ws.OPEN) return reject(new Error('Socket no está abierto'));
        const id = randomUUID();
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`Timeout esperando respuesta a ${action}`));
        }, this.deps.callTimeoutMs);
        this.pending.set(id, { action, resolve, reject, timer });
        this.send(encodeCall(id, action, payload));
      });
    const result = this.outboundQueue.then(run, run);
    this.outboundQueue = result.catch(() => undefined);
    return result;
  }

  close(reason = 'Cerrada por el servidor'): void {
    this.ws.close(1000, reason);
  }

  // ───────────────────────── Entrada ─────────────────────────

  /**
   * Las respuestas (CALLRESULT/CALLERROR) se resuelven de inmediato; solo los CALL/SEND
   * pasan por la cola serie. Así un handler podría esperar un CALL saliente sin deadlock.
   */
  private onMessage(raw: string): void {
    this.log.debug(`⇢ ${raw}`);
    let frame;
    try {
      frame = parseFrame(raw);
    } catch (error) {
      if (error instanceof FrameParseError && error.id) {
        this.send(encodeError(error.id, this.version.errorCode('FormatViolation'), error.message));
      } else {
        this.log.warn(`Mensaje descartado: ${(error as Error).message}`);
      }
      return;
    }

    switch (frame.type) {
      case MessageType.CALL:
      case MessageType.SEND: {
        const { type, id, action, payload } = frame;
        this.inboundQueue = this.inboundQueue
          .then(async () => {
            const reply = await this.dispatch(action, payload, id);
            if (type === MessageType.CALL) this.send(reply);
          })
          .catch((err) => this.log.error('Error procesando mensaje', err));
        return;
      }
      case MessageType.CALLRESULT:
        return this.settle(frame.id, (p) => p.resolve(frame.payload));
      case MessageType.CALLERROR:
      case MessageType.CALLRESULTERROR:
        return this.settle(frame.id, (p) =>
          p.reject(new OcppCallFailed(frame.code, frame.description || frame.code, frame.details)),
        );
    }
  }

  /** Valida y ejecuta el handler; devuelve el frame de respuesta ya serializado. */
  private async dispatch(action: string, payload: unknown, id: string): Promise<string> {
    const { charging, activity } = this.deps;
    const handler = this.version.handlers[action];

    try {
      if (!handler) throw new OcppError('NotImplemented', `Acción no soportada: ${action}`);
      if (action !== 'BootNotification' && (await charging.isRejected(this.chargePointId))) {
        throw new OcppError('SecurityError', 'El cargador fue rechazado en BootNotification');
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new OcppError('FormatViolation', 'El payload debe ser un objeto JSON');
      }
      const parsed = handler.schema.safeParse(payload);
      if (!parsed.success) {
        const issues = parsed.error.issues;
        throw new OcppError(errorKindFor(issues, payload), 'Payload inválido', {
          issues: issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }

      const outcome = await handler.handle({ chargePointId: this.chargePointId, charging }, parsed.data);
      await charging.touch(this.chargePointId);
      await activity.record({
        chargePointId: this.chargePointId,
        direction: 'in',
        action,
        summary: outcome.summary,
        message: outcome.message,
        ok: outcome.ok ?? true,
      });
      return encodeResult(id, outcome.response);
    } catch (error) {
      const ocppError =
        error instanceof OcppError ? error : new OcppError('InternalError', 'Error interno del CSMS');
      if (!(error instanceof OcppError)) this.log.error(`Fallo en handler ${action}`, error);
      await activity.record({
        chargePointId: this.chargePointId,
        direction: 'in',
        action,
        summary: ocppError.kind,
        message: rpcErrorText(ocppError.kind),
        ok: false,
      });
      return encodeError(id, this.version.errorCode(ocppError.kind), ocppError.message, ocppError.details);
    }
  }

  private settle(id: string, fn: (pending: PendingCall) => void): void {
    const pending = this.pending.get(id);
    if (!pending) {
      this.log.warn(`Respuesta sin CALL pendiente (${id})`);
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(id);
    fn(pending);
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private send(raw: string): void {
    this.log.debug(`⇠ ${raw}`);
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(raw);
  }
}

/**
 * Código CALLERROR según el tipo de violación (OCPP-J 1.6 §4.2.3 / 2.0.1 §4.3):
 * falta un campo requerido → OccurrenceConstraintViolation; tipo JSON incorrecto →
 * TypeConstraintViolation; largo, rango o valor fuera de la enumeración → PropertyConstraintViolation.
 */
const errorKindFor = (
  issues: readonly { code: string; path: readonly PropertyKey[]; format?: string }[],
  payload: unknown,
): 'OccurrenceConstraintViolation' | 'TypeConstraintViolation' | 'PropertyConstraintViolation' | 'FormatViolation' => {
  const first = issues[0];
  if (!first) return 'FormatViolation';
  if (first.code === 'invalid_type') {
    const value = first.path.reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<PropertyKey, unknown>)[k] : undefined), payload);
    return value === undefined ? 'OccurrenceConstraintViolation' : 'TypeConstraintViolation';
  }
  // dateTime mal formado = no cumple el tipo de dato (no un valor fuera de rango).
  if (first.code === 'invalid_format' && first.format === 'datetime') return 'TypeConstraintViolation';
  if (['too_big', 'too_small', 'invalid_value', 'invalid_format', 'not_multiple_of'].includes(first.code)) {
    return 'PropertyConstraintViolation';
  }
  return 'FormatViolation';
};
