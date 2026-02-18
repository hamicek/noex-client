import type { SubscriptionManager } from '../subscription/subscription-manager.js';
import type {
  BucketDefinition,
  BucketSchemaUpdate,
  BucketsInfo,
  DeclarativeQueryConfig,
  QueryInfo,
  SendFn,
  StoreStats,
  TransactionOp,
  TransactionResult,
  Unsubscribe,
} from '../types.js';
import { BucketAPI } from './bucket.js';

export class StoreAPI {
  constructor(
    private readonly send: SendFn,
    private readonly subscriptions: SubscriptionManager,
  ) {}

  bucket<T extends Record<string, unknown> = Record<string, unknown>>(name: string): BucketAPI<T> {
    return new BucketAPI<T>(name, this.send);
  }

  // ── Subscriptions ─────────────────────────────────────────────

  async subscribe(query: string, callback: (data: unknown) => void): Promise<Unsubscribe>;
  async subscribe(
    query: string,
    params: Record<string, unknown>,
    callback: (data: unknown) => void,
  ): Promise<Unsubscribe>;
  async subscribe(query: string, ...args: unknown[]): Promise<Unsubscribe> {
    let params: Record<string, unknown> | undefined;
    let callback: (data: unknown) => void;

    if (args.length === 1) {
      callback = args[0] as (data: unknown) => void;
    } else {
      params = args[0] as Record<string, unknown>;
      callback = args[1] as (data: unknown) => void;
    }

    const payload: Record<string, unknown> = { query };
    if (params !== undefined) payload['params'] = params;

    const result = await this.send('store.subscribe', payload) as {
      subscriptionId: string;
      data: unknown;
    };

    this.subscriptions.register({
      id: result.subscriptionId,
      channel: 'subscription',
      callback,
      resubscribe: { type: 'store.subscribe', payload },
    });

    // Deliver initial data synchronously after registration.
    // If the callback throws, clean up the subscription to avoid a leak.
    try {
      callback(result.data);
    } catch (err) {
      this.subscriptions.unregister(result.subscriptionId);
      this.send('store.unsubscribe', { subscriptionId: result.subscriptionId }).catch(() => {});
      throw err;
    }

    return () => {
      this.subscriptions.unregister(result.subscriptionId);
      // Fire-and-forget — don't block on server confirmation
      this.send('store.unsubscribe', { subscriptionId: result.subscriptionId }).catch(() => {});
    };
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    this.subscriptions.unregister(subscriptionId);
    await this.send('store.unsubscribe', { subscriptionId });
  }

  // ── Transactions ───────────────────────────────────────────────

  async transaction(operations: TransactionOp[]): Promise<TransactionResult> {
    return this.send('store.transaction', { operations } as Record<string, unknown>) as Promise<TransactionResult>;
  }

  // ── Admin ──────────────────────────────────────────────────────

  async defineBucket(
    name: string,
    config: BucketDefinition,
  ): Promise<{ name: string; created: boolean }> {
    return this.send('store.defineBucket', {
      name,
      config: config as unknown as Record<string, unknown>,
    }) as Promise<{ name: string; created: boolean }>;
  }

  async dropBucket(name: string): Promise<{ name: string; dropped: boolean }> {
    return this.send('store.dropBucket', { name }) as Promise<{ name: string; dropped: boolean }>;
  }

  async updateBucket(
    name: string,
    updates: BucketSchemaUpdate,
  ): Promise<{ name: string; updated: boolean }> {
    return this.send('store.updateBucket', {
      name,
      updates: updates as unknown as Record<string, unknown>,
    }) as Promise<{ name: string; updated: boolean }>;
  }

  async getBucketSchema(
    name: string,
  ): Promise<{ name: string; config: BucketDefinition }> {
    return this.send('store.getBucketSchema', { name }) as Promise<{
      name: string;
      config: BucketDefinition;
    }>;
  }

  // ── Query Admin ────────────────────────────────────────────────────

  async defineQuery(
    name: string,
    config: DeclarativeQueryConfig,
  ): Promise<{ name: string; defined: boolean }> {
    return this.send('store.defineQuery', {
      name,
      config: config as unknown as Record<string, unknown>,
    }) as Promise<{ name: string; defined: boolean }>;
  }

  async undefineQuery(
    name: string,
  ): Promise<{ name: string; undefined: boolean }> {
    return this.send('store.undefineQuery', { name }) as Promise<{
      name: string;
      undefined: boolean;
    }>;
  }

  async listQueries(): Promise<{ queries: QueryInfo[] }> {
    return this.send('store.listQueries', {}) as Promise<{ queries: QueryInfo[] }>;
  }

  // ── Metadata ─────────────────────────────────────────────────────

  async buckets(): Promise<BucketsInfo> {
    return this.send('store.buckets', {}) as Promise<BucketsInfo>;
  }

  async stats(): Promise<StoreStats> {
    return this.send('store.stats', {}) as Promise<StoreStats>;
  }
}
