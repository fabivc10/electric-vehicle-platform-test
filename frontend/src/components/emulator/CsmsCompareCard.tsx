import { PROTOCOL_LABELS, type ProtocolId } from '@ev/shared';
import { kw, kwh, num } from '../../lib/format';
import { useAppStore } from '../../store';
import { useCsmsView } from '../../store/selectors';
import { Card } from '../ui/Card';

const protoLabel = (p?: string) => (p && p in PROTOCOL_LABELS ? PROTOCOL_LABELS[p as ProtocolId] : (p ?? '—'));

/**
 * Compara el estado del emulador con lo que el CSMS reconstruyó a partir de los
 * mensajes OCPP (vía /live). Las medidas se comparan con la última muestra ENVIADA
 * y solo los measurands que realmente se enviaron.
 */
export const CsmsCompareCard = () => {
  const emu = useAppStore((s) => s.emulator);
  const csms = useCsmsView(emu.config.chargePointId, emu.connectorId);
  const cp = csms.chargePoint;
  const tx = emu.transaction;
  const sent = tx ? emu.lastSample?.values : undefined;
  const r = csms.reading;
  const has = (m: string) => sent?.[m] !== undefined;

  const rows: { label: string; emu: string; csms: string }[] = [
    {
      label: 'Conexión',
      emu: emu.link === 'connected' ? 'En línea' : 'Desconectado',
      csms: !cp ? 'No registrado' : cp.online ? 'En línea' : 'Desconectado',
    },
    { label: 'Protocolo', emu: protoLabel(emu.negotiated), csms: cp?.online ? protoLabel(cp.protocol) : '—' },
    { label: 'BootNotification', emu: emu.bootStatus ?? '—', csms: cp?.bootStatus ?? '—' },
    { label: `Estado conector ${emu.connectorId}`, emu: emu.status, csms: csms.connector?.status ?? '—' },
    ...(emu.config.protocol === 'ocpp1.6'
      ? [
          { label: 'Estado conector 0', emu: emu.stationStatus, csms: cp?.connectors.find((c) => c.id === 0)?.status ?? '—' },
          { label: 'errorCode', emu: emu.errorCode, csms: csms.connector?.errorCode ?? '—' },
        ]
      : []),
    { label: 'Transacción', emu: tx?.id || '—', csms: csms.transaction?.id ?? '—' },
    { label: 'idTag', emu: tx?.idTag ?? '—', csms: csms.transaction?.idTag ?? '—' },
  ];
  // Solo los measurands que el CSMS puede haber recibido.
  if (has('Energy.Active.Import.Register') && tx) {
    rows.push({
      label: 'Energía de la sesión',
      emu: `${kwh(sent!['Energy.Active.Import.Register']! - tx.meterStartWh)} kWh`,
      csms: csms.transaction ? `${kwh(csms.transaction.energyWh)} kWh` : '—',
    });
  }
  if (has('Power.Active.Import')) rows.push({ label: 'Power.Active.Import', emu: `${kw(sent!['Power.Active.Import'])} kW`, csms: `${kw(r.powerW)} kW` });
  if (has('SoC')) rows.push({ label: 'SoC', emu: `${num(sent!.SoC, 0)} %`, csms: `${num(r.socPercent, 0)} %` });
  if (has('Temperature')) rows.push({ label: 'Temperature', emu: `${num(sent!.Temperature)} °C`, csms: `${num(r.temperatureC)} °C` });
  if (has('Voltage')) rows.push({ label: 'Voltage', emu: `${num(sent!.Voltage)} V`, csms: `${num(r.voltageV)} V` });
  if (has('Current.Import')) rows.push({ label: 'Current.Import', emu: `${num(sent!['Current.Import'])} A`, csms: `${num(r.currentA)} A` });

  const mismatches = rows.filter((row) => row.emu !== row.csms).length;

  return (
    <Card
      title="Emulador vs CSMS"
      aside={
        <span className={`tag ${mismatches ? '' : 'tag--ok'}`}>
          {mismatches ? `${mismatches} diferencia${mismatches > 1 ? 's' : ''}` : 'Sincronizado'}
        </span>
      }
    >
      <table className="table compare">
        <thead>
          <tr>
            <th />
            <th>Emulador</th>
            <th>CSMS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className={row.emu !== row.csms ? 'is-diff' : ''}>
              <td className="muted">{row.label}</td>
              <td className="mono">{row.emu}</td>
              <td className="mono">{row.csms}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        <span className="dot dot--info" />
        {emu.lastSample
          ? `Medidas de la última muestra enviada (${emu.lastSample.context}). Solo aparecen los measurands configurados.`
          : 'Aún no se envió ninguna muestra de medidor.'}
      </p>
    </Card>
  );
};
