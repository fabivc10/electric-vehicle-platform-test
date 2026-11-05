import type { ActivityEntry, ChargePoint, Connector, MeterSample, Transaction } from '@ev/shared';
import { useMemo } from 'react';
import { useAppStore } from './index';

const EMPTY_TX: Transaction[] = [];
const EMPTY_METERS: MeterSample[] = [];
const EMPTY_ACTIVITY: ActivityEntry[] = [];

export const useSelectedChargePoint = () =>
  useAppStore((s) => (s.selectedId ? s.chargePoints[s.selectedId] : undefined));

export const useActivity = () =>
  useAppStore((s) => (s.selectedId ? (s.activity[s.selectedId] ?? EMPTY_ACTIVITY) : EMPTY_ACTIVITY));

export type Reading = Omit<MeterSample, 'chargePointId' | 'connectorId' | 'timestamp' | 'transactionId'> & {
  timestamp?: string;
};

/**
 * Lectura consolidada del conector: algunos cargadores envían cada measurand en
 * mensajes distintos, así que se toma el último valor conocido de cada campo.
 */
const consolidate = (samples: MeterSample[]): Reading => {
  const out: Reading = {};
  for (const s of samples) {
    for (const [k, v] of Object.entries(s)) {
      if (v !== undefined && k !== 'chargePointId' && k !== 'connectorId' && k !== 'transactionId') {
        (out as Record<string, unknown>)[k] = v;
      }
    }
  }
  return out;
};

/** Estima minutos hasta 100 % con la pendiente de SoC de las últimas muestras. */
const estimateMinutesToFull = (samples: MeterSample[]): number | undefined => {
  const withSoc = samples.filter((s) => s.socPercent !== undefined).slice(-24);
  if (withSoc.length < 2) return undefined;
  const first = withSoc[0]!;
  const last = withSoc[withSoc.length - 1]!;
  const minutes = (Date.parse(last.timestamp) - Date.parse(first.timestamp)) / 60_000;
  const rate = (last.socPercent! - first.socPercent!) / minutes; // % por minuto
  if (!(minutes > 0) || !(rate > 0)) return undefined;
  return Math.max(0, Math.round((100 - last.socPercent!) / rate));
};

export interface SessionView {
  connector?: Connector;
  transaction?: Transaction;
  reading: Reading;
  powerHistory: number[];
  minutesToFull?: number;
  /** Última MeterValues recibida para el conector (o la transacción activa). */
  lastSampleAt?: string;
}

/** Todo lo que necesita la vista "Sesión" para el conector seleccionado. */
export const useSessionView = (): SessionView => {
  const cp = useSelectedChargePoint();
  const connectorId = useAppStore((s) => s.connectorId);
  const active = useAppStore((s) => (s.selectedId ? (s.activeTransactions[s.selectedId] ?? EMPTY_TX) : EMPTY_TX));
  const meters = useAppStore((s) => (s.selectedId ? (s.meters[s.selectedId] ?? EMPTY_METERS) : EMPTY_METERS));

  return useMemo(() => {
    const connector = cp?.connectors.find((c) => c.id === connectorId);
    const transaction = active.find((t) => t.connectorId === connectorId);
    // Sin transacción activa solo cuentan muestras fuera de transacción: no se muestran
    // como actuales los valores de una sesión ya terminada.
    const forConnector = meters.filter(
      (m) => m.connectorId === connectorId && (transaction ? m.transactionId === transaction.id : !m.transactionId),
    );
    return {
      connector,
      transaction,
      reading: consolidate(forConnector.slice(-12)),
      powerHistory: forConnector.filter((m) => m.powerW !== undefined).slice(-40).map((m) => m.powerW!),
      minutesToFull: transaction ? estimateMinutesToFull(forConnector) : undefined,
      lastSampleAt: forConnector.at(-1)?.timestamp,
    };
  }, [cp, connectorId, active, meters]);
};

export interface CsmsView {
  chargePoint?: ChargePoint;
  connector?: Connector;
  transaction?: Transaction;
  reading: Reading;
}

/** Lo que el CSMS sabe de un cargador concreto (para compararlo con el emulador). */
export const useCsmsView = (chargePointId: string, connectorId: number): CsmsView => {
  const cp = useAppStore((s) => s.chargePoints[chargePointId]);
  const active = useAppStore((s) => s.activeTransactions[chargePointId] ?? EMPTY_TX);
  const meters = useAppStore((s) => s.meters[chargePointId] ?? EMPTY_METERS);

  return useMemo(() => {
    const transaction = active.find((t) => t.connectorId === connectorId);
    const forConnector = meters.filter(
      (m) => m.connectorId === connectorId && (transaction ? m.transactionId === transaction.id : !m.transactionId),
    );
    return {
      chargePoint: cp,
      connector: cp?.connectors.find((c) => c.id === connectorId),
      transaction,
      reading: consolidate(forConnector.slice(-12)),
    };
  }, [cp, connectorId, active, meters]);
};
