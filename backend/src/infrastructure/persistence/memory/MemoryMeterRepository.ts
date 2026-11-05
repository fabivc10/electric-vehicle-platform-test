import type { MeterSample } from '@ev/shared';
import type { MeterRepository } from '../../../core/ports/repositories.js';
import { KeyedRingBuffer } from './RingBuffer.js';

export class MemoryMeterRepository implements MeterRepository {
  private readonly buffer: KeyedRingBuffer<MeterSample>;

  constructor(capacityPerChargePoint: number) {
    this.buffer = new KeyedRingBuffer(capacityPerChargePoint);
  }

  async append(sample: MeterSample) {
    this.buffer.push(sample.chargePointId, { ...sample });
  }

  async removeByChargePoint(chargePointId: string) {
    this.buffer.delete(chargePointId);
  }

  async history(chargePointId: string, limit: number) {
    return this.buffer.last(chargePointId, limit);
  }
}
