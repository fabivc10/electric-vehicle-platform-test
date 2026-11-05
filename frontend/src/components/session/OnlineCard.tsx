import { useAppStore } from '../../store';
import { useSelectedChargePoint } from '../../store/selectors';
import { Icon } from '../ui/Icon';

export const OnlineCard = () => {
  const cp = useSelectedChargePoint();
  const connectorId = useAppStore((s) => s.connectorId);
  if (!cp) return null;

  const faults = cp.connectors.filter((c) => c.status === 'Faulted' || (c.errorCode && c.errorCode !== 'NoError'));
  const connector = cp.connectors.find((c) => c.id === connectorId);
  const tone = !cp.online ? 'muted' : faults.length ? 'danger' : 'ok';

  return (
    <section className={`card online online--${tone}`}>
      <div className="online__icon">
        <Icon name={tone === 'ok' ? 'check' : tone === 'danger' ? 'alert' : 'close'} size={18} />
      </div>
      <div>
        <strong>{cp.online ? 'Cargador en línea' : 'Cargador desconectado'}</strong>
        <p className="muted">
          {!cp.online
            ? 'Esperando reconexión del WebSocket'
            : faults.length
              ? `Falla en conector ${faults[0]!.id}${faults[0]!.errorCode ? ` · ${faults[0]!.errorCode}` : ''}${faults[0]!.info ? ` (${faults[0]!.info})` : ''}`
              : connector
                ? `Sin fallas · StatusNotification ${connector.errorCode ?? connector.status}`
                : `Sin StatusNotification del conector ${connectorId}`}
        </p>
      </div>
    </section>
  );
};
