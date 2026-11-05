import { useState } from 'react';
import type { FrameEntry } from '../../emulator/types';
import { fmtTimeSec } from '../../lib/format';
import { useAppStore } from '../../store';
import { Card } from '../ui/Card';

const DIR: Record<FrameEntry['dir'], { icon: string; title: string }> = {
  tx: { icon: '↑', title: 'Cargador → CSMS' },
  rx: { icon: '↓', title: 'CSMS → Cargador' },
  sys: { icon: '•', title: 'Evento local' },
};

const pretty = (text: string) => {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
};

type Filter = 'all' | 'errors' | 'csms';

/** Tráfico OCPP-J crudo tal como lo ve el cargador emulado. */
export const FrameLog = () => {
  const frames = useAppStore((s) => s.emulator.frames);
  const device = useAppStore((s) => s.emulatorDevice);
  const [filter, setFilter] = useState<Filter>('all');

  const shown = frames.filter((f) =>
    filter === 'errors' ? f.error : filter === 'csms' ? f.dir === 'rx' && f.kind === 'CALL' : true,
  );

  return (
    <Card
      title="Tráfico OCPP"
      className="emu-log"
      aside={
        <div className="row">
          <select className="input" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filtro">
            <option value="all">Todo ({frames.length})</option>
            <option value="csms">Comandos del CSMS</option>
            <option value="errors">Errores</option>
          </select>
          <button className="btn" onClick={() => device.clearFrames()} disabled={!frames.length}>
            Limpiar
          </button>
        </div>
      }
    >
      {shown.length === 0 ? (
        <p className="muted">Sin mensajes. Conecta el emulador para ver cada frame.</p>
      ) : (
        <ul className="frames">
          {shown.map((f) => (
            <li key={f.seq} className={`frame frame--${f.dir} ${f.error ? 'is-error' : ''}`}>
              <details>
                <summary>
                  <time className="mono muted">{fmtTimeSec(f.at)}</time>
                  <span className="frame__dir" title={DIR[f.dir].title}>
                    {DIR[f.dir].icon}
                  </span>
                  <span className="frame__kind">{f.kind}</span>
                  <span className="frame__action">{f.action ?? ''}</span>
                  <span className="frame__text mono">{f.text}</span>
                  <span className="mono muted">{f.latencyMs !== undefined ? `${f.latencyMs} ms` : ''}</span>
                </summary>
                <pre className="frame__body mono">{pretty(f.text)}</pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};
