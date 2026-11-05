import { useEffect } from 'react';
import { EmptyHelp } from '../components/ui/EmptyHelp';
import { EmptyState } from '../components/ui/Card';
import { fmtDateTime, fmtDuration, kwh } from '../lib/format';
import { useAppStore } from '../store';

export const HistoryPage = () => {
  const history = useAppStore((s) => s.history);
  const loadHistory = useAppStore((s) => s.loadHistory);
  const chargePoints = useAppStore((s) => s.chargePoints);

  useEffect(() => {
    void loadHistory().catch(() => undefined);
  }, [loadHistory]);

  if (!history.length)
    return (
      <EmptyState title="Sin transacciones registradas">
        <EmptyHelp text="Cada carga iniciada y terminada en cualquier cargador queda registrada aquí." />
      </EmptyState>
    );

  return (
    <div className="page">
      <h1 className="page__title">Historial de transacciones</h1>
      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Estación</th>
              <th>Conector</th>
              <th>idTag</th>
              <th>Inicio</th>
              <th>Duración</th>
              <th className="num">Energía</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {history.map((tx) => (
              <tr key={`${tx.chargePointId}-${tx.id}`}>
                <td className="mono">{tx.id}</td>
                <td>{chargePoints[tx.chargePointId]?.name ?? tx.chargePointId}</td>
                <td>{tx.connectorId}</td>
                <td className="mono">{tx.idTag || '—'}</td>
                <td>{fmtDateTime(tx.startedAt)}</td>
                <td>{fmtDuration(tx.startedAt, tx.stoppedAt)}</td>
                <td className="num">{kwh(tx.energyWh)} kWh</td>
                <td>
                  {tx.state === 'active' ? (
                    <span className="tag tag--ok">Activa</span>
                  ) : (
                    <span className="tag">{tx.stopReason ?? 'Completada'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
