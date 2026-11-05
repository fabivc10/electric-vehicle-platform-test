import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ActivityLog } from '../../core/services/ActivityLog.js';
import type { ChargingService } from '../../core/services/ChargingService.js';
import type { ConnectionRegistry } from '../../core/services/ConnectionRegistry.js';
import type { Logger } from '../../shared/logger.js';
import type { ProtocolGateway } from '../ProtocolGateway.js';
import type { OcppProtocolId } from './common/OcppVersion.js';
import { getOcppVersion, isSupportedSubprotocol, negotiateSubprotocol } from './OcppVersionFactory.js';
import { OcppRpcConnection } from './rpc/OcppRpcConnection.js';

export interface OcppGatewayDeps {
  charging: ChargingService;
  activity: ActivityLog;
  connections: ConnectionRegistry;
  logger: Logger;
  defaultProtocol: OcppProtocolId;
  callTimeoutMs: number;
  /** Prefijo de ruta: ws://host:port/ocpp/{chargePointId} */
  pathPrefix?: string;
}

const PING_INTERVAL_MS = 30_000;

export class OcppGateway implements ProtocolGateway {
  readonly name = 'ocpp';
  private readonly wss: WebSocketServer;
  private readonly prefix: string;
  private pingTimer?: NodeJS.Timeout;
  private readonly alive = new WeakMap<WebSocket, boolean>();

  constructor(private readonly deps: OcppGatewayDeps) {
    this.prefix = deps.pathPrefix ?? '/ocpp/';
    this.wss = new WebSocketServer({
      noServer: true,
      handleProtocols: (offered) => negotiateSubprotocol(offered) ?? false,
    });
  }

  matches(pathname: string): boolean {
    return pathname.startsWith(this.prefix);
  }

  /** Llamado desde el evento `upgrade` del servidor HTTP. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const chargePointId = decodeURIComponent(url.pathname.slice(this.prefix.length).split('/').filter(Boolean).at(-1) ?? '');

    if (!chargePointId) return reject(socket, 400, 'Falta el identificador del cargador en la URL');

    const offered = (req.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (offered.length && !negotiateSubprotocol(offered)) {
      return reject(socket, 400, `Subprotocolo no soportado: ${offered.join(', ')}`);
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      void this.onConnection(ws, chargePointId);
    });
  }

  private async onConnection(ws: WebSocket, chargePointId: string): Promise<void> {
    const { charging, connections, logger } = this.deps;
    // Muchos cargadores 1.6 no envían Sec-WebSocket-Protocol: se asume el protocolo por defecto.
    const protocol = isSupportedSubprotocol(ws.protocol) ? ws.protocol : this.deps.defaultProtocol;

    const connection = new OcppRpcConnection(chargePointId, ws, getOcppVersion(protocol), {
      charging,
      activity: this.deps.activity,
      logger: logger.child('rpc'),
      callTimeoutMs: this.deps.callTimeoutMs,
    });

    this.alive.set(ws, true);
    ws.on('pong', () => this.alive.set(ws, true));
    ws.on('close', (code) => {
      logger.info(`${chargePointId} desconectado (${code})`);
      if (connections.unregister(connection)) void charging.disconnected(chargePointId);
    });
    ws.on('error', (err) => logger.warn(`${chargePointId} error de socket: ${err.message}`));

    connections.register(connection);
    await charging.connected(chargePointId, protocol);
    logger.info(`${chargePointId} conectado vía ${protocol}`);
  }

  async start(): Promise<void> {
    // Keep-alive a nivel WebSocket: detecta sockets muertos aunque el cargador no cierre.
    this.pingTimer = setInterval(() => {
      for (const ws of this.wss.clients) {
        if (this.alive.get(ws) === false) {
          ws.terminate();
          continue;
        }
        this.alive.set(ws, false);
        ws.ping();
      }
    }, PING_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    clearInterval(this.pingTimer);
    for (const ws of this.wss.clients) ws.close(1001, 'Servidor detenido');
    this.wss.close();
  }
}

const reject = (socket: Duplex, status: number, message: string) => {
  socket.write(`HTTP/1.1 ${status} Bad Request\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${message}`);
  socket.destroy();
};
