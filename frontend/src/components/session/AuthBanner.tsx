import { durationMin, fmtTime } from '../../lib/format';
import { useNow } from '../../lib/useNow';
import { useSelectedChargePoint, type SessionView } from '../../store/selectors';
import { Icon } from '../ui/Icon';

export const AuthBanner = ({ view }: { view: SessionView }) => {
  const now = useNow(15_000);
  const cp = useSelectedChargePoint();
  const tx = view.transaction;
  const auth = tx
    ? { idTag: tx.idTag, status: tx.authorization }
    : cp?.lastAuthorization && now - Date.parse(cp.lastAuthorization.at) < 5 * 60_000
      ? cp.lastAuthorization
      : undefined;

  const ok = auth?.status === 'Accepted';
  const title = !auth ? 'Esperando autorización' : ok ? 'Autorizado' : `No autorizado (${auth.status})`;

  return (
    <section className={`card auth ${auth ? (ok ? 'auth--ok' : 'auth--bad') : ''}`}>
      <div className="auth__icon">
        <Icon name={auth && !ok ? 'close' : 'check'} size={22} />
      </div>
      <div className="auth__text">
        <h2>{title}</h2>
        <p className="mono muted">Authorize · idTag {auth?.idTag ? `[${auth.idTag}]` : '—'}</p>
      </div>
      {tx && (
        <div className="auth__time">
          <span className="muted">Inicio</span>
          <strong className="mono">{fmtTime(tx.startedAt)}</strong>
          <span className="muted">{durationMin(tx.startedAt, now)} min en sesión</span>
        </div>
      )}
    </section>
  );
};
