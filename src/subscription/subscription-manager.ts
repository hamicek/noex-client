import type { SendFn } from '../types.js';
import type { SubscriptionEntry } from './types.js';

export class SubscriptionManager {
  private readonly subscriptions = new Map<string, SubscriptionEntry>();

  get count(): number {
    return this.subscriptions.size;
  }

  register(entry: SubscriptionEntry): void {
    this.subscriptions.set(entry.id, entry);
  }

  unregister(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);
  }

  handlePush(subscriptionId: string, data: unknown): void {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return;

    try {
      sub.callback(data);
    } catch (err) {
      console.error(`Subscription ${subscriptionId} callback error:`, err);
    }
  }

  async resubscribeAll(send: SendFn): Promise<void> {
    const entries = [...this.subscriptions.values()];

    for (const entry of entries) {
      try {
        const result = await send(entry.resubscribe.type, entry.resubscribe.payload) as {
          subscriptionId: string;
          data?: unknown;
        };

        // Server assigns a new subscriptionId — update the mapping
        this.subscriptions.delete(entry.id);
        entry.id = result.subscriptionId;
        this.subscriptions.set(entry.id, entry);

        // Deliver current data for store subscriptions (rules subscriptions have no initial data)
        if (result.data !== undefined) {
          try {
            entry.callback(result.data);
          } catch (err) {
            console.error(`Subscription ${entry.id} callback error during resubscribe:`, err);
          }
        }
      } catch (err) {
        console.error(`Failed to resubscribe ${entry.id}:`, err);
        this.subscriptions.delete(entry.id);
      }
    }
  }

  clear(): void {
    this.subscriptions.clear();
  }
}
