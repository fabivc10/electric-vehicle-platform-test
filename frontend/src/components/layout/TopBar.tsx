import { PROTOCOL_LABELS } from '@ev/shared';
import { cpLabel, fmtDay, fmtTime } from '../../lib/format';
import { STATUS_LABEL, STATUS_TONE } from '../../lib/status';
import { useNow } from '../../lib/useNow';
import { useAppStore } from '../../store';
import { useSelectedChargePoint } from '../../store/selectors';
import { Icon } from '../ui/Icon';

export const TopBar = () => {
  const now = useNow(10_000);
  const cp = useSelectedChargePoint();
  const chargePoints = useAppStore((s) => s.chargePoints);
  const select = useAppStore((s) => s.select);
  const connectorId = useAppStore((s) => s.connectorId);
  const setConnector = useAppStore((s) => s.setConnector);
  const liveStatus = useAppStore((s) => s.liveStatus);

  const connector = cp?.connectors.find((c) => c.id === connectorId);
  const status = cp?.online ? connector?.status : undefined;
  const statusText = !cp?.online ? 'Offline' : status ? STATUS_LABEL[status] : 'Sin StatusNotification';
  const connectors = cp?.connectors.filter((c) => c.id > 0) ?? [];
  const ids = Object.keys(chargePoints).sort();

  return (
    <header className="topbar">
      <div className="topbar__group">
        <span className="pill">
          {fmtTime(now)} · {fmtDay(new Date(now))}
        </span>
        <label className="pill pill--select">
          <span className="sr-only">Cargador</span>
          <select value={cp?.id ?? ''} onChange={(e) => select(e.target.value)} disabled={!ids.length}>
            {!ids.length && <option value="">Sin cargadores</option>}
            {ids.map((id) => (
              <option key={id} value={id}>
                Estación {chargePoints[id]?.name ?? id}
              </option>
            ))}
          </select>
          ·
          <select
            value={connectorId}
            onChange={(e) => setConnector(Number(e.target.value))}
            disabled={!connectors.length}
          >
            {!connectors.length && <option value={connectorId}>Sin conectores</option>}
            {connectors.map((c) => (
              <option key={c.id} value={c.id}>
                Conector {c.id}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="pill pill--status">
        <span className="eyebrow">Estado</span>
        <span className={`dot dot--${status ? STATUS_TONE[status] : 'muted'}`} />
        {statusText}
      </div>

      <div className="topbar__group">
        <span className="pill mono">{cpLabel(cp?.id)}</span>
        <span className="pill" title={`Dashboard: ${liveStatus}`}>
          <Icon name="wifi" size={14} className={`live live--${liveStatus}`} />
          {cp ? (cp.protocol === 'mqtt' ? 'MQTT' : `WebSocket · ${PROTOCOL_LABELS[cp.protocol]}`) : 'Sin conexión'}
        </span>
      </div>
    </header>
  );
};
