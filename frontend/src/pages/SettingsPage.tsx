import type { ChargePointCommand } from '@ev/shared';
import { useEffect, useState } from 'react';
import { OcppConfigCard } from '../components/settings/OcppConfigCard';
import { Card, EmptyState } from '../components/ui/Card';
import { EmptyHelp } from '../components/ui/EmptyHelp';
import { useAppStore } from '../store';
import { useSelectedChargePoint } from '../store/selectors';
import { cpLabel } from '../lib/format';

type Group = 'Pedir datos al cargador' | 'Conector' | 'Reinicio';
interface Action {
  group: Group;
  label: string;
  /** Mensaje OCPP que se envía (se muestra como detalle). */
  ocpp: string;
  command: ChargePointCommand;
  danger?: boolean;
}

const actionsFor = (connectorId: number): Action[] => [
  { group: 'Pedir datos al cargador', label: 'Estado de los conectores', ocpp: 'TriggerMessage StatusNotification', command: { type: 'TriggerMessage', message: 'StatusNotification' } },
  { group: 'Pedir datos al cargador', label: `Lectura del medidor (conector ${connectorId})`, ocpp: 'TriggerMessage MeterValues', command: { type: 'TriggerMessage', message: 'MeterValues', connectorId } },
  { group: 'Pedir datos al cargador', label: 'Señal de vida', ocpp: 'TriggerMessage Heartbeat', command: { type: 'TriggerMessage', message: 'Heartbeat' } },
  { group: 'Conector', label: `Desbloquear conector ${connectorId}`, ocpp: 'UnlockConnector', command: { type: 'UnlockConnector', connectorId } },
  { group: 'Conector', label: `Poner fuera de servicio`, ocpp: 'ChangeAvailability Inoperative', command: { type: 'ChangeAvailability', connectorId, available: false } },
  { group: 'Conector', label: `Poner en servicio`, ocpp: 'ChangeAvailability Operative', command: { type: 'ChangeAvailability', connectorId, available: true } },
  { group: 'Reinicio', label: 'Reinicio suave', ocpp: 'Reset Soft: termina las cargas y reinicia', command: { type: 'Reset', mode: 'Soft' }, danger: true },
  { group: 'Reinicio', label: 'Reinicio forzado', ocpp: 'Reset Hard: reinicia de inmediato', command: { type: 'Reset', mode: 'Hard' }, danger: true },
];
const GROUPS: Group[] = ['Pedir datos al cargador', 'Conector', 'Reinicio'];

export const SettingsPage = () => {
  const cp = useSelectedChargePoint();
  const rename = useAppStore((s) => s.renameChargePoint);
  const sendCommand = useAppStore((s) => s.sendCommand);
  const connectorId = useAppStore((s) => s.connectorId);
  const [name, setName] = useState('');
  const [log, setLog] = useState<string[]>([]);
  /** Acción destructiva pendiente de confirmar (segundo clic). */
  const [confirming, setConfirming] = useState<string>();

  useEffect(() => setName(cp?.name ?? ''), [cp?.id, cp?.name]);

  if (!cp) return (
      <EmptyState title="Selecciona un cargador">
        <EmptyHelp text="Elige una estación en la barra superior o conecta una." />
      </EmptyState>
    );

  const run = async (label: string, command: ChargePointCommand) => {
    try {
      const r = await sendCommand(command);
      setLog((l) => [`${label}: ${r.status}`, ...l].slice(0, 8));
    } catch (e) {
      setLog((l) => [`${label}: ${(e as Error).message}`, ...l].slice(0, 8));
    }
  };

  return (
    <div className="page settings">
      <h1 className="page__title">Ajustes · {cpLabel(cp.id)}</h1>
      <div className="settings__grid">
        <div className="col">
      <Card title="Nombre de la estación">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void rename(name.trim());
          }}
        >
          <input className="input" value={name} placeholder={cp.id} onChange={(e) => setName(e.target.value)} />
          <button className="btn btn--primary">Guardar</button>
        </form>
      </Card>
      <Card title="Comandos remotos">
        {!cp.online && <p className="text-warn">El cargador está desconectado: los comandos se habilitan cuando vuelva.</p>}
        {GROUPS.map((g) => (
          <div key={g} className="cmd-group">
            <h3 className="cmd-group__title">{g}</h3>
            <div className="actions">
              {actionsFor(connectorId)
                .filter((a) => a.group === g)
                .map((a) => (
                  <button
                    key={a.label}
                    className={`btn ${a.danger ? 'btn--danger' : ''}`}
                    disabled={!cp.online}
                    title={a.ocpp}
                    onClick={() => {
                      if (a.danger && confirming !== a.label) {
                        setConfirming(a.label);
                        setTimeout(() => setConfirming((c) => (c === a.label ? undefined : c)), 4000);
                        return;
                      }
                      setConfirming(undefined);
                      void run(a.label, a.command);
                    }}
                  >
                    {confirming === a.label ? `¿Confirmar ${a.label.toLowerCase()}? (clic de nuevo)` : a.label}
                  </button>
                ))}
            </div>
          </div>
        ))}
        {log.length > 0 && (
          <ul className="cmd-log mono">
            {log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
      </Card>
        </div>
        <OcppConfigCard />
      </div>
    </div>
  );
};
