import type { SubscriptionManager } from '../subscription/subscription-manager.js';
import type { SendFn, TransactionOp, TransactionResult, Unsubscribe } from '../types.js';
import { BucketAPI } from './bucket.js';

export class StoreAPI {
  constructor(
    private readonly send: SendFn,
    private readonly subscriptions: SubscriptionManager,
  ) {}

  bucket(name: string): BucketAPI {
    return new BucketAPI(name, this.send);
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

    // Deliver initial data synchronously after registration
    callback(result.data);

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
}
