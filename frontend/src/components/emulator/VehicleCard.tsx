import { useState } from 'react';
import { ERROR_CODES } from '../../emulator/types';
import { fmtTime, fmtTimeSec, kwh } from '../../lib/format';
import { STATUS_LABEL, STATUS_TONE } from '../../lib/status';
import { useAppStore } from '../../store';
import { LazyCarScene as CarScene } from '../session/LazyCarScene';
import { Card } from '../ui/Card';

/** Acciones físicas sobre el conector: cable, tarjeta RFID, pausas y fallas. */
export const VehicleCard = () => {
  const emu = useAppStore((s) => s.emulator);
  const device = useAppStore((s) => s.emulatorDevice);
  const [idTag, setIdTag] = useState('');
  const tx = emu.transaction;
  const maxTag = emu.config.protocol === 'ocpp1.6' ? 20 : 36;
  const p = emu.physics;

  return (
    <Card
      title={`Vehículo · conector ${emu.connectorId}`}
      className="emu-vehicle"
      aside={
        <span className="pill pill--status">
          <span className={`dot dot--${STATUS_TONE[emu.status]}`} />
          {emu.status}
        </span>
      }
    >
      <div className="emu-scene">
        <CarScene soc={p.socPercent} charging={emu.status === 'Charging'} plugged={emu.plugged} />
      </div>

      <div className="emu-facts">
        <span>
          {STATUS_LABEL[emu.status]}
          {emu.errorCode !== 'NoError' && ` · ${emu.errorCode}`}
          {emu.info && ` · ${emu.info}`}
        </span>
        <span>{(p.powerW / 1000).toFixed(2)} kW</span>
        <span>SoC {Math.round(p.socPercent)} %{emu.config.chargerType === 'AC' && ' (no reportable en AC)'}</span>
        {tx ? (
          <span>
            Transacción <strong className="mono">{tx.id ? `#${tx.id.length > 12 ? `${tx.id.slice(0, 8)}…` : tx.id}` : '(esperando id)'}</strong> ·{' '}
            {tx.idTag} · desde {fmtTime(tx.startedAt)} · {kwh(p.energyWh - tx.meterStartWh)} kWh
          </span>
        ) : emu.authorizedIdTag ? (
          <span className="text-warn">
            {emu.authorizedIdTag} autorizado · conecta el cable
            {emu.authorizedUntil && ` antes de ${fmtTimeSec(emu.authorizedUntil)} (ConnectionTimeOut)`}
          </span>
        ) : (
          <span className="muted">Sin transacción</span>
        )}
        {emu.lastAuthorization && (
          <span className={emu.lastAuthorization.status === 'Accepted' ? 'text-ok' : 'text-danger'}>
            idTagInfo {emu.lastAuthorization.idTag}: {emu.lastAuthorization.status}
          </span>
        )}
        {emu.scheduledAvailability !== undefined && (
          <span className="text-warn">
            ChangeAvailability programado: {emu.scheduledAvailability ? 'Operative' : 'Inoperative'} al terminar la transacción
          </span>
        )}
      </div>

      <div className="actions">
        <button
          className={`btn ${emu.plugged ? '' : 'btn--primary'}`}
          disabled={!emu.powered}
          onClick={() => (emu.plugged ? device.unplug() : device.plugIn())}
        >
          {emu.plugged ? 'Desconectar cable (lado EV)' : 'Conectar cable'}
        </button>
        <form
          className="row emu-card-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            device.presentCard(idTag);
          }}
        >
          <input
            className="input mono"
            value={idTag}
            onChange={(e) => setIdTag(e.target.value)}
            placeholder="idTag de la tarjeta"
            aria-label="idTag de la tarjeta (obligatorio)"
            required
            disabled={!emu.powered}
            maxLength={maxTag}
          />
          <button className="btn" disabled={!emu.powered || !idTag.trim()}>
            Presentar tarjeta
          </button>
        </form>
        <button className="btn btn--danger" disabled={!tx} onClick={() => device.stopLocal()}>
          Botón de parada
        </button>
      </div>

      <div className="emu-toggles">
        <label className="check">
          <input type="checkbox" checked={emu.evSuspended} disabled={!emu.powered} onChange={(e) => device.setEvSuspended(e.target.checked)} />
          El vehículo no acepta energía <span className="mono muted">→ SuspendedEV (C4)</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={emu.evseSuspended} disabled={!emu.powered} onChange={(e) => device.setEvseSuspended(e.target.checked)} />
          El cargador no ofrece energía <span className="mono muted">→ SuspendedEVSE (C5)</span>
        </label>
        <div className="row">
          <label className="check">
            <input
              type="checkbox"
              checked={emu.faulted}
              disabled={!emu.powered}
              onChange={(e) => device.setFault(e.target.checked, emu.manualErrorCode)}
            />
            Falla que impide cargar <span className="mono muted">→ Faulted</span>
          </label>
          <label className="field">
            <span>errorCode {!emu.faulted && emu.manualErrorCode !== 'NoError' ? '(advertencia)' : ''}</span>
            <select className="input" value={emu.manualErrorCode} disabled={!emu.powered} onChange={(e) => device.setFault(emu.faulted, e.target.value)}>
              {ERROR_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        {emu.protection && (
          <p className={emu.protection.faulted ? 'error-text' : 'text-warn'}>
            Protección del equipo: {emu.protection.code}
            {emu.protection.faulted ? ' → Faulted (carga detenida hasta normalizarse)' : ' → aviso, potencia reducida'}
          </p>
        )}
        {emu.config.protocol !== 'ocpp1.6' && (
          <p className="muted">En 2.x el StatusNotification no lleva errorCode: solo se informa el estado Faulted.</p>
        )}
        {(!emu.operative || !emu.stationOperative) && <p className="text-warn">Inoperativo por ChangeAvailability del CSMS</p>}
      </div>
    </Card>
  );
};
