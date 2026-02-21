export interface SubscriptionEntry {
  id: string;
  channel: 'subscription' | 'event' | 'logic';
  callback: (data: unknown) => void;
  resubscribe: {
    type: string;
    payload: Record<string, unknown>;
  };
}
