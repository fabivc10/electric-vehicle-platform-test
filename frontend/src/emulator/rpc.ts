import type { FrameEntry, FrameKind } from './types';

/** Error OCPP-J (CALLERROR) recibido o a enviar. */
export class RpcError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface RpcClientHandlers {
  onFrame(entry: Omit<FrameEntry, 'seq'>): void;
  /**
   * CALL entrante del CSMS. Devuelve el payload de la respuesta o lanza RpcError.
   * `null` = no responder (con Boot Rejected el cargador no responde nada, §4.2).
   */
  onCall(action: string, payload: unknown): Promise<{ response: Record<string, unknown>; after?: () => void } | null>;
  onClose(code: number, reason: string): void;
}

interface Pending {
  action: string;
  sentAt: number;
  resolve(payload: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();

/**
 * Cliente OCPP-J sobre el WebSocket del navegador (lado cargador).
 * Respeta las mismas reglas que el CSMS: un solo CALL saliente pendiente a la vez
 * (cola serie con timeout) y respuestas a CALL entrantes fuera de esa cola.
 */
export class OcppRpcClient {
  private ws?: WebSocket;
  private readonly pending = new Map<string, Pending>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly handlers: RpcClientHandlers,
    private readonly timeoutMs = 30_000,
  ) {}

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Abre el socket ofreciendo un subprotocolo. Resuelve con el subprotocolo negociado. */
  connect(url: string, subprotocol: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let opened = false;
      const ws = new WebSocket(url, [subprotocol]);
      this.ws = ws;
      ws.onopen = () => {
        opened = true;
        resolve(ws.protocol);
      };
      ws.onmessage = (msg) => void this.onMessage(String(msg.data));
      ws.onclose = (ev) => {
        if (this.ws === ws) this.ws = undefined;
        this.rejectAll(new Error('Conexión cerrada'));
        if (!opened) {
          reject(new Error('El CSMS rechazó la conexión (URL o subprotocolo inválidos, o servidor caído)'));
          return;
        }
        this.handlers.onClose(ev.code, ev.reason);
      };
    });
  }

  close(code = 1000, reason = 'Cerrado por el usuario') {
    this.ws?.close(code, reason);
  }

  /** Envía un CALL y espera la respuesta. Las llamadas se encolan en serie. */
  call<T = Record<string, unknown>>(action: string, payload: Record<string, unknown>): Promise<T> {
    const run = () =>
      new Promise<T>((resolve, reject) => {
        if (!this.ws || !this.isOpen) return reject(new Error('Sin conexión con el CSMS'));
        const id = newId();
        const timer = setTimeout(() => {
          this.pending.delete(id);
          this.log('sys', 'INFO', `Timeout esperando respuesta a ${action}`, { action, messageId: id, error: true });
          reject(new RpcError('Timeout', `Sin respuesta a ${action} en ${this.timeoutMs / 1000} s`));
        }, this.timeoutMs);
        this.pending.set(id, { action, sentAt: performance.now(), resolve: resolve as (p: unknown) => void, reject, timer });
        this.sendFrame([2, id, action, payload], 'CALL', { action, messageId: id });
      });
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Envía texto tal cual (para probar frames mal formados). */
  sendRaw(text: string) {
    if (!this.ws || !this.isOpen) throw new Error('Sin conexión con el CSMS');
    this.ws.send(text);
    this.log('tx', 'RAW', text);
  }

  /** Latencia simulada de la red móvil/WiFi del equipo (ms por frame saliente). 0 = inmediato. */
  latency: () => number = () => 0;
  private outChain: Promise<void> = Promise.resolve();

  private sendFrame(frame: unknown[], kind: FrameKind, meta: Partial<FrameEntry> = {}) {
    const text = JSON.stringify(frame);
    const delay = this.latency();
    if (delay <= 0) {
      this.ws?.send(text);
      this.log('tx', kind, text, meta);
      return;
    }
    // Encadenado: con latencia variable los frames no se reordenan (TCP/WebSocket mantiene el orden).
    this.outChain = this.outChain.then(
      () =>
        new Promise<void>((res) =>
          setTimeout(() => {
            if (this.isOpen) {
              this.ws?.send(text);
              this.log('tx', kind, text, { ...meta, latencyMs: delay });
            }
            res();
          }, delay),
        ),
    );
  }

  private log(dir: FrameEntry['dir'], kind: FrameKind, text: string, meta: Partial<FrameEntry> = {}) {
    this.handlers.onFrame({ at: now(), dir, kind, text, ...meta });
  }

  private async onMessage(text: string) {
    let frame: unknown;
    try {
      frame = JSON.parse(text);
    } catch {
      this.log('rx', 'RAW', text, { error: true });
      return;
    }
    if (!Array.isArray(frame) || typeof frame[1] !== 'string') {
      this.log('rx', 'RAW', text, { error: true });
      return;
    }
    const [type, id] = frame as [number, string, ...unknown[]];

    if (type === 2) {
      const action = String(frame[2]);
      this.log('rx', 'CALL', text, { action, messageId: id });
      try {
        const result = await this.handlers.onCall(action, frame[3]);
        if (!result) {
          this.log('sys', 'INFO', `${action} ignorado: BootNotification Rejected (§4.2)`, { action, messageId: id });
          return;
        }
        this.sendFrame([3, id, result.response], 'CALLRESULT', { action, messageId: id });
        // §5.17: la respuesta sale antes que el mensaje solicitado / el efecto del comando.
        result.after?.();
      } catch (e) {
        const err = e instanceof RpcError ? e : new RpcError('InternalError', (e as Error).message);
        this.sendFrame([4, id, err.code, err.message, {}], 'CALLERROR', { action, messageId: id, error: true });
      }
      return;
    }

    // 3 = CALLRESULT, 4 = CALLERROR, 5 = CALLRESULTERROR (2.1)
    const p = this.pending.get(id);
    const latencyMs = p ? Math.round(performance.now() - p.sentAt) : undefined;
    const isError = type === 4 || type === 5;
    this.log('rx', isError ? 'CALLERROR' : 'CALLRESULT', text, {
      action: p?.action,
      messageId: id,
      latencyMs,
      error: isError,
    });
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    if (type === 3) p.resolve(frame[2]);
    else p.reject(new RpcError(String(frame[2]), String(frame[3] ?? '')));
  }

  private rejectAll(error: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
}
