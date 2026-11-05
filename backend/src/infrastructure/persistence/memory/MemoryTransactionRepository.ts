import type { Transaction } from '@ev/shared';
import type { TransactionFilter, TransactionRepository } from '../../../core/ports/repositories.js';

const key = (chargePointId: string, id: string) => `${chargePointId}::${id}`;

export class MemoryTransactionRepository implements TransactionRepository {
  private readonly items = new Map<string, Transaction>();

  async get(chargePointId: string, id: string) {
    const tx = this.items.get(key(chargePointId, id));
    return tx ? structuredClone(tx) : undefined;
  }

  async find(filter: TransactionFilter) {
    const result = [...this.items.values()]
      .filter(
        (tx) =>
          (filter.chargePointId === undefined || tx.chargePointId === filter.chargePointId) &&
          (filter.connectorId === undefined || tx.connectorId === filter.connectorId) &&
          (filter.state === undefined || tx.state === filter.state),
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return (filter.limit ? result.slice(0, filter.limit) : result).map((tx) => structuredClone(tx));
  }

  async removeByChargePoint(chargePointId: string) {
    for (const [k, tx] of this.items) if (tx.chargePointId === chargePointId) this.items.delete(k);
  }

  async save(transaction: Transaction) {
    this.items.set(key(transaction.chargePointId, transaction.id), structuredClone(transaction));
  }
}
