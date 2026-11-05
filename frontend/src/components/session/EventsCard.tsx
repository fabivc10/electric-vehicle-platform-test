import type { ActivityEntry } from '@ev/shared';
import { useState } from 'react';
import { fmtTimeSec } from '../../lib/format';
import { useActivity } from '../../store/selectors';
import { Card } from '../ui/Card';

/**
 * Eventos del cargador. Por defecto en lenguaje de operador ("Conector 1: cargando");
 * el modo técnico muestra la acción OCPP y su resumen.
 */
/** En modo resumen, eventos idénticos seguidos (p. ej. latidos) se agrupan en una línea "×N". */
const collapse = (list: ActivityEntry[], technical: boolean) => {
  const out: { e: ActivityEntry; count: number }[] = [];
  for (const e of list) {
    const last = out.at(-1);
    if (!technical && last && e.message && last.e.message === e.message && last.e.ok === e.ok) last.count++;
    else out.push({ e, count: 1 });
  }
  return out;
};

export const EventsCard = () => {
  const events = useActivity();
  const [technical, setTechnical] = useState(false);

  return (
    <Card
      title="Eventos"
      className="events"
      aside={
        <button className="link-btn" onClick={() => setTechnical((t) => !t)} aria-pressed={technical}>
          {technical ? 'Ver resumen' : 'Ver OCPP'}
        </button>
      }
    >
      {events.length === 0 ? (
        <p className="muted">Aún no hay eventos.</p>
      ) : (
        <ul className={`events__list ${technical ? '' : 'events__list--human'}`}>
          {collapse(events.slice(0, 60), technical).slice(0, 40).map(({ e, count }) => {
            const tech = `${e.direction === 'in' ? 'Cargador → CSMS' : 'CSMS → Cargador'} · ${e.action} · ${e.summary}`;
            return (
              <li key={e.id} title={tech} className={e.ok ? '' : 'is-bad'}>
                <time className="mono muted">{fmtTimeSec(e.timestamp)}</time>
                {technical || !e.message ? (
                  <>
                    <span className="events__action">
                      {e.direction === 'out' && <span className="events__out">↗ </span>}
                      {e.action}
                    </span>
                    <span className={`events__summary ${e.ok ? '' : 'text-danger'}`}>{e.summary}</span>
                  </>
                ) : (
                  <span className={`events__message ${e.ok ? '' : 'text-danger'}`}>
                    {e.direction === 'out' && <span className="events__out">↗ </span>}
                    {e.message}
                    {count > 1 && <span className="events__count"> ×{count}</span>}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
};
