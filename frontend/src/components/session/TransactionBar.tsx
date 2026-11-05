import { useState } from 'react';
import { useNow } from '../../lib/useNow';
import { useAppStore } from '../../store';
import { useSelectedChargePoint, type SessionView } from '../../store/selectors';
import { Icon } from '../ui/Icon';

export const TransactionBar = ({ view }: { view: SessionView }) => {
  const cp = useSelectedChargePoint();
  const connectorId = useAppStore((s) => s.connectorId);
  const sendCommand = useAppStore((s) => s.sendCommand);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string>();
  const [idTag, setIdTag] = useState('');
  const tx = view.transaction;
  const now = useNow(1000);
  const lastAgo = view.lastSampleAt ? Math.max(0, Math.round((now - Date.parse(view.lastSampleAt)) / 1000)) : undefined;
  const startAction = cp?.protocol.startsWith('ocpp2') ? 'TransactionEvent' : 'StartTransaction';

  const run = async (fn: () => ReturnType<typeof sendCommand>) => {
    setBusy(true);
    setFeedback(undefined);
    try {
      const r = await fn();
      setFeedback(r.accepted ? undefined : `El cargador respondió ${r.status}`);
    } catch (e) {
      setFeedback((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card txbar">
      <div className="txbar__icon">
        <Icon name="trend" />
      </div>
      <div className="txbar__body">
        {tx ? (
          <>
            <strong>Transacción #{tx.id}</strong>
            <span className="muted mono">
              {startAction} · meterStart {tx.meterStartWh === undefined ? '— (sin medida en el inicio)' : `${tx.meterStartWh.toLocaleString('es')} Wh`}
            </span>
            <span className="muted mono">
              {lastAgo === undefined
                ? 'Esperando la primera MeterValues (la frecuencia la fija MeterValueSampleInterval del cargador)'
                : `Última MeterValues hace ${lastAgo} s`}
            </span>
            <div className="progress" aria-label="Progreso de SoC">
              <span style={{ width: `${view.reading.socPercent ?? 0}%` }} />
            </div>
          </>
        ) : (
          <>
            <strong>Sin transacción activa</strong>
            <span className="muted">Inicia una carga remota en el conector {connectorId}</span>
          </>
        )}
        {feedback && <span className="error-text">{feedback}</span>}
      </div>

      {tx ? (
        <button
          className="btn btn--danger"
          disabled={busy || !cp?.online}
          onClick={() => run(() => sendCommand({ type: 'RemoteStop', transactionId: tx.id }))}
        >
          {busy ? 'Enviando…' : 'Detener carga'}
        </button>
      ) : (
        <form
          className="txbar__start"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => sendCommand({ type: 'RemoteStart', connectorId, idTag }));
          }}
        >
          <input
            className="input mono"
            value={idTag}
            onChange={(e) => setIdTag(e.target.value)}
            aria-label="idTag (obligatorio)"
            placeholder="idTag"
            required
            maxLength={cp?.protocol === 'ocpp1.6' ? 20 : 36}
          />
          <button className="btn btn--primary" disabled={busy || !cp?.online || !idTag}>
            {busy ? 'Enviando…' : 'Iniciar carga'}
          </button>
        </form>
      )}
    </section>
  );
};
