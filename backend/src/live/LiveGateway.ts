import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { EventBus } from '../core/events/EventBus.js';
import type { Logger } from '../shared/logger.js';

/**
 * WebSocket hacia el dashboard (ws://host/live). Es un suscriptor más del EventBus:
 * reenvía cada LiveEvent como JSON a todos los navegadores conectados.
 */
export class LiveGateway {
  private readonly wss = new WebSocketServer({ noServer: true });
  private unsubscribe?: () => void;

  constructor(
    private readonly bus: EventBus,
    private readonly logger: Logger,
    private readonly path = '/live',
  ) {}

  matches(pathname: string): boolean {
    return pathname === this.path;
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.logger.debug(`Dashboard conectado (${this.wss.clients.size})`);
      ws.send(JSON.stringify({ type: 'hello', at: new Date().toISOString() }));
    });
  }

  start(): void {
    this.unsubscribe = this.bus.subscribe((event) => {
      const data = JSON.stringify(event);
      for (const client of this.wss.clients) {
        if (client.readyState === client.OPEN) client.send(data);
      }
    });
  }

  stop(): void {
    this.unsubscribe?.();
    for (const ws of this.wss.clients) ws.close(1001);
    this.wss.close();
  }
}
