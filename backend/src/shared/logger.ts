type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const COLOR: Record<Level, string> = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';

export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
  child(scope: string): Logger;
}

export const createLogger = (minLevel: Level = 'info', scope = 'app'): Logger => {
  const write = (level: Level, msg: string, meta?: unknown) => {
    if (ORDER[level] < ORDER[minLevel]) return;
    const ts = new Date().toISOString();
    const extra =
      meta === undefined ? '' : ' ' + (meta instanceof Error ? (meta.stack ?? meta.message) : JSON.stringify(meta));
    const line = `${COLOR[level]}${ts} ${level.toUpperCase().padEnd(5)} [${scope}]${RESET} ${msg}${extra}`;
    (level === 'error' ? console.error : console.log)(line);
  };
  return {
    debug: (m, meta) => write('debug', m, meta),
    info: (m, meta) => write('info', m, meta),
    warn: (m, meta) => write('warn', m, meta),
    error: (m, meta) => write('error', m, meta),
    child: (child) => createLogger(minLevel, `${scope}:${child}`),
  };
};
