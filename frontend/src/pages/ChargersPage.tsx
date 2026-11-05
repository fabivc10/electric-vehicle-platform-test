import { PROTOCOL_LABELS } from '@ev/shared';
import { useState } from 'react';
import { EmptyState } from '../components/ui/Card';
import { EmptyHelp } from '../components/ui/EmptyHelp';
import { Icon } from '../components/ui/Icon';
import { ago, cpLabel } from '../lib/format';
import { STATUS_LABEL, STATUS_TONE } from '../lib/status';
import { useNow } from '../lib/useNow';
import { useAppStore } from '../store';

/**
 * Un cargador = un identificador (el {id} de /ocpp/{id}). Una reconexión con el mismo id
 * (p. ej. el emulador tras recargar la página) es el mismo cargador, no uno nuevo.
 */
export const ChargersPage = () => {
  const now = useNow(5000);
  const chargePoints = useAppStore((s) => s.chargePoints);
  const select = useAppStore((s) => s.select);
  const setView = useAppStore((s) => s.setView);
  const removeChargePoints = useAppStore((s) => s.removeChargePoints);
  const [error, setError] = useState<string>();
  const list = Object.values(chargePoints).sort((a, b) => Number(b.online) - Number(a.online) || a.id.localeCompare(b.id));
  const offline = list.filter((cp) => !cp.online);

  const remove = async (ids: string[]) => {
    setError(undefined);
    try {
      await removeChargePoints(ids);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!list.length)
    return (
      <EmptyState title="No hay cargadores registrados todavía">
        <EmptyHelp text="Aparecen aquí en cuanto se conectan al CSMS." />
      </EmptyState>
    );

  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">Cargadores</h1>
        {offline.length > 0 && (
          <button className="btn btn--danger" onClick={() => void remove(offline.map((cp) => cp.id))}>
            <Icon name="trash" size={15} /> Borrar desconectados ({offline.length})
          </button>
        )}
      </header>
      {error && <p className="error-text">{error}</p>}
      <div className="grid-cards">
        {list.map((cp) => (
          <article key={cp.id} className="card cp-card">
            <button
              className="cp-card__open"
              onClick={() => {
                select(cp.id);
                setView('session');
              }}
            >
              <div className="cp-card__head">
                <strong>{cp.name ?? cp.id}</strong>
                <span className={`tag ${cp.online ? 'tag--ok' : ''}`}>{cp.online ? 'En línea' : 'Desconectado'}</span>
              </div>
              <span className="mono muted">
                {cpLabel(cp.id)} · {PROTOCOL_LABELS[cp.protocol]}
              </span>
              <ul className="cp-card__connectors">
                {cp.connectors
                  .filter((c) => c.id > 0)
                  .map((c) => (
                    <li key={c.id}>
                      <span className={`dot dot--${STATUS_TONE[c.status]}`} /> Conector {c.id} · {STATUS_LABEL[c.status]}
                    </li>
                  ))}
              </ul>
              <span className="muted">
                {cp.online ? `Conectado ${ago(cp.connectedAt, now)}` : `Último mensaje ${ago(cp.lastSeenAt, now)}`}
              </span>
            </button>
            {!cp.online && (
              <button
                className="icon-btn cp-card__delete"
                title={`Borrar ${cp.id} y su historial`}
                aria-label={`Borrar ${cp.id} y su historial`}
                onClick={() => void remove([cp.id])}
              >
                <Icon name="trash" size={16} />
              </button>
            )}
          </article>
        ))}
      </div>
    </div>
  );
};
