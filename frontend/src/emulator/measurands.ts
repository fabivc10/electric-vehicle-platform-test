import type { ChargerType, Physics } from './types';

/** ReadingContext (OCPP 1.6 §7.35; mismos valores en 2.x). */
export type ReadingContext =
  | 'Sample.Periodic'
  | 'Sample.Clock'
  | 'Transaction.Begin'
  | 'Transaction.End'
  | 'Trigger'
  | 'Other';

/** Un sampledValue ya medido, independiente del formato de la versión. */
export interface Reading {
  measurand: string;
  value: number;
  unit: string;
  location?: string;
  context: ReadingContext;
}

/** Un MeterValue: lecturas tomadas en el mismo instante (§7.33). */
export interface Sample {
  timestamp: string;
  readings: Reading[];
}

interface MeasurandDef {
  /** UnitOfMeasure (§7.45). */
  unit: string;
  /** Location (§7.30); sin valor = Outlet (por defecto). */
  location?: string;
  digits: number;
  /** Solo un cargador DC conoce el SoC del vehículo (lo informa el EV por la comunicación DC). */
  dcOnly?: boolean;
  read(p: Physics, intervalWh: number): number;
}

/**
 * Measurands (§7.31) que el medidor emulado puede leer. Cualquier otro que pida el CSMS
 * en MeterValuesSampledData/AlignedData/StopTxn* se responde con Rejected (§3.16.4).
 */
const DEFS: Record<string, MeasurandDef> = {
  'Energy.Active.Import.Register': { unit: 'Wh', digits: 0, read: (p) => p.energyWh },
  'Energy.Active.Import.Interval': { unit: 'Wh', digits: 0, read: (_p, intervalWh) => intervalWh },
  'Power.Active.Import': { unit: 'W', digits: 0, read: (p) => p.powerW },
  'Power.Offered': { unit: 'W', digits: 0, read: (p) => p.availableW },
  'Current.Import': { unit: 'A', digits: 1, read: (p) => p.currentA },
  'Current.Offered': { unit: 'A', digits: 1, read: (p) => (p.measuredVoltageV > 0 ? p.availableW / p.measuredVoltageV : 0) },
  Voltage: { unit: 'V', digits: 1, read: (p) => p.measuredVoltageV },
  Temperature: { unit: 'Celsius', location: 'Body', digits: 1, read: (p) => p.measuredTemperatureC },
  SoC: { unit: 'Percent', location: 'EV', digits: 0, dcOnly: true, read: (p) => p.socPercent },
};

export const supportedMeasurands = (type: ChargerType): string[] =>
  Object.entries(DEFS)
    .filter(([, d]) => type === 'DC' || !d.dcOnly)
    .map(([m]) => m);

export const isSupportedMeasurand = (type: ChargerType, measurand: string) =>
  supportedMeasurands(type).includes(measurand);

/** Toma una muestra de los measurands pedidos (los no soportados se omiten). */
export const takeSample = (
  measurands: string[],
  physics: Physics,
  context: ReadingContext,
  type: ChargerType,
  opts: { timestamp: string; intervalWh?: number },
): Sample | undefined => {
  const readings = measurands
    .filter((m) => isSupportedMeasurand(type, m))
    .map((m): Reading => {
      const d = DEFS[m]!;
      const raw = d.read(physics, opts.intervalWh ?? 0);
      return {
        measurand: m,
        value: Number(raw.toFixed(d.digits)),
        unit: d.unit,
        ...(d.location ? { location: d.location } : {}),
        context,
      };
    });
  return readings.length ? { timestamp: opts.timestamp, readings } : undefined;
};
