import { useState } from 'react';
import { useAppStore } from '../../store';
import { Card } from '../ui/Card';
import { ConfigValue } from '../ui/ConfigValue';

/**
 * Configuración OCPP del equipo. Es lo que decide qué se envía y cuándo; el CSMS la
 * lee/cambia con GetConfiguration/ChangeConfiguration (1.6) o GetVariables/SetVariables
 * (2.x). Aquí también se puede cambiar "en sitio", como haría un técnico.
 */
/** Permite cortar "MeterValuesSampledDataMaxLength" entre palabras, no a mitad de una. */
const breakable = (name: string) =>
  name.split(/(?=[A-Z.])/).map((part, i) => (
    <span key={i}>
      {i > 0 && <wbr />}
      {part}
    </span>
  ));

export const ConfigCard = () => {
  const entries = useAppStore((s) => s.emulator.configuration);
  const protocol = useAppStore((s) => s.emulator.config.protocol);
  const device = useAppStore((s) => s.emulatorDevice);
  const [result, setResult] = useState<{ name: string; status: string }>();

  return (
    <Card title={protocol === 'ocpp1.6' ? 'Configuración (claves Core §9.1)' : 'Device Model (variables)'} className="emu-config">
      <table className="table compare">
        <thead>
          <tr>
            <th>{protocol === 'ocpp1.6' ? 'Clave' : 'Componente.Variable'}</th>
            <th>Valor</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.key} className={e.changedBy === 'CSMS' ? 'is-csms' : ''} title={e.description}>
              <td className="mono">
                {breakable(e.name)}
                {e.changedBy && <span className={e.changedBy === 'CSMS' ? 'text-ok' : 'muted'}> · {e.changedBy}</span>}
              </td>
              <td>
                <ConfigValue
                  type={e.type}
                  unit={e.unit}
                  value={e.value}
                  readonly={e.readonly}
                  onCommit={(v) => setResult({ name: e.name, status: device.setConfigLocal(e.name, v) })}
                />
                {result?.name === e.name && (
                  <span className={result.status === 'Accepted' ? 'text-ok' : 'text-danger'}> {result.status}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        <span className="dot dot--info" />
        Measurands no soportados o listas más largas que *MaxLength → Rejected (§3.16.4). Pasa el cursor para ver qué hace cada clave.
      </p>
    </Card>
  );
};
