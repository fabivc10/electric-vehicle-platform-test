import { NoData } from '../ui/NoData';
import { kwh, num } from '../../lib/format';
import { STATUS_LABEL } from '../../lib/status';
import type { SessionView } from '../../store/selectors';
import { Card, Stat } from '../ui/Card';

const SEGMENTS = 20;

export const BatteryCard = ({ view }: { view: SessionView }) => {
  const { reading, transaction, connector, minutesToFull } = view;
  const soc = reading.socPercent;
  const filled = soc === undefined ? 0 : Math.round((soc / 100) * SEGMENTS);
  const charging = connector?.status === 'Charging';

  return (
    <Card
      title="Batería del vehículo"
      aside={charging ? <span className="tag tag--ok">Cargando</span> : <span className="tag">{connector ? STATUS_LABEL[connector.status] : 'Sin estado'}</span>}
    >
      <div className="battery__row">
        <div>
          {soc === undefined ? (
            <NoData label="SoC no informado" title="Solo los cargadores DC reciben el SoC del vehículo" />
          ) : (
            <>
              <span className="mid">{Math.round(soc)}</span>
              <span className="unit">% SoC</span>
            </>
          )}
        </div>
        <div className="battery__eta">
          {minutesToFull === undefined ? (
            <NoData label="tiempo a 100 %: —" title="Se estima con al menos dos lecturas de SoC" />
          ) : (
            <>
              <span className="mid">{minutesToFull}</span>
              <span className="unit">min a 100 %</span>
            </>
          )}
        </div>
      </div>

      <div className="segments" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={soc ?? 0}>
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span key={i} className={i < filled ? 'is-on' : ''} />
        ))}
      </div>

      <div className="stats3">
        <Stat label="Energía" value={kwh(transaction?.energyWh)} unit="kWh" />
        <Stat label="Voltaje" value={num(reading.voltageV)} unit="V" />
        <Stat label="Corriente" value={num(reading.currentA)} unit="A" />
      </div>
    </Card>
  );
};
