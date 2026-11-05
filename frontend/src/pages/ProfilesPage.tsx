import type { ChargingProfileInput, ChargingProfilePurpose, ChargingSchedulePeriod, CompositeSchedule } from '@ev/shared';
import { useMemo, useState } from 'react';
import { Card, EmptyState } from '../components/ui/Card';
import { EmptyHelp } from '../components/ui/EmptyHelp';
import { Icon } from '../components/ui/Icon';
import { Opt, Req } from '../components/ui/Req';
import { cpLabel } from '../lib/format';
import { useAppStore } from '../store';
import { useSelectedChargePoint, useSessionView } from '../store/selectors';

/**
 * Perfiles de carga (Smart Charging, OCPP 1.6 §3.13 / 2.x K01–K08). El CSMS los arma y los
 * envía con SetChargingProfile; el cargador decide si los acepta según sus reglas y sus
 * capacidades (§9.4) y aplica el mínimo entre ChargePointMaxProfile y TxProfile/TxDefaultProfile.
 */

type PeriodDraft = { startPeriod: string; limit: string; numberPhases: string };

interface Draft {
  connectorId: string;
  id: string;
  stackLevel: string;
  purpose: ChargingProfilePurpose;
  kind: ChargingProfileInput['kind'];
  recurrencyKind: '' | 'Daily' | 'Weekly';
  validFrom: string;
  validTo: string;
  transactionId: string;
  unit: 'A' | 'W';
  duration: string;
  startSchedule: string;
  minChargingRate: string;
  periods: PeriodDraft[];
}

const PURPOSE_HELP: Record<ChargingProfilePurpose, string> = {
  ChargePointMaxProfile: 'Límite del cargador completo (solo conector 0). Úsalo para la acometida o balanceo de carga.',
  TxDefaultProfile: 'Límite por defecto para toda transacción nueva (conector 0 = todos los conectores).',
  TxProfile: 'Límite de la transacción en curso (conector > 0). Se descarta al terminar la carga.',
};

const KIND_HELP: Record<ChargingProfileInput['kind'], string> = {
  Absolute: 'Empieza en startSchedule (o ahora si se omite).',
  Relative: 'Empieza cuando empieza la transacción.',
  Recurring: 'Se repite cada día o semana desde startSchedule.',
};

const localNow = (offsetMin = 0) => {
  const d = new Date(Date.now() + offsetMin * 60_000);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const toIso = (local: string) => (local ? new Date(local).toISOString() : undefined);
const intOrUndef = (v: string) => (v.trim() === '' ? undefined : Number.parseInt(v, 10));
const numOrUndef = (v: string) => (v.trim() === '' ? undefined : Number(v));

const empty = (connectorId: number): Draft => ({
  connectorId: String(connectorId),
  id: String(Math.floor(Date.now() / 1000) % 100_000),
  stackLevel: '0',
  purpose: 'TxDefaultProfile',
  kind: 'Absolute',
  recurrencyKind: '',
  validFrom: '',
  validTo: '',
  transactionId: '',
  unit: 'A',
  duration: '',
  startSchedule: '',
  minChargingRate: '',
  periods: [{ startPeriod: '0', limit: '16', numberPhases: '' }],
});

const PRESETS: { label: string; make: (c: number, txId?: string) => Partial<Draft> }[] = [
  {
    label: 'Limitar la carga actual a 10 A',
    make: (c, txId) => ({ connectorId: String(c), purpose: 'TxProfile', kind: 'Relative', stackLevel: '1', transactionId: txId ?? '', periods: [{ startPeriod: '0', limit: '10', numberPhases: '' }] }),
  },
  {
    label: 'Pausar la carga 5 min (0 A) y luego 16 A',
    make: (c, txId) => ({
      connectorId: String(c),
      purpose: 'TxProfile',
      kind: 'Relative',
      stackLevel: '2',
      transactionId: txId ?? '',
      periods: [
        { startPeriod: '0', limit: '0', numberPhases: '' },
        { startPeriod: '300', limit: '16', numberPhases: '' },
      ],
    }),
  },
  {
    label: 'Sin carga de 18:00 a 22:00 todos los días',
    make: () => {
      const d = new Date();
      d.setHours(18, 0, 0, 0);
      const start = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
      return {
        connectorId: '0',
        purpose: 'TxDefaultProfile',
        kind: 'Recurring',
        recurrencyKind: 'Daily',
        stackLevel: '3',
        startSchedule: start,
        duration: String(4 * 3600),
        periods: [{ startPeriod: '0', limit: '0', numberPhases: '' }],
      };
    },
  },
  {
    label: 'Máximo de la estación 5 kW',
    make: () => ({ connectorId: '0', purpose: 'ChargePointMaxProfile', kind: 'Absolute', stackLevel: '0', unit: 'W', periods: [{ startPeriod: '0', limit: '5000', numberPhases: '' }] }),
  },
];

const build = (d: Draft): { connectorId: number; profile: ChargingProfileInput } | string => {
  const connectorId = intOrUndef(d.connectorId);
  const id = intOrUndef(d.id);
  const stackLevel = intOrUndef(d.stackLevel);
  if (connectorId === undefined || Number.isNaN(connectorId)) return 'connectorId es obligatorio';
  if (id === undefined || Number.isNaN(id)) return 'chargingProfileId es obligatorio';
  if (stackLevel === undefined || Number.isNaN(stackLevel)) return 'stackLevel es obligatorio';
  if (d.kind === 'Recurring' && (!d.recurrencyKind || !d.startSchedule)) return 'Recurring necesita recurrencyKind y startSchedule';
  const periods: ChargingSchedulePeriod[] = [];
  for (const [i, p] of d.periods.entries()) {
    const startPeriod = intOrUndef(p.startPeriod);
    const limit = numOrUndef(p.limit);
    if (startPeriod === undefined || limit === undefined || Number.isNaN(startPeriod) || Number.isNaN(limit)) {
      return `Periodo ${i + 1}: startPeriod y limit son obligatorios`;
    }
    periods.push({ startPeriod, limit, ...(p.numberPhases ? { numberPhases: Number(p.numberPhases) } : {}) });
  }
  return {
    connectorId,
    profile: {
      id,
      stackLevel,
      purpose: d.purpose,
      kind: d.kind,
      ...(d.recurrencyKind ? { recurrencyKind: d.recurrencyKind } : {}),
      ...(d.validFrom ? { validFrom: toIso(d.validFrom) } : {}),
      ...(d.validTo ? { validTo: toIso(d.validTo) } : {}),
      ...(d.purpose === 'TxProfile' && d.transactionId ? { transactionId: d.transactionId } : {}),
      schedule: {
        unit: d.unit,
        periods,
        ...(intOrUndef(d.duration) !== undefined ? { duration: intOrUndef(d.duration) } : {}),
        ...(d.startSchedule ? { startSchedule: toIso(d.startSchedule) } : {}),
        ...(numOrUndef(d.minChargingRate) !== undefined ? { minChargingRate: numOrUndef(d.minChargingRate) } : {}),
      },
    },
  };
};

export const ProfilesPage = () => {
  const cp = useSelectedChargePoint();
  const view = useSessionView();
  const connector = useAppStore((s) => s.connectorId);
  const sendCommand = useAppStore((s) => s.sendCommand);
  const [draft, setDraft] = useState<Draft>(() => empty(connector));
  const [log, setLog] = useState<{ at: string; text: string; ok: boolean }[]>([]);
  const [sent, setSent] = useState<{ connectorId: number; profile: ChargingProfileInput; status: string }[]>([]);
  const [composite, setComposite] = useState<CompositeSchedule>();
  const [compDuration, setCompDuration] = useState('3600');
  const [compUnit, setCompUnit] = useState<'' | 'A' | 'W'>('');
  const [busy, setBusy] = useState(false);
  const txId = view.transaction?.id;
  const built = useMemo(() => build(draft), [draft]);

  if (!cp) return (
      <EmptyState title="Selecciona un cargador">
        <EmptyHelp text="Elige una estación en la barra superior o conecta una." />
      </EmptyState>
    );
  const online = cp.online;

  const push = (text: string, ok: boolean) => setLog((l) => [{ at: new Date().toLocaleTimeString('es'), text, ok }, ...l].slice(0, 10));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setPeriod = (i: number, k: keyof PeriodDraft, v: string) =>
    setDraft((d) => ({ ...d, periods: d.periods.map((p, j) => (j === i ? { ...p, [k]: v } : p)) }));

  const run = async (label: string, fn: () => ReturnType<typeof sendCommand>) => {
    setBusy(true);
    try {
      const r = await fn();
      push(`${label}: ${r.status}`, r.accepted);
      return r;
    } catch (e) {
      push(`${label}: ${(e as Error).message}`, false);
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (typeof built === 'string') return;
    const r = await run(`SetChargingProfile #${built.profile.id}`, () => sendCommand({ type: 'SetChargingProfile', ...built }));
    if (r) setSent((s) => [{ ...built, status: r.status }, ...s.filter((x) => x.profile.id !== built.profile.id)]);
  };

  /** Etiqueta en lenguaje de operador + nombre del campo OCPP debajo. */
  const field = (label: string, required: boolean, input: React.ReactNode, help?: string) => {
    const [human, tech] = label.includes('|') ? label.split('|') : [label, undefined];
    return (
    <label className="field">
      <span>
        {human}
        {required ? <Req /> : <Opt />}
        {tech && <code className="field__tech">{tech}</code>}
      </span>
      {input}
      {help && <small className="muted">{help}</small>}
    </label>
    );
  };

  return (
    <div className="page profiles">
      <header className="page__head">
        <div>
          <h1 className="page__title">Perfiles de carga</h1>
          <p className="muted">
            {cpLabel(cp.id)} · Limita cuánta potencia o corriente puede usar el cargador (Smart Charging, SetChargingProfile). <span className="req">●</span> obligatorio ·{' '}
            <span className="opt">*</span> omitible
          </p>
        </div>
      </header>

      <div className="profiles__grid">
        <Card title="Nuevo perfil de carga">
          <div className="row profiles__presets">
            {PRESETS.map((p) => (
              <button key={p.label} className="btn" onClick={() => setDraft({ ...empty(connector), ...p.make(connector, txId) })}>
                {p.label}
              </button>
            ))}
          </div>

          <div className="form-grid">
            {field('Conector|connectorId', true, <input className="input mono" required type="number" min={0} value={draft.connectorId} onChange={(e) => set('connectorId', e.target.value)} />, '0 = cargador completo')}
            {field('Identificador del perfil|chargingProfileId', true, <input className="input mono" required type="number" value={draft.id} onChange={(e) => set('id', e.target.value)} />, 'Mismo id reemplaza al perfil instalado')}
            {field('Prioridad|stackLevel', true, <input className="input mono" required type="number" min={0} value={draft.stackLevel} onChange={(e) => set('stackLevel', e.target.value)} />, 'Mayor = prevalece')}
            {field(
              'Alcance|chargingProfilePurpose',
              true,
              <select className="input" required value={draft.purpose} onChange={(e) => set('purpose', e.target.value as ChargingProfilePurpose)}>
                <option value="ChargePointMaxProfile">Todo el cargador (ChargePointMaxProfile)</option>
                <option value="TxDefaultProfile">Toda carga nueva (TxDefaultProfile)</option>
                <option value="TxProfile">Solo la carga actual (TxProfile)</option>
              </select>,
              PURPOSE_HELP[draft.purpose],
            )}
            {field(
              'Cuándo empieza|chargingProfileKind',
              true,
              <select className="input" required value={draft.kind} onChange={(e) => set('kind', e.target.value as Draft['kind'])}>
                <option value="Absolute">En una fecha/hora (Absolute)</option>
                <option value="Relative">Al iniciar la carga (Relative)</option>
                <option value="Recurring">Se repite (Recurring)</option>
              </select>,
              KIND_HELP[draft.kind],
            )}
            {field(
              'Repetición|recurrencyKind',
              draft.kind === 'Recurring',
              <select className="input" required={draft.kind === 'Recurring'} value={draft.recurrencyKind} onChange={(e) => set('recurrencyKind', e.target.value as Draft['recurrencyKind'])}>
                <option value="">(omitir)</option>
                <option value="Daily">Cada día (Daily)</option>
                <option value="Weekly">Cada semana (Weekly)</option>
              </select>,
            )}
            {draft.purpose === 'TxProfile' &&
              field(
                'Transacción|transactionId',
                false,
                <input className="input mono" value={draft.transactionId} placeholder={txId ?? 'sin transacción activa'} onChange={(e) => set('transactionId', e.target.value)} />,
                txId ? `Transacción activa: #${txId}` : 'El cargador rechaza un TxProfile sin transacción activa',
              )}
            {field('Vigente desde|validFrom', false, <input className="input mono" type="datetime-local" value={draft.validFrom} onChange={(e) => set('validFrom', e.target.value)} />)}
            {field('Vigente hasta|validTo', false, <input className="input mono" type="datetime-local" value={draft.validTo} onChange={(e) => set('validTo', e.target.value)} />)}
          </div>

          <h3 className="profiles__sub">Calendario de límites <code className="field__tech">chargingSchedule</code></h3>
          <div className="form-grid">
            {field(
              'Unidad del límite|chargingRateUnit',
              true,
              <select className="input" required value={draft.unit} onChange={(e) => set('unit', e.target.value as 'A' | 'W')}>
                <option value="A">A (corriente)</option>
                <option value="W">W (potencia)</option>
              </select>,
            )}
            {field('Duración (s)|duration', false, <input className="input mono" type="number" min={0} value={draft.duration} placeholder="sin fin" onChange={(e) => set('duration', e.target.value)} />)}
            {field(
              'Inicio del calendario|startSchedule',
              draft.kind === 'Recurring',
              <span className="row">
                <input className="input mono" type="datetime-local" required={draft.kind === 'Recurring'} value={draft.startSchedule} onChange={(e) => set('startSchedule', e.target.value)} />
                <button type="button" className="btn" onClick={() => set('startSchedule', localNow())}>
                  Ahora
                </button>
              </span>,
            )}
            {field('Mínimo que acepta el EV|minChargingRate', false, <input className="input mono" type="number" min={0} step={0.1} value={draft.minChargingRate} onChange={(e) => set('minChargingRate', e.target.value)} />)}
          </div>

          <table className="table compare profiles__periods">
            <thead>
              <tr>
                <th>
                  Desde (s desde el inicio)
                  <Req />
                </th>
                <th>
                  Límite ({draft.unit})
                  <Req />
                </th>
                <th>
                  Fases
                  <Opt />
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {draft.periods.map((p, i) => (
                <tr key={i}>
                  <td>
                    <input className="input mono" required type="number" min={0} value={p.startPeriod} disabled={i === 0} onChange={(e) => setPeriod(i, 'startPeriod', e.target.value)} />
                  </td>
                  <td>
                    <input className="input mono" required type="number" min={0} step={0.1} value={p.limit} onChange={(e) => setPeriod(i, 'limit', e.target.value)} />
                  </td>
                  <td>
                    <input className="input mono" type="number" min={1} max={3} value={p.numberPhases} placeholder="3" onChange={(e) => setPeriod(i, 'numberPhases', e.target.value)} />
                  </td>
                  <td>
                    {i > 0 && (
                      <button className="icon-btn" aria-label={`Quitar periodo ${i + 1}`} onClick={() => setDraft((d) => ({ ...d, periods: d.periods.filter((_, j) => j !== i) }))}>
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row profiles__submit">
            <button
              className="btn"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  periods: [...d.periods, { startPeriod: String((Number(d.periods.at(-1)?.startPeriod) || 0) + 3600), limit: d.periods.at(-1)?.limit ?? '16', numberPhases: '' }],
                }))
              }
            >
              + Periodo
            </button>
            <span className="spacer" />
            {typeof built === 'string' && <span className="text-warn">{built}</span>}
            {!online && <span className="text-warn">El cargador está desconectado</span>}
            <button className="btn btn--primary" disabled={!online || busy || typeof built === 'string'} onClick={() => void send()}>
              Enviar perfil al cargador
            </button>
          </div>
        </Card>

        <div className="col">
          <Card title="Límite programado">
            <div className="row">
              <label className="field">
                <span>
                  duration (s)
                  <Req />
                </span>
                <select className="input" value={compDuration} onChange={(e) => setCompDuration(e.target.value)}>
                  <option value="3600">1 hora</option>
                  <option value="21600">6 horas</option>
                  <option value="86400">24 horas</option>
                </select>
              </label>
              <label className="field">
                <span>
                  chargingRateUnit
                  <Opt />
                </span>
                <select className="input" value={compUnit} onChange={(e) => setCompUnit(e.target.value as '' | 'A' | 'W')}>
                  <option value="">(omitir)</option>
                  <option value="A">A</option>
                  <option value="W">W</option>
                </select>
              </label>
              <button
                className="btn"
                disabled={!online || busy}
                onClick={async () => {
                  const r = await run('GetCompositeSchedule', () =>
                    sendCommand({ type: 'GetCompositeSchedule', connectorId: connector, duration: Number(compDuration), ...(compUnit ? { unit: compUnit } : {}) }),
                  );
                  setComposite(r?.compositeSchedule);
                }}
              >
                Consultar
              </button>
            </div>
            {composite ? (
              <table className="table compare">
                <thead>
                  <tr>
                    <th>Desde</th>
                    <th>Límite</th>
                  </tr>
                </thead>
                <tbody>
                  {composite.periods.map((p) => (
                    <tr key={p.startPeriod}>
                      <td className="mono">
                        {composite.scheduleStart
                          ? new Date(Date.parse(composite.scheduleStart) + p.startPeriod * 1000).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
                          : `+${p.startPeriod} s`}
                      </td>
                      <td className="mono">
                        {p.limit} {composite.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">Combina los perfiles instalados y el límite físico del equipo para el conector {connector}.</p>
            )}
          </Card>

          <Card title="Enviados desde aquí">
            {sent.length === 0 ? (
              <p className="muted">Todavía no enviaste perfiles a este cargador.</p>
            ) : (
              <ul className="profiles__sent">
                {sent.map((s) => (
                  <li key={s.profile.id}>
                    <span className="mono">
                      #{s.profile.id} · {s.profile.purpose} · stack {s.profile.stackLevel} · conector {s.connectorId}
                    </span>
                    <span className={s.status === 'Accepted' ? 'text-ok' : 'text-danger'}>{s.status}</span>
                    <button
                      className="icon-btn"
                      title="ClearChargingProfile por id"
                      aria-label={`Borrar perfil ${s.profile.id}`}
                      disabled={!online || busy}
                      onClick={async () => {
                        const r = await run(`ClearChargingProfile #${s.profile.id}`, () => sendCommand({ type: 'ClearChargingProfile', id: s.profile.id }));
                        if (r?.accepted) setSent((list) => list.filter((x) => x.profile.id !== s.profile.id));
                      }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              className="btn btn--danger"
              disabled={!online || busy}
              onClick={async () => {
                const r = await run('ClearChargingProfile (todos)', () => sendCommand({ type: 'ClearChargingProfile' }));
                if (r?.accepted) setSent([]);
              }}
            >
              Borrar todos los perfiles del cargador
            </button>
          </Card>

          <Card title="Respuestas">
            {log.length === 0 ? (
              <p className="muted">—</p>
            ) : (
              <ul className="profiles__log">
                {log.map((l, i) => (
                  <li key={i} className={l.ok ? '' : 'text-danger'}>
                    <span className="mono muted">{l.at}</span> {l.text}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};
