import type { MeterSample } from '@ev/shared';

/** Muestra ya convertida a número, con unidad textual (formato común 1.6 / 2.x). */
export interface RawSample {
  value: number;
  measurand?: string;
  unit?: string;
  phase?: string;
  context?: string;
}

type Reading = Pick<
  MeterSample,
  'powerW' | 'energyWh' | 'voltageV' | 'currentA' | 'socPercent' | 'temperatureC' | 'powerOfferedW'
>;

const DEFAULT_MEASURAND = 'Energy.Active.Import.Register';

const DEFAULT_UNIT: Record<string, string> = {
  'Energy.Active.Import.Register': 'Wh',
  'Power.Active.Import': 'W',
  'Power.Offered': 'W',
  Voltage: 'V',
  'Current.Import': 'A',
  'Current.Offered': 'A',
  SoC: 'Percent',
  Temperature: 'Celsius',
};

const MEASURAND_TO_FIELD: Record<string, keyof Reading> = {
  'Energy.Active.Import.Register': 'energyWh',
  'Power.Active.Import': 'powerW',
  'Power.Offered': 'powerOfferedW',
  Voltage: 'voltageV',
  'Current.Import': 'currentA',
  SoC: 'socPercent',
  Temperature: 'temperatureC',
};

/** Lleva cada unidad a la base del dominio (W, Wh, V, A, °C, %). */
const toBaseUnit = (value: number, unit: string): number => {
  switch (unit) {
    case 'kW':
    case 'kWh':
      return value * 1000;
    case 'Fahrenheit':
      return ((value - 32) * 5) / 9;
    case 'K':
      return value - 273.15;
    default:
      return value;
  }
};

/**
 * Convierte sampledValues (de uno o varios MeterValue) en una lectura normalizada.
 * Con valores por fase: tensión = promedio de fases, corriente = máximo de fases,
 * potencia/energía = suma. Un valor sin fase siempre gana sobre los valores por fase.
 */
export const toReading = (samples: RawSample[]): Reading => {
  const total: Partial<Record<keyof Reading, number>> = {};
  const perPhase: Partial<Record<keyof Reading, number[]>> = {};

  for (const s of samples) {
    const measurand = s.measurand ?? DEFAULT_MEASURAND;
    const field = MEASURAND_TO_FIELD[measurand];
    if (!field || !Number.isFinite(s.value)) continue;
    const value = toBaseUnit(s.value, s.unit ?? DEFAULT_UNIT[measurand] ?? '');

    if (!s.phase) total[field] = value;
    else if (s.phase !== 'N') (perPhase[field] ??= []).push(value); // el neutro se ignora
  }

  for (const [field, values] of Object.entries(perPhase) as [keyof Reading, number[]][]) {
    if (total[field] !== undefined || values.length === 0) continue;
    if (field === 'voltageV') total[field] = values.reduce((a, b) => a + b, 0) / values.length;
    else if (field === 'currentA') total[field] = Math.max(...values);
    else total[field] = values.reduce((a, b) => a + b, 0);
  }
  return total;
};

export const summarizeReading = (r: Reading): string => {
  if (r.powerW !== undefined) return `${(r.powerW / 1000).toFixed(1)} kW`;
  if (r.socPercent !== undefined) return `SoC ${Math.round(r.socPercent)} %`;
  if (r.energyWh !== undefined) return `${(r.energyWh / 1000).toFixed(2)} kWh`;
  return 'OK';
};
