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

  clear(): void {
    this.subscriptions.clear();
  }
}
