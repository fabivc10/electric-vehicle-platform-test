/** Buffer circular por clave: guarda los últimos N elementos de cada cargador. */
export class KeyedRingBuffer<T> {
  private readonly buckets = new Map<string, T[]>();

  constructor(private readonly capacity: number) {}

  push(key: string, item: T): void {
    const bucket = this.buckets.get(key) ?? [];
    bucket.push(item);
    if (bucket.length > this.capacity) bucket.splice(0, bucket.length - this.capacity);
    this.buckets.set(key, bucket);
  }

  delete(key: string): void {
    this.buckets.delete(key);
  }

  /** Últimos `limit` elementos en orden cronológico. */
  last(key: string, limit: number): T[] {
    const bucket = this.buckets.get(key) ?? [];
    return bucket.slice(Math.max(0, bucket.length - limit));
  }
}
