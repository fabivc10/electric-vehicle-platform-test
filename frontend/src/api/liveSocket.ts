import type { LiveEvent } from '@ev/shared';

export type LiveStatus = 'connecting' | 'open' | 'closed';

interface LiveSocketHandlers {
  onEvent(event: LiveEvent): void;
  onStatus(status: LiveStatus): void;
  /** Se llama en cada (re)conexión para resincronizar el estado vía REST. */
  onOpen(): void;
}

/** WebSocket al backend (/live) con reconexión exponencial. Devuelve la función de cierre. */
export const connectLiveSocket = (handlers: LiveSocketHandlers): (() => void) => {
  let ws: WebSocket | undefined;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const open = () => {
    handlers.onStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/live`);

    ws.onopen = () => {
      retry = 0;
      handlers.onStatus('open');
      handlers.onOpen();
    };
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data as string) as LiveEvent | { type: 'hello' };
        if (data.type !== 'hello') handlers.onEvent(data);
      } catch {
        /* mensaje inválido: se ignora */
      }
    };
    ws.onclose = () => {
      handlers.onStatus('closed');
      if (stopped) return;
      const delay = Math.min(15_000, 500 * 2 ** retry++);
      timer = setTimeout(open, delay);
    };
  };

  open();
  return () => {
    stopped = true;
    clearTimeout(timer);
    ws?.close();
  };
};
