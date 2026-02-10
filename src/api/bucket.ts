import type { PaginatedResult, RecordMeta, SendFn } from '../types.js';

export class BucketAPI<T extends Record<string, unknown> = Record<string, unknown>> {
  constructor(
    private readonly bucketName: string,
    private readonly send: SendFn,
  ) {}

  // ── CRUD ────────────────────────────────────────────────────────

  async insert(data: Omit<T, keyof RecordMeta>): Promise<T & RecordMeta> {
    return this.send('store.insert', {
      bucket: this.bucketName,
      data: data as Record<string, unknown>,
    }) as Promise<T & RecordMeta>;
  }

  async get(key: unknown): Promise<(T & RecordMeta) | null> {
    return this.send('store.get', {
      bucket: this.bucketName,
      key,
    }) as Promise<(T & RecordMeta) | null>;
  }

  async update(key: unknown, data: Partial<Omit<T, keyof RecordMeta>>): Promise<T & RecordMeta> {
    return this.send('store.update', {
      bucket: this.bucketName,
      key,
      data: data as Record<string, unknown>,
    }) as Promise<T & RecordMeta>;
  }

  async delete(key: unknown): Promise<void> {
    await this.send('store.delete', { bucket: this.bucketName, key });
  }

  // ── Queries ─────────────────────────────────────────────────────

  async all(): Promise<(T & RecordMeta)[]> {
    return this.send('store.all', { bucket: this.bucketName }) as Promise<(T & RecordMeta)[]>;
  }

  async where(filter: Partial<T>): Promise<(T & RecordMeta)[]> {
    return this.send('store.where', {
      bucket: this.bucketName,
      filter: filter as Record<string, unknown>,
    }) as Promise<(T & RecordMeta)[]>;
  }

  async findOne(filter: Partial<T>): Promise<(T & RecordMeta) | null> {
    return this.send('store.findOne', {
      bucket: this.bucketName,
      filter: filter as Record<string, unknown>,
    }) as Promise<(T & RecordMeta) | null>;
  }

  async count(filter?: Partial<T>): Promise<number> {
    const payload: Record<string, unknown> = { bucket: this.bucketName };
    if (filter !== undefined) payload['filter'] = filter;
    return this.send('store.count', payload) as Promise<number>;
  }

  async first(n: number): Promise<(T & RecordMeta)[]> {
    return this.send('store.first', { bucket: this.bucketName, n }) as Promise<(T & RecordMeta)[]>;
  }

  async last(n: number): Promise<(T & RecordMeta)[]> {
    return this.send('store.last', { bucket: this.bucketName, n }) as Promise<(T & RecordMeta)[]>;
  }

  async paginate(options: { limit: number; after?: unknown }): Promise<PaginatedResult<T>> {
    const payload: Record<string, unknown> = { bucket: this.bucketName, limit: options.limit };
    if (options.after !== undefined) payload['after'] = options.after;
    return this.send('store.paginate', payload) as Promise<PaginatedResult<T>>;
  }

  // ── Aggregation ─────────────────────────────────────────────────

  async sum(field: string, filter?: Partial<T>): Promise<number> {
    const payload: Record<string, unknown> = { bucket: this.bucketName, field };
    if (filter !== undefined) payload['filter'] = filter;
    return this.send('store.sum', payload) as Promise<number>;
  }

  async avg(field: string, filter?: Partial<T>): Promise<number> {
    const payload: Record<string, unknown> = { bucket: this.bucketName, field };
    if (filter !== undefined) payload['filter'] = filter;
    return this.send('store.avg', payload) as Promise<number>;
  }

  async min(field: string, filter?: Partial<T>): Promise<number | null> {
    const payload: Record<string, unknown> = { bucket: this.bucketName, field };
    if (filter !== undefined) payload['filter'] = filter;
    return this.send('store.min', payload) as Promise<number | null>;
  }

  async max(field: string, filter?: Partial<T>): Promise<number | null> {
    const payload: Record<string, unknown> = { bucket: this.bucketName, field };
    if (filter !== undefined) payload['filter'] = filter;
    return this.send('store.max', payload) as Promise<number | null>;
  }

  // ── Bulk ────────────────────────────────────────────────────────

  async clear(): Promise<void> {
    await this.send('store.clear', { bucket: this.bucketName });
  }
}
