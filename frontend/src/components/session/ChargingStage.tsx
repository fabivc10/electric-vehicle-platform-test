import { NoData } from '../ui/NoData';
import { kw, kwh } from '../../lib/format';
import { PLUGGED, STATUS_LABEL } from '../../lib/status';
import type { SessionView } from '../../store/selectors';
import { LazyCarScene as CarScene } from './LazyCarScene';

export const ChargingStage = ({ view }: { view: SessionView }) => {
  const { reading, connector, transaction } = view;
  const charging = connector?.status === 'Charging';
  const plugged = connector ? PLUGGED.has(connector.status) : false;
  const soc = reading.socPercent;

  return (
    <section className="card stage">
      <div className="stage__head">
        <h2 className="eyebrow">Estado de carga</h2>
        <div className="huge">
          {soc === undefined ? <NoData label="SoC no informado" title="Solo los cargadores DC reciben el SoC del vehículo" /> : (
            <>
              {Math.round(soc)}
              <small>%</small>
            </>
          )}
        </div>
      </div>

      <CarScene soc={soc} charging={charging} plugged={plugged} />

      <footer className="stage__foot">
        <span className="muted hint">Arrastra para orbitar · rueda para zoom · doble clic para centrar</span>
        <div className="stage__facts">
          <span>Conector {connector?.id ?? '—'}</span>
          <span>{charging ? `${kw(reading.powerW)} kW entregando` : (connector ? STATUS_LABEL[connector.status] : 'Sin estado')}</span>
          <span>{transaction ? `${kwh(transaction.energyWh)} kWh esta sesión` : 'Sin sesión activa'}</span>
        </div>
      </footer>
    </section>
  );
};
