import { NoData } from '../ui/NoData';
import type { SessionView } from '../../store/selectors';
import { Icon } from '../ui/Icon';

const THRESHOLD_C = 60;
const WARN_C = 50;

export const TemperatureCard = ({ view }: { view: SessionView }) => {
  const t = view.reading.temperatureC;
  const level = t === undefined ? 'Sin dato' : t >= THRESHOLD_C ? 'Crítica' : t >= WARN_C ? 'Elevada' : 'Normal';
  const tone = t === undefined ? 'muted' : t >= THRESHOLD_C ? 'danger' : t >= WARN_C ? 'warn' : 'ok';

  return (
    <section className={`card temp temp--${tone}`}>
      <Icon name="thermo" size={26} />
      {t === undefined ? <NoData /> : <span className="mid">{Math.round(t)}°</span>}
      <div>
        <strong>Temperatura del conector</strong>
        <p className="muted">
          {level} · umbral {THRESHOLD_C} °C
        </p>
      </div>
    </section>
  );
};
