import { ConfigCard } from '../components/emulator/ConfigCard';
import { ConnectionCard } from '../components/emulator/ConnectionCard';
import { CsmsCompareCard } from '../components/emulator/CsmsCompareCard';
import { FrameLog } from '../components/emulator/FrameLog';
import { ManualCard } from '../components/emulator/ManualCard';
import { MeterCard } from '../components/emulator/MeterCard';
import { VehicleCard } from '../components/emulator/VehicleCard';
import { useAppStore } from '../store';

/**
 * Cargador OCPP emulado en el navegador. Se conecta al CSMS por el mismo endpoint que
 * un equipo real y sigue la especificación (qué se envía lo decide su configuración).
 */
export const EmulatorPage = () => {
  const id = useAppStore((s) => s.emulator.config.chargePointId);
  const registered = useAppStore((s) => Boolean(s.chargePoints[id]));
  const select = useAppStore((s) => s.select);
  const setView = useAppStore((s) => s.setView);

  return (
    <div className="page emu">
      <header className="emu__head">
        <div>
          <h1 className="page__title">Emulador de cargador</h1>
          <p className="muted">
            Un cargador OCPP corriendo en esta pestaña. Lo físico (cable, tarjeta, medidor, fallas) lo controlas tú; los
            mensajes, su contenido y su momento los determina la especificación y la configuración del equipo.
          </p>
          <p className="req-legend">
            <span className="req-legend__swatch" /> <span className="req">●</span> obligatorio (1..1, ámbar mientras está vacío)
            <span className="opt">*</span> omitible (0..1)
          </p>
        </div>
        <button
          className="btn"
          disabled={!registered}
          onClick={() => {
            select(id);
            setView('session');
          }}
        >
          Ver {id} en Sesión
        </button>
      </header>

      <div className="emu__grid">
        <div className="col">
          <ConnectionCard />
          <MeterCard />
        </div>
        <div className="col">
          <VehicleCard />
          <CsmsCompareCard />
        </div>
        <div className="col">
          <ConfigCard />
          <ManualCard />
        </div>
      </div>
      <FrameLog />
    </div>
  );
};
