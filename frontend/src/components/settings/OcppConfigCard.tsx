import type { ConfigurationEntry } from '@ev/shared';
import { useEffect, useState } from 'react';
import { useAppStore } from '../../store';
import { useSelectedChargePoint } from '../../store/selectors';
import { STANDARD_KEYS_16, keyInfo } from '../../lib/ocppKeys';
import { Card } from '../ui/Card';
import { ConfigValue } from '../ui/ConfigValue';

/**
 * Configuración del cargador vista desde el CSMS: GetConfiguration/ChangeConfiguration (1.6)
 * o GetVariables/SetVariables (2.x). Es lo que decide qué MeterValues envía y cada cuánto.
 */
export const OcppConfigCard = () => {
  const cp = useSelectedChargePoint();
  const sendCommand = useAppStore((s) => s.sendCommand);
  const [entries, setEntries] = useState<ConfigurationEntry[]>();
  const [unknown, setUnknown] = useState<string[]>([]);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const is16 = cp?.protocol === 'ocpp1.6';

  useEffect(() => {
    setEntries(undefined);
    setUnknown([]);
    setStatus({});
  }, [cp?.id, cp?.protocol]);

  if (!cp || cp.protocol === 'mqtt') return null;

  const read = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await sendCommand({ type: 'GetConfiguration' });
      setEntries(r.configuration ?? []);
      setUnknown(r.unknownKeys ?? []);
      } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const change = async (key: string, value: string) => {
    setStatus((s) => ({ ...s, [key]: '…' }));
    try {
      const r = await sendCommand({ type: 'ChangeConfiguration', key, value });
      setStatus((s) => ({ ...s, [key]: r.status }));
      if (r.accepted) {
        setEntries((list) => list?.map((e) => (e.key === key ? { ...e, value } : e)));
      }
    } catch (e) {
      setStatus((s) => ({ ...s, [key]: (e as Error).message }));
    }
  };

  return (
    <Card
      title={is16 ? 'Configuración OCPP (GetConfiguration / ChangeConfiguration)' : 'Device Model (GetVariables / SetVariables)'}
      aside={
        <button className="btn" disabled={!cp.online || busy} onClick={() => void read()}>
          {busy ? 'Leyendo…' : entries ? 'Volver a leer' : 'Leer del cargador'}
        </button>
      }
    >
      {!entries ? (
        <p className="muted">
          El cargador decide qué medidas envía y cada cuánto según esta configuración (p. ej.{' '}
          <code>{is16 ? 'MeterValuesSampledData' : 'SampledDataCtrlr.TxUpdatedMeasurands'}</code> y{' '}
          <code>{is16 ? 'MeterValueSampleInterval' : 'SampledDataCtrlr.TxUpdatedInterval'}</code>).
        </p>
      ) : (
        <table className="table compare cfg-table">
          <thead>
            <tr>
              <th>{is16 ? 'Clave' : 'Componente.Variable'}</th>
              <th>Valor</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const info = keyInfo(e.key, e.value);
              const std = is16 ? STANDARD_KEYS_16[e.key] : undefined;
              return (
                <tr key={e.key}>
                  <td className="mono">
                    {e.key}
                    {is16 && !std && <span className="muted"> · del fabricante</span>}
                  </td>
                  <td>
                    <ConfigValue
                      type={info.type}
                      unit={info.unit}
                      value={e.value ?? ''}
                      readonly={e.readonly}
                      disabled={!cp.online || status[e.key] === '…'}
                      onCommit={(v) => void change(e.key, v)}
                    />
                  </td>
                  <td className="mono">
                    <span className={status[e.key] === 'Accepted' ? 'text-ok' : status[e.key] ? 'text-danger' : ''}>
                      {status[e.key] ?? ''}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {unknown.length > 0 && <p className="muted mono">No reconocidas: {unknown.join(', ')}</p>}
      {error && <p className="error-text">{error}</p>}
    </Card>
  );
};
