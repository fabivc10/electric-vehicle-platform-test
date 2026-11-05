import { PROTOCOL_LABELS } from '@ev/shared';
import { defaultBaseUrl } from '../../emulator/EmulatedCharger';
import { type ChargerType, EMU_PROTOCOLS, type EmuProtocol, type LinkState, type NetworkQuality } from '../../emulator/types';
import { ago, fmtTimeSec } from '../../lib/format';
import { useNow } from '../../lib/useNow';
import { useAppStore } from '../../store';
import { Card } from '../ui/Card';
import { Opt, Req } from '../ui/Req';

const LINK_LABEL: Record<LinkState, string> = {
  offline: 'Sin comunicación',
  connecting: 'Conectando…',
  connected: 'Conectado',
};

type TextKey = 'chargePointId' | 'baseUrl' | 'vendor' | 'model' | 'serialNumber' | 'firmwareVersion';

export const ConnectionCard = () => {
  const now = useNow(1000);
  const emu = useAppStore((s) => s.emulator);
  const device = useAppStore((s) => s.emulatorDevice);
  const { config, link, powered } = emu;
  const base = (config.baseUrl || defaultBaseUrl()).replace(/\/+$/, '');
  const heartbeat = emu.configuration.find((c) => c.key === 'HeartbeatInterval')?.value;

  const text = (key: TextKey, label: string, max?: number, wide = false, placeholder?: string, required = false) => (
    <label className={`field ${wide ? 'field--wide' : ''}`}>
      <span>
        {label}
        {required ? <Req /> : <Opt />}
      </span>
      <input
        className="input mono"
        required={required}
        value={config[key]}
        placeholder={placeholder}
        maxLength={max}
        disabled={powered}
        onChange={(e) => device.configure({ [key]: e.target.value })}
      />
    </label>
  );

  return (
    <Card
      title="Equipo y conexión"
      aside={
        <span className={`tag ${link === 'connected' ? 'tag--ok' : ''}`}>
          {powered ? LINK_LABEL[link] : 'Apagado'}
        </span>
      }
    >
      <div className="form-grid">
        {text('chargePointId', 'ID del cargador', 48, false, undefined, true)}
        <label className="field">
          <span>Versión OCPP</span>
          <select
            className="input"
            value={config.protocol}
            disabled={powered}
            onChange={(e) => device.configure({ protocol: e.target.value as EmuProtocol })}
          >
            {EMU_PROTOCOLS.map((p) => (
              <option key={p} value={p}>
                {PROTOCOL_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Tipo de cargador</span>
          <select
            className="input"
            value={config.chargerType}
            disabled={powered}
            onChange={(e) => device.configure({ chargerType: e.target.value as ChargerType })}
          >
            <option value="AC">AC monofásico (J1772 / Tipo 2)</option>
            <option value="DC">DC (CCS / CHAdeMO)</option>
          </select>
        </label>
        {text('baseUrl', 'URL base del CSMS', undefined, false, defaultBaseUrl())}
        <label className="field field--wide">
          <span>Calidad de la red (módem del equipo)</span>
          <select
            className="input"
            value={emu.settings.network}
            onChange={(e) => device.updateSettings({ network: e.target.value as NetworkQuality })}
          >
            <option value="stable">Estable</option>
            <option value="slow">Lenta: latencia 0,4–1,5 s por mensaje</option>
            <option value="unstable">Inestable: latencia + cortes de señal + WeakSignal en conector 0</option>
          </select>
        </label>
      </div>
      <p className="muted mono emu-url">
        {base}/{encodeURIComponent(config.chargePointId)} · Sec-WebSocket-Protocol: {config.protocol}
      </p>

      <details className="emu-details">
        <summary>Identidad enviada en BootNotification</summary>
        <div className="form-grid">
          {text('vendor', 'Fabricante (chargePointVendor, máx. 20)', 20, false, undefined, true)}
          {text('model', 'Modelo (chargePointModel, máx. 20)', 20, false, undefined, true)}
          {text('serialNumber', 'N.º de serie (máx. 25)', 25)}
          {text('firmwareVersion', 'Firmware (máx. 50)', 50)}
        </div>
      </details>

      <dl className="kv">
        <dt>Subprotocolo negociado</dt>
        <dd className="mono">{emu.negotiated ?? '—'}</dd>
        <dt>BootNotification</dt>
        <dd className={emu.bootStatus === 'Accepted' ? 'text-ok' : emu.bootStatus ? 'text-warn' : ''}>
          {emu.bootStatus ?? '—'}
          {emu.nextBootAt && ` · reintento ${fmtTimeSec(emu.nextBootAt)}`}
        </dd>
        <dt>HeartbeatInterval</dt>
        <dd>{heartbeat && heartbeat !== '0' ? `${heartbeat} s de inactividad` : '—'}</dd>
        <dt>Último Heartbeat</dt>
        <dd>{ago(emu.lastHeartbeatAt, now)}</dd>
        <dt>Reloj vs CSMS</dt>
        <dd>{emu.bootStatus ? `${(emu.clockOffsetMs / 1000).toFixed(1)} s` : '—'}</dd>
        <dt>Cola de transacción</dt>
        <dd className={emu.queueLength ? 'text-warn' : ''}>{emu.queueLength} mensaje(s)</dd>
      </dl>

      <div className="actions emu-actions">
        {!powered ? (
          <button className="btn btn--primary" disabled={!config.chargePointId.trim()} onClick={() => device.powerOn()}>
            Encender
          </button>
        ) : (
          <>
            <button className="btn btn--danger" onClick={() => device.powerOff()} title="Corte de energía: la transacción se cierra con Reason PowerLoss al volver">
              Apagar
            </button>
            {link === 'offline' ? (
              <button className="btn" onClick={() => device.connect()}>
                Restablecer comunicación
              </button>
            ) : (
              <button className="btn" onClick={() => device.disconnect()} title="El equipo sigue operando y encola los mensajes de transacción (§3.7)">
                Cortar comunicación
              </button>
            )}
          </>
        )}
      </div>
      {emu.lastError && <p className="error-text">{emu.lastError}</p>}
    </Card>
  );
};
