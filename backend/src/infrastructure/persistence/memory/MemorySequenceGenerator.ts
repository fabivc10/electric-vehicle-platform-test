import type { SequenceGenerator } from '../../../core/ports/repositories.js';

export class MemorySequenceGenerator implements SequenceGenerator {
  private current: number;

  constructor(start: number) {
    this.current = start - 1;
  }

  async next() {
    this.current += 1;
    return this.current;
  }
}
