/**
 * Smart Charging del Charge Point (OCPP 1.6 §3.13, §5.5, §5.7, §5.16; tipos §7.8–7.14).
 * Modelo interno común; profiles.ts traduce desde 1.6 (csChargingProfiles) y 2.x (chargingProfile).
 *
 * Reglas implementadas:
 *  - ChargePointMaxProfile solo en connectorId 0; TxProfile solo en connectorId > 0 y con una
 *    transacción activa en ese conector (si trae transactionId debe coincidir) → si no, Rejected.
 *  - Mismo chargingProfileId, o mismo stackLevel + purpose (+ conector) → reemplaza (§3.13.2).
 *  - Por propósito prevalece el de mayor stackLevel vigente en ese instante; un TxDefaultProfile
 *    del conector reemplaza al del conector 0 para ese conector (§3.13.1).
 *  - TxProfile reemplaza a TxDefaultProfile durante su transacción; al terminar se descarta.
 *  - Límite efectivo = mínimo entre ChargePointMaxProfile y (TxProfile ?? TxDefaultProfile) (§3.13.3).
 *  - Absolute (desde startSchedule), Relative (desde el inicio de la transacción), Recurring Daily/Weekly.
 *  - numberPhases por defecto 3 (§7.14); un equipo monofásico usa 1.
 */

export type Purpose = 'ChargePointMaxProfile' | 'TxDefaultProfile' | 'TxProfile';
export type Kind = 'Absolute' | 'Recurring' | 'Relative';
export type RateUnit = 'A' | 'W';

export interface SchedulePeriod {
  startPeriod: number;
  limit: number;
  numberPhases?: number;
}

export interface ChargingProfile {
  id: number;
  connectorId: number;
  transactionId?: string;
  stackLevel: number;
  purpose: Purpose;
  kind: Kind;
  recurrencyKind?: 'Daily' | 'Weekly';
  validFrom?: string;
  validTo?: string;
  schedule: {
    duration?: number;
    startSchedule?: string;
    unit: RateUnit;
    periods: SchedulePeriod[];
    minChargingRate?: number;
  };
}

export interface Limits {
  maxStackLevel: number;
  maxPeriods: number;
  maxInstalled: number;
  allowedUnits: RateUnit[];
  connectors: number;
}

export interface TxContext {
  connectorId: number;
  transactionId: string;
  startedAt: number;
}

export interface ElectricalContext {
  voltageV: number;
  /** Fases físicas del equipo (AC monofásico = 1, DC = 1). */
  phases: number;
}

export interface EffectiveLimit {
  /** Límite en W para el conector, ya combinado. undefined = sin perfiles vigentes. */
  watts?: number;
  /** Corriente equivalente (A). */
  amps?: number;
  /** Qué perfil impone el límite. */
  source?: { purpose: Purpose; id: number; stackLevel: number };
}

export type SetResult = { status: 'Accepted' } | { status: 'Rejected'; reason: string };

const DAY = 86_400;
const WEEK = 7 * DAY;

export class SmartChargingStore {
  private profiles: ChargingProfile[] = [];

  list(): ChargingProfile[] {
    return this.profiles.map((p) => structuredClone(p));
  }

  set(profile: ChargingProfile, limits: Limits, tx?: TxContext): SetResult {
    const p = profile;
    const reject = (reason: string): SetResult => ({ status: 'Rejected', reason });
    if (p.connectorId < 0 || p.connectorId > limits.connectors) return reject(`connectorId ${p.connectorId} no existe`);
    if (p.purpose === 'ChargePointMaxProfile' && p.connectorId !== 0) return reject('ChargePointMaxProfile solo en connectorId 0');
    if (p.purpose === 'TxProfile') {
      if (p.connectorId === 0) return reject('TxProfile solo en connectorId > 0');
      if (!tx || tx.connectorId !== p.connectorId) return reject('TxProfile sin transacción activa en el conector');
      if (p.transactionId && p.transactionId !== tx.transactionId) return reject(`transactionId ${p.transactionId} no es la transacción activa`);
      p.transactionId = tx.transactionId;
    } else if (p.transactionId) {
      return reject('transactionId solo es válido en TxProfile');
    }
    if (p.stackLevel < 0 || p.stackLevel > limits.maxStackLevel) return reject(`stackLevel fuera de 0–${limits.maxStackLevel} (ChargeProfileMaxStackLevel)`);
    if (!p.schedule.periods.length) return reject('chargingSchedulePeriod vacío');
    if (p.schedule.periods.length > limits.maxPeriods) return reject(`más de ${limits.maxPeriods} periodos (ChargingScheduleMaxPeriods)`);
    if (!limits.allowedUnits.includes(p.schedule.unit)) return reject(`chargingRateUnit ${p.schedule.unit} no permitido`);
    if (p.schedule.periods[0]!.startPeriod !== 0) return reject('el primer periodo debe tener startPeriod 0');
    for (let i = 1; i < p.schedule.periods.length; i++) {
      if (p.schedule.periods[i]!.startPeriod <= p.schedule.periods[i - 1]!.startPeriod) return reject('startPeriod debe ser creciente');
    }
    if (p.schedule.periods.some((x) => x.limit < 0)) return reject('limit negativo');
    if (p.kind === 'Recurring' && !p.recurrencyKind) return reject('Recurring requiere recurrencyKind');
    if (p.kind === 'Recurring' && !p.schedule.startSchedule) return reject('Recurring requiere startSchedule');

    const rest = this.profiles.filter(
      (x) => x.id !== p.id && !(x.stackLevel === p.stackLevel && x.purpose === p.purpose && x.connectorId === p.connectorId),
    );
    if (rest.length + 1 > limits.maxInstalled) return reject(`ya hay ${limits.maxInstalled} perfiles (MaxChargingProfilesInstalled)`);
    this.profiles = [...rest, structuredClone(p)];
    return { status: 'Accepted' };
  }

  /** ClearChargingProfile (§5.5): sin criterios borra todos. Devuelve Unknown si no borró nada. */
  clear(c: { id?: number; connectorId?: number; purpose?: Purpose; stackLevel?: number }): 'Accepted' | 'Unknown' {
    const match = (p: ChargingProfile) =>
      c.id !== undefined
        ? p.id === c.id
        : (c.connectorId === undefined || p.connectorId === c.connectorId) &&
          (c.purpose === undefined || p.purpose === c.purpose) &&
          (c.stackLevel === undefined || p.stackLevel === c.stackLevel);
    const before = this.profiles.length;
    this.profiles = this.profiles.filter((p) => !match(p));
    return this.profiles.length < before ? 'Accepted' : 'Unknown';
  }

  /** §3.13.1: al terminar la transacción el TxProfile se descarta. */
  endTransaction(transactionId: string) {
    this.profiles = this.profiles.filter((p) => !(p.purpose === 'TxProfile' && p.transactionId === transactionId));
  }

  /** Límite (en la unidad del perfil) vigente para un perfil en el instante t (ms). */
  private limitOf(p: ChargingProfile, t: number, tx?: TxContext): SchedulePeriod | undefined {
    if (p.validFrom && t < Date.parse(p.validFrom)) return undefined;
    if (p.validTo && t >= Date.parse(p.validTo)) return undefined;
    let start: number;
    if (p.kind === 'Relative') {
      if (!tx) return undefined;
      start = tx.startedAt;
    } else if (p.kind === 'Recurring') {
      const s0 = Date.parse(p.schedule.startSchedule!);
      const cycle = (p.recurrencyKind === 'Weekly' ? WEEK : DAY) * 1000;
      start = t >= s0 ? s0 + Math.floor((t - s0) / cycle) * cycle : s0 - cycle;
    } else {
      start = p.schedule.startSchedule ? Date.parse(p.schedule.startSchedule) : p.validFrom ? Date.parse(p.validFrom) : t;
    }
    const offset = (t - start) / 1000;
    if (offset < 0) return undefined;
    if (p.schedule.duration !== undefined && offset >= p.schedule.duration) return undefined;
    let found: SchedulePeriod | undefined;
    for (const per of p.schedule.periods) if (per.startPeriod <= offset) found = per;
    return found;
  }

  /** Perfil prevaleciente de un propósito para el conector (mayor stackLevel vigente). */
  private prevailing(purpose: Purpose, connectorId: number, t: number, tx?: TxContext) {
    const candidates = this.profiles.filter((p) => {
      if (p.purpose !== purpose) return false;
      if (purpose === 'ChargePointMaxProfile') return p.connectorId === 0;
      if (purpose === 'TxProfile') return p.connectorId === connectorId && tx?.connectorId === connectorId && p.transactionId === tx.transactionId;
      return p.connectorId === connectorId || p.connectorId === 0;
    });
    // TxDefaultProfile del conector reemplaza al del conector 0 (§3.13.1).
    const specific = purpose === 'TxDefaultProfile' && candidates.some((p) => p.connectorId === connectorId);
    const pool = specific ? candidates.filter((p) => p.connectorId === connectorId) : candidates;
    const active = pool
      .map((p) => ({ p, period: this.limitOf(p, t, tx) }))
      .filter((x): x is { p: ChargingProfile; period: SchedulePeriod } => Boolean(x.period))
      .sort((a, b) => b.p.stackLevel - a.p.stackLevel);
    return active[0];
  }

  private toWatts(unit: RateUnit, period: SchedulePeriod, el: ElectricalContext) {
    if (unit === 'W') return period.limit;
    const phases = Math.min(period.numberPhases ?? 3, el.phases);
    return period.limit * el.voltageV * phases;
  }

  effective(connectorId: number, t: number, el: ElectricalContext, tx?: TxContext): EffectiveLimit {
    const cpMax = this.prevailing('ChargePointMaxProfile', connectorId, t, tx);
    const txLimit = (tx && this.prevailing('TxProfile', connectorId, t, tx)) || this.prevailing('TxDefaultProfile', connectorId, t, tx);
    const options = [cpMax, txLimit]
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .map((x) => ({ x, w: this.toWatts(x.p.schedule.unit, x.period, el) }))
      .sort((a, b) => a.w - b.w);
    const best = options[0];
    if (!best) return {};
    return {
      watts: best.w,
      amps: el.voltageV > 0 ? best.w / (el.voltageV * el.phases) : undefined,
      source: { purpose: best.x.p.purpose, id: best.x.p.id, stackLevel: best.x.p.stackLevel },
    };
  }

  /**
   * GetCompositeSchedule (§5.7): límite combinado (perfiles + límite físico del equipo),
   * muestreado cada minuto y comprimido en periodos.
   */
  composite(connectorId: number, durationSec: number, unit: RateUnit, el: ElectricalContext, hardwareW: number, tx?: TxContext, now = Date.now()) {
    const periods: SchedulePeriod[] = [];
    for (let s = 0; s < durationSec; s += 60) {
      const e = this.effective(connectorId, now + s * 1000, el, tx);
      const w = Math.min(e.watts ?? hardwareW, hardwareW);
      const limit = unit === 'W' ? Math.round(w) : Math.round((w / (el.voltageV * el.phases)) * 10) / 10;
      if (periods.at(-1)?.limit !== limit) periods.push({ startPeriod: s, limit });
    }
    return { scheduleStart: new Date(now).toISOString(), duration: durationSec, unit, periods };
  }
}
