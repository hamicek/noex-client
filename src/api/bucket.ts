import type { PaginatedResult, SendFn, StoreRecord } from '../types.js';

export class BucketAPI {
  constructor(
    private readonly bucketName: string,
    private readonly send: SendFn,
  ) {}

  // ── CRUD ────────────────────────────────────────────────────────

  async insert(data: Record<string, unknown>): Promise<StoreRecord> {
    return this.send('store.insert', { bucket: this.bucketName, data }) as Promise<StoreRecord>;
  }

  async get(key: unknown): Promise<StoreRecord | null> {
    return this.send('store.get', { bucket: this.bucketName, key }) as Promise<StoreRecord | null>;
  }

  async update(key: unknown, data: Record<string, unknown>): Promise<StoreRecord> {
    return this.send('store.update', { bucket: this.bucketName, key, data }) as Promise<StoreRecord>;
  }

  async delete(key: unknown): Promise<void> {
    await this.send('store.delete', { bucket: this.bucketName, key });
  }

  // ── Queries ─────────────────────────────────────────────────────

  async all(): Promise<StoreRecord[]> {
    return this.send('store.all', { bucket: this.bucketName }) as Promise<StoreRecord[]>;
  }

  async where(filter: Record<string, unknown>): Promise<StoreRecord[]> {
    return this.send('store.where', { bucket: this.bucketName, filter }) as Promise<StoreRecord[]>;
  }

  async findOne(filter: Record<string, unknown>): Promise<StoreRecord | null> {
    return this.send('store.findOne', { bucket: this.bucketName, filter }) as Promise<StoreRecord | null>;
  }

  async count(filter?: Record<string, unknown>): Promise<number> {
    const payload: Record<string, unknown> = { bucket: this.bucketName };
    if (filter !== undefined) payload['filter'] = filter;
    return this.send('store.count', payload) as Promise<number>;
  }

  async first(n: number): Promise<StoreRecord[]> {
    return this.send('store.first', { bucket: this.bucketName, n }) as Promise<StoreRecord[]>;
  }

  async last(n: number): Promise<StoreRecord[]> {
    return this.send('store.last', { bucket: this.bucketName, n }) as Promise<StoreRecord[]>;
  }

  async paginate(options: { limit: number; after?: unknown }): Promise<PaginatedResult> {
    const payload: Record<string, unknown> = { bucket: this.bucketName, limit: options.limit };
    if (options.after !== undefined) payload['after'] = options.after;
    return this.send('store.paginate', payload) as Promise<PaginatedResult>;
  }

  // ── Aggregation ─────────────────────────────────────────────────

  async sum(field: string, filter?: Record<string, unknown>): Promise<number> {
    const payload: Record<string, unknown> = { bucket: this.bucketName, field };
    if (filter !== undefined) payload['filter'] = filter;
    return this.send('store.sum', payload) as Promise<number>;
  }

  async avg(field: string, filter?: Record<string, unknown>): Promise<number> {
    const payload: Record<string, unknown> = { bucket: this.bucketName, field };
    if (filter !== undefined) payload['filter'] = filter;
    return this.send('store.avg', payload) as Promise<number>;
  }

  async min(field: string, filter?: Record<string, unknown>): Promise<number | null> {
    const payload: Record<string, unknown> = { bucket: this.bucketName, field };
    if (filter !== undefined) payload['filter'] = filter;
    return this.send('store.min', payload) as Promise<number | null>;
  }

  async max(field: string, filter?: Record<string, unknown>): Promise<number | null> {
    const payload: Record<string, unknown> = { bucket: this.bucketName, field };
    if (filter !== undefined) payload['filter'] = filter;
    return this.send('store.max', payload) as Promise<number | null>;
  }

  // ── Bulk ────────────────────────────────────────────────────────

  async clear(): Promise<void> {
    await this.send('store.clear', { bucket: this.bucketName });
  }
}
