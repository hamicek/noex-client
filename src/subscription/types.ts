export interface SubscriptionEntry {
  id: string;
  channel: 'subscription' | 'event';
  callback: (data: unknown) => void;
  resubscribe: {
    type: string;
    payload: Record<string, unknown>;
  };
}
