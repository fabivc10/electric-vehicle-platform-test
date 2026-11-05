import { ago } from '../../lib/format';
import { useNow } from '../../lib/useNow';
import { useSelectedChargePoint } from '../../store/selectors';
import { Card } from '../ui/Card';

export const ChargerInfoCard = () => {
  const now = useNow(1000);
  const cp = useSelectedChargePoint();
  if (!cp) return null;

  const boot = cp.bootStatus ?? '—';
  const late =
    cp.lastHeartbeatAt && now - Date.parse(cp.lastHeartbeatAt) > cp.heartbeatIntervalSec * 2 * 1000;

  return (
    <Card title="Cargador">
      <h3 className="cp-name">Estación {cp.name ?? cp.id}</h3>
      <dl className="kv">
        <dt>BootNotification</dt>
        <dd className={boot === 'Accepted' ? 'text-ok' : boot === 'Rejected' ? 'text-danger' : ''}>{boot}</dd>
        <dt>Heartbeat</dt>
        <dd>cada {cp.heartbeatIntervalSec} s</dd>
        <dt>Último latido</dt>
        <dd className={late ? 'text-warn' : ''}>{ago(cp.lastHeartbeatAt, now)}</dd>
        {cp.vendor && (
          <>
            <dt>Modelo</dt>
            <dd>
              {cp.vendor} {cp.model}
            </dd>
          </>
        )}
        {cp.firmwareVersion && (
          <>
            <dt>Firmware</dt>
            <dd className="mono">{cp.firmwareVersion}</dd>
          </>
        )}
      </dl>
    </Card>
  );
};
