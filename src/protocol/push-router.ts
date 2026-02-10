export type PushHandler = (subscriptionId: string, channel: string, data: unknown) => void;

export class PushRouter {
  constructor(private readonly onPush: PushHandler) {}

  /**
   * Handle incoming server message. Returns `true` if the message was
   * a push notification, `false` otherwise.
   */
  handleMessage(msg: Record<string, unknown>): boolean {
    if (msg['type'] !== 'push') return false;

    const subscriptionId = msg['subscriptionId'];
    const channel = msg['channel'];

    if (typeof subscriptionId !== 'string' || typeof channel !== 'string') {
      return false;
    }

    this.onPush(subscriptionId, channel, msg['data']);
    return true;
  }
}
