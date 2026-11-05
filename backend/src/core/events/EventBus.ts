import type { LiveEvent } from '@ev/shared';

export type LiveEventListener = (event: LiveEvent) => void;

/**
 * Observer: los servicios publican eventos de dominio y cualquier consumidor
 * (LiveGateway hacia el dashboard, futuros webhooks, métricas...) se suscribe
 * sin que los servicios lo conozcan.
 */
export class EventBus {
  private readonly listeners = new Set<LiveEventListener>();

  subscribe(listener: LiveEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: LiveEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Un suscriptor roto nunca debe tumbar el flujo OCPP.
      }
    }
  }
}
