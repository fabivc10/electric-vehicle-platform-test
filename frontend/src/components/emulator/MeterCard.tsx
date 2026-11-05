import { useAppStore } from '../../store';
import { Card, Stat } from '../ui/Card';

const Slider = ({
  label,
  value,
  min,
  max,
  step,
  unit,
  digits = 0,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  digits?: number;
  onChange(v: number): void;
}) => (
  <label className="slider">
    <span className="slider__head">
      <span>{label}</span>
      <strong className="mono">
        {value.toFixed(digits)} {unit}
      </strong>
    </span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
  </label>
);

/**
 * Hardware simulado: lo que el cargador MIDE. Qué measurands se envían y cada cuánto
 * no se decide aquí, sino en la configuración OCPP (MeterValuesSampledData, etc.).
 */
export const MeterCard = () => {
  const emu = useAppStore((s) => s.emulator);
  const device = useAppStore((s) => s.emulatorDevice);
  const p = emu.physics;
  const ac = emu.config.chargerType === 'AC';
  const sampled = emu.configuration.find((c) => c.key === 'MeterValuesSampledData');
  const interval = emu.configuration.find((c) => c.key === 'MeterValueSampleInterval');

  return (
    <Card title="Medidor (hardware)">
      <div className="stats3 emu-readouts">
        <Stat label="Potencia" value={(p.powerW / 1000).toFixed(2)} unit="kW" />
        <Stat label="Corriente" value={p.currentA.toFixed(1)} unit="A" />
        <Stat label="Registro" value={(p.energyWh / 1000).toFixed(3)} unit="kWh" />
        <Stat label="Tensión medida" value={p.measuredVoltageV.toFixed(1)} unit="V" />
        <Stat label="Temp. medida" value={p.measuredTemperatureC.toFixed(1)} unit="°C" />
        <Stat label="Reducción" value={p.derate < 1 ? `${Math.round(p.derate * 100)} %` : '—'} />
      </div>

      <Slider
        label={ac ? 'Potencia ofrecida (piloto PWM)' : 'Potencia ofrecida'}
        value={p.offeredW / 1000}
        min={1}
        max={ac ? 19.2 : 350}
        step={0.1}
        unit="kW"
        digits={1}
        onChange={(v) => device.setPhysics({ offeredW: v * 1000 })}
      />
      <Slider label="Tensión" value={p.voltageV} min={ac ? 100 : 200} max={ac ? 277 : 920} step={1} unit="V" onChange={(v) => device.setPhysics({ voltageV: v })} />
      <Slider label="Temperatura interna" value={p.temperatureC} min={-20} max={90} step={0.5} unit="°C" digits={1} onChange={(v) => device.setPhysics({ temperatureC: v })} />
      <Slider label="SoC del vehículo" value={p.socPercent} min={0} max={100} step={1} unit="%" onChange={(v) => device.setPhysics({ socPercent: v })} />
      <Slider label="Capacidad de la batería" value={p.batteryWh / 1000} min={10} max={150} step={1} unit="kWh" onChange={(v) => device.setPhysics({ batteryWh: v * 1000 })} />

      <div className="emu-smart">
        <strong>Smart Charging</strong>
        {emu.smartLimit.watts === undefined ? (
          <span className="muted"> sin perfiles vigentes: ofrece {(p.offeredW * p.derate / 1000).toFixed(1)} kW</span>
        ) : (
          <span className={emu.smartLimit.blocked ? 'text-warn' : ''}>
            {' '}
            límite {(emu.smartLimit.watts / 1000).toFixed(2)} kW ({emu.smartLimit.amps?.toFixed(1)} A) por {emu.smartLimit.source?.purpose} #
            {emu.smartLimit.source?.id}
            {emu.smartLimit.blocked && ' · por debajo de 6 A → SuspendedEVSE'}
          </span>
        )}
        {emu.chargingProfiles.length > 0 && (
          <ul className="emu-smart__list mono">
            {emu.chargingProfiles.map((cp) => (
              <li key={cp.id}>
                #{cp.id} {cp.purpose} · stack {cp.stackLevel} · {cp.kind}
                {cp.recurrencyKind ? `/${cp.recurrencyKind}` : ''} · conector {cp.connectorId} ·{' '}
                {cp.schedule.periods.map((x) => `${x.startPeriod}s→${x.limit}${cp.schedule.unit}`).join(', ')}
              </li>
            ))}
          </ul>
        )}
      </div>
      <label className="check">
        <input type="checkbox" checked={emu.settings.fluctuations} onChange={(e) => device.updateSettings({ fluctuations: e.target.checked })} />
        Fluctuaciones de red y calentamiento <span className="mono muted">(tensión ±2,5 %, potencia ±1,5 %)</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={emu.settings.randomEvents} onChange={(e) => device.updateSettings({ randomEvents: e.target.checked })} />
        Eventos de sesión aleatorios <span className="mono muted">(pausas del EV, EVCommunicationError)</span>
      </label>
      <p className="note">
        <span className="dot dot--info" />
        <span>
          Protecciones{ac ? `: tensión fuera de 207–253 V → UnderVoltage/OverVoltage (Faulted)` : ''}; ≥ 60 °C → HighTemperature
          (aviso, 50 % de potencia); ≥ 75 °C → Faulted hasta bajar de 70 °C.
        </span>
      </p>
      <p className="note">
        <span className="dot dot--info" />
        Tiempo real: energía = potencia × tiempo. La potencia es la ofrecida, reducida por el EV sobre 80 % de SoC; 0 fuera de Charging.
      </p>
      <p className="note">
        <span className="dot dot--info" />
        <span>
        Se envía: <span className="mono">{sampled?.value ? sampled.value.split(',').join(', ') : '(nada)'}</span> cada {interval?.value ?? '—'} s desde el inicio de la
        transacción ({sampled?.name}). Measurands medibles: <span className="mono">{emu.supportedMeasurands.join(', ')}</span>.
        </span>
      </p>
    </Card>
  );
};
