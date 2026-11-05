import { useState } from 'react';
import type { EmuProtocol } from '../../emulator/types';
import { useAppStore } from '../../store';
import { Card } from '../ui/Card';
import { Req } from '../ui/Req';

interface Preset {
  label: string;
  action: string;
  payload: string;
  raw?: boolean;
}

/** Casos para probar el manejo de errores del CSMS (FormatViolation, NotImplemented, framing). */
const presets = (protocol: EmuProtocol): Preset[] => [
  {
    label: 'DataTransfer',
    action: 'DataTransfer',
    payload: JSON.stringify({ vendorId: 'EVPlatform', messageId: 'Ping', data: 'hola' }, null, 2),
  },
  {
    label: 'Authorize',
    action: 'Authorize',
    payload: JSON.stringify(protocol === 'ocpp1.6' ? { idTag: 'TAG-001' } : { idToken: { idToken: 'TAG-001', type: 'ISO14443' } }, null, 2),
  },
  {
    label: 'Payload inválido → FormatViolation',
    action: 'StatusNotification',
    payload: JSON.stringify({ connectorId: 'uno', status: 'Volando' }, null, 2),
  },
  { label: 'Acción desconocida → NotImplemented', action: 'AccionInventada', payload: '{}' },
  { label: 'Frame mal formado (texto crudo)', action: '', payload: '[2, "abc", "Heartbeat"', raw: true },
  { label: 'Tipo de mensaje inválido (texto crudo)', action: '', payload: '[9, "abc", "Heartbeat", {}]', raw: true },
];

/** Mensajes manuales y política de respuesta a comandos remotos. */
export const ManualCard = () => {
  const emu = useAppStore((s) => s.emulator);
  const device = useAppStore((s) => s.emulatorDevice);
  const online = emu.link === 'connected';
  const booted = online && emu.bootStatus === 'Accepted';
  const [action, setAction] = useState('DataTransfer');
  const [payload, setPayload] = useState(presets(emu.config.protocol)[0]!.payload);
  const [raw, setRaw] = useState(false);
  const [error, setError] = useState<string>();

  const applyPreset = (index: number) => {
    const p = presets(emu.config.protocol)[index];
    if (!p) return;
    setAction(p.action);
    setPayload(p.payload);
    setRaw(Boolean(p.raw));
    setError(undefined);
  };

  const send = () => {
    setError(undefined);
    if (raw) return device.sendRawText(payload);
    try {
      const parsed: unknown = JSON.parse(payload || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('El payload debe ser un objeto JSON');
      device.sendCustom(action.trim(), parsed as Record<string, unknown>);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Card title="Mensajes y comandos">
      <div className="actions">
        <button className="btn" disabled={!online} onClick={() => device.sendBoot()}>
          BootNotification
        </button>
        <button className="btn" disabled={!booted} onClick={() => device.sendHeartbeat()}>
          Heartbeat
        </button>
        <button className="btn" disabled={!booted} onClick={() => device.sendStatus()}>
          StatusNotification
        </button>
      </div>

      <label className="check emu-reject">
        <input type="checkbox" checked={emu.settings.rejectRemote} onChange={(e) => device.updateSettings({ rejectRemote: e.target.checked })} />
        Rechazar comandos remotos del CSMS (RemoteStart/Stop, Reset, Unlock…)
      </label>

      <div className="emu-call">
        <label className="field">
          <span>Plantilla</span>
          <select className="input" defaultValue="" onChange={(e) => applyPreset(Number(e.target.value))}>
            <option value="" disabled>
              Elegir…
            </option>
            {presets(emu.config.protocol).map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} />
          Enviar como texto crudo (sin framing)
        </label>
        {!raw && (
          <label className="field">
            <span>
              Acción (CALL)
              <Req />
            </span>
            <input className="input mono" required value={action} onChange={(e) => setAction(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span>
            {raw ? 'Texto' : 'Payload JSON'}
            <Req />
          </span>
          <textarea required className="input textarea mono" rows={6} value={payload} spellCheck={false} onChange={(e) => setPayload(e.target.value)} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn--primary" disabled={!online || (!raw && !action.trim())} onClick={send}>
          Enviar
        </button>
      </div>
    </Card>
  );
};
