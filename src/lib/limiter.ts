import { tooMany } from './errors.ts';

interface Bucket {
  count: number;
  reset: number;
}

export class Limiter {
  private buckets = new Map<string, Bucket>();
  private max: number;
  private windowMs: number;

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  private bucket(key: string) {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.reset <= now) {
      bucket = { count: 0, reset: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    if (this.buckets.size > 50_000) {
      for (const [entry, value] of this.buckets) if (value.reset <= now) this.buckets.delete(entry);
    }
    return bucket;
  }

  check(key: string) {
    if (this.bucket(key).count >= this.max) throw tooMany();
  }

  blocked(key: string) {
    return this.bucket(key).count >= this.max;
  }

  hit(key: string) {
    this.bucket(key).count++;
  }

  reset(key: string) {
    this.buckets.delete(key);
  }
}
