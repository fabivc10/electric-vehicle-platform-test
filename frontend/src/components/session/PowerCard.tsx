import { NoData } from '../ui/NoData';
import type { ConnectorStatus } from '@ev/shared';
import { kw } from '../../lib/format';
import type { SessionView } from '../../store/selectors';
import { Card } from '../ui/Card';

const STEPS: { status: ConnectorStatus; label: string }[] = [
  { status: 'Available', label: 'Disponible' },
  { status: 'Preparing', label: 'Preparando' },
  { status: 'Charging', label: 'Cargando' },
  { status: 'Finishing', label: 'Finalizando' },
];

/** Los estados suspendidos se muestran sobre el paso "Charging". */
const stepOf = (s?: ConnectorStatus): ConnectorStatus | undefined =>
  s === 'SuspendedEV' || s === 'SuspendedEVSE' ? 'Charging' : s;

export const PowerCard = ({ view }: { view: SessionView }) => {
  const { reading, connector, transaction } = view;
  // Solo se muestra potencia reportada por el cargador durante una transacción.
  const power = transaction ? reading.powerW : undefined;
  const max = transaction ? reading.powerOfferedW : undefined;
  const ratio = power !== undefined && max ? Math.min(1, power / max) : 0;
  const R = 20;
  const C = 2 * Math.PI * R;
  const current = stepOf(connector?.status);

  return (
    <Card title="Potencia" className="power">
      <div className="power__main">
        <div className="power__value">
          {power === undefined ? (
            <NoData label={transaction ? 'sin lectura de potencia' : 'sin carga activa'} />
          ) : (
            <>
              <span className="big">{kw(power)}</span>
              <span className="unit">kW</span>
            </>
          )}
        </div>
        <div className="ring" title={max ? `${Math.round(ratio * 100)} % de la potencia ofrecida` : 'Sin dato de Power.Offered'}>
          <svg viewBox="0 0 48 48">
            <circle cx="24" cy="24" r={R} className="ring__track" />
            <circle
              cx="24"
              cy="24"
              r={R}
              className="ring__bar"
              strokeDasharray={`${C * ratio} ${C}`}
              transform="rotate(-90 24 24)"
            />
          </svg>
          <div className="ring__label">
            <strong>{kw(max, 0)}</strong>
            <span>kW máx</span>
          </div>
        </div>
      </div>

      <ol className="steps" aria-label="Estado del conector">
        {STEPS.map((s) => (
          <li key={s.status} className={current === s.status ? 'is-current' : ''}>
            {s.label}
          </li>
        ))}
      </ol>

      <p className="note">
        <span className="dot dot--info" />
        {max !== undefined ? `Power.Offered ${kw(max, 0)} kW` : 'Sin dato de Power.Offered'}
        {connector?.status === 'SuspendedEV' && ' · pausado por el vehículo'}
        {connector?.status === 'SuspendedEVSE' && ' · pausado por el cargador'}
      </p>
    </Card>
  );
};
