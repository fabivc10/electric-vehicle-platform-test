import type { ActivityEntry } from '@ev/shared';
import type { ActivityRepository } from '../../../core/ports/repositories.js';
import { KeyedRingBuffer } from './RingBuffer.js';

export class MemoryActivityRepository implements ActivityRepository {
  private readonly buffer: KeyedRingBuffer<ActivityEntry>;

  constructor(capacityPerChargePoint: number) {
    this.buffer = new KeyedRingBuffer(capacityPerChargePoint);
  }

  async append(entry: ActivityEntry) {
    this.buffer.push(entry.chargePointId, { ...entry });
  }

  async removeByChargePoint(chargePointId: string) {
    this.buffer.delete(chargePointId);
  }

  /** Más recientes primero (como se muestran en el panel). */
  async list(chargePointId: string, limit: number) {
    return this.buffer.last(chargePointId, limit).reverse();
  }
}
