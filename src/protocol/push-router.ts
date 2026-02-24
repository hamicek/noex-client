export type PushHandler = (subscriptionId: string, channel: string, data: unknown) => void;
export type CustomPushHandler = (channel: string, data: unknown) => void;

export class PushRouter {
  constructor(
    private readonly onPush: PushHandler,
    private readonly onCustomPush?: CustomPushHandler,
  ) {}

  /**
   * Handle incoming server message. Returns `true` if the message was
   * a push notification, `false` otherwise.
   */
  handleMessage(msg: Record<string, unknown>): boolean {
    if (msg['type'] !== 'push') return false;

    const subscriptionId = msg['subscriptionId'];
    const channel = msg['channel'];

    if (typeof channel !== 'string') return false;

    // Custom handler push (subscriptionId is null).
    if (subscriptionId === null || subscriptionId === undefined) {
      this.onCustomPush?.(channel, msg['data']);
      return true;
    }

    if (typeof subscriptionId !== 'string') return false;

    this.onPush(subscriptionId, channel, msg['data']);
    return true;
  }
}
