import type { ChargePoint } from '@ev/shared';
import type { ChargePointRepository } from '../../../core/ports/repositories.js';

export class MemoryChargePointRepository implements ChargePointRepository {
  private readonly items = new Map<string, ChargePoint>();

  async get(id: string) {
    const cp = this.items.get(id);
    return cp ? structuredClone(cp) : undefined;
  }

  async list() {
    return [...this.items.values()].map((cp) => structuredClone(cp));
  }

  async remove(id: string) {
    this.items.delete(id);
  }

  async save(chargePoint: ChargePoint) {
    this.items.set(chargePoint.id, structuredClone(chargePoint));
  }
}
