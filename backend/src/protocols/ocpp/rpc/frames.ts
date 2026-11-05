/**
 * Framing OCPP-J (JSON sobre WebSocket), común a 1.6, 2.0.1 y 2.1.
 *   CALL            [2, uniqueId, action, payload]
 *   CALLRESULT      [3, uniqueId, payload]
 *   CALLERROR       [4, uniqueId, errorCode, errorDescription, errorDetails]
 *   CALLRESULTERROR [5, uniqueId, errorCode, errorDescription, errorDetails]  (solo 2.1)
 *   SEND            [6, uniqueId, action, payload]                            (solo 2.1, sin respuesta)
 */
export const MessageType = {
  CALL: 2,
  CALLRESULT: 3,
  CALLERROR: 4,
  CALLRESULTERROR: 5,
  SEND: 6,
} as const;

export type Payload = Record<string, unknown>;

export type Frame =
  | { type: typeof MessageType.CALL; id: string; action: string; payload: unknown }
  | { type: typeof MessageType.SEND; id: string; action: string; payload: unknown }
  | { type: typeof MessageType.CALLRESULT; id: string; payload: unknown }
  | {
      type: typeof MessageType.CALLERROR | typeof MessageType.CALLRESULTERROR;
      id: string;
      code: string;
      description: string;
      details: unknown;
    };

/** Códigos genéricos; cada versión los traduce a su vocabulario (ver OcppVersion.errorCode). */
export type RpcErrorKind =
  | 'NotImplemented'
  | 'NotSupported'
  | 'InternalError'
  | 'ProtocolError'
  | 'SecurityError'
  | 'FormatViolation'
  | 'PropertyConstraintViolation'
  | 'OccurrenceConstraintViolation'
  | 'TypeConstraintViolation'
  | 'GenericError';

/** Error que se responde al cargador como CALLERROR. */
export class OcppError extends Error {
  constructor(
    public readonly kind: RpcErrorKind,
    message: string,
    public readonly details: Payload = {},
  ) {
    super(message);
    this.name = 'OcppError';
  }
}

/** Error recibido del cargador como respuesta a un CALL nuestro. */
export class OcppCallFailed extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'OcppCallFailed';
  }
}

export class FrameParseError extends Error {
  constructor(
    message: string,
    /** uniqueId si se pudo extraer, para poder responder CALLERROR. */
    public readonly id?: string,
  ) {
    super(message);
  }
}

export const parseFrame = (raw: string): Frame => {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new FrameParseError('JSON inválido');
  }
  if (!Array.isArray(data) || data.length < 3) throw new FrameParseError('El mensaje no es un arreglo OCPP-J');

  const [type, id] = data;
  if (typeof id !== 'string') throw new FrameParseError('uniqueId inválido');

  switch (type) {
    case MessageType.CALL:
    case MessageType.SEND:
      if (typeof data[2] !== 'string') throw new FrameParseError('action inválida', id);
      return { type, id, action: data[2], payload: data[3] ?? {} };
    case MessageType.CALLRESULT:
      return { type, id, payload: data[2] };
    case MessageType.CALLERROR:
    case MessageType.CALLRESULTERROR:
      return { type, id, code: String(data[2]), description: String(data[3] ?? ''), details: data[4] ?? {} };
    default:
      throw new FrameParseError(`MessageTypeId desconocido: ${String(type)}`, id);
  }
};

export const encodeCall = (id: string, action: string, payload: Payload) =>
  JSON.stringify([MessageType.CALL, id, action, payload]);

export const encodeResult = (id: string, payload: unknown) => JSON.stringify([MessageType.CALLRESULT, id, payload]);

export const encodeError = (id: string, code: string, description: string, details: Payload = {}) =>
  JSON.stringify([MessageType.CALLERROR, id, code, description, details]);
