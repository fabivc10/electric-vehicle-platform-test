import type { ActivityEntry, ChargePoint, MeterSample, Transaction, TransactionState } from '@ev/shared';

/**
 * Repository pattern: el dominio solo depende de estas interfaces.
 * Hoy existe la implementación en memoria (infrastructure/persistence/memory);
 * para usar Postgres/SQLite/Redis se agrega otra implementación y se cambia
 * únicamente el composition root (src/main.ts).
 * Todas son async a propósito, aunque la versión en memoria no lo necesite.
 */

export interface ChargePointRepository {
  get(id: string): Promise<ChargePoint | undefined>;
  list(): Promise<ChargePoint[]>;
  save(chargePoint: ChargePoint): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface TransactionFilter {
  chargePointId?: string;
  connectorId?: number;
  state?: TransactionState;
  limit?: number;
}

export interface TransactionRepository {
  get(chargePointId: string, id: string): Promise<Transaction | undefined>;
  find(filter: TransactionFilter): Promise<Transaction[]>;
  save(transaction: Transaction): Promise<void>;
  removeByChargePoint(chargePointId: string): Promise<void>;
}

export interface MeterRepository {
  append(sample: MeterSample): Promise<void>;
  history(chargePointId: string, limit: number): Promise<MeterSample[]>;
  removeByChargePoint(chargePointId: string): Promise<void>;
}

export interface ActivityRepository {
  append(entry: ActivityEntry): Promise<void>;
  list(chargePointId: string, limit: number): Promise<ActivityEntry[]>;
  removeByChargePoint(chargePointId: string): Promise<void>;
}

/** Generador de transactionId numérico (OCPP 1.6 y MQTT; en 2.x lo asigna el cargador). */
export interface SequenceGenerator {
  next(): Promise<number>;
}
