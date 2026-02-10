import { describe, it, expect, vi } from 'vitest';
import { PushRouter } from '../../../src/protocol/push-router.js';

describe('PushRouter', () => {
  it('calls onPush for push messages and returns true', () => {
    const onPush = vi.fn();
    const router = new PushRouter(onPush);

    const handled = router.handleMessage({
      type: 'push',
      channel: 'subscription',
      subscriptionId: 'sub-1',
      data: [{ id: '1', name: 'Alice' }],
    });

    expect(handled).toBe(true);
    expect(onPush).toHaveBeenCalledOnce();
    expect(onPush).toHaveBeenCalledWith('sub-1', 'subscription', [{ id: '1', name: 'Alice' }]);
  });

  it('returns false for non-push message types', () => {
    const onPush = vi.fn();
    const router = new PushRouter(onPush);

    expect(router.handleMessage({ type: 'result', id: 1, data: {} })).toBe(false);
    expect(router.handleMessage({ type: 'error', id: 1, code: 'ERR' })).toBe(false);
    expect(router.handleMessage({ type: 'welcome', version: '1.0.0' })).toBe(false);
    expect(router.handleMessage({ type: 'ping', timestamp: 123 })).toBe(false);
    expect(router.handleMessage({ type: 'system', event: 'shutdown' })).toBe(false);

    expect(onPush).not.toHaveBeenCalled();
  });

  it('returns false when subscriptionId is missing', () => {
    const onPush = vi.fn();
    const router = new PushRouter(onPush);

    const handled = router.handleMessage({
      type: 'push',
      channel: 'subscription',
      data: [],
    });

    expect(handled).toBe(false);
    expect(onPush).not.toHaveBeenCalled();
  });

  it('returns false when channel is missing', () => {
    const onPush = vi.fn();
    const router = new PushRouter(onPush);

    const handled = router.handleMessage({
      type: 'push',
      subscriptionId: 'sub-1',
      data: [],
    });

    expect(handled).toBe(false);
    expect(onPush).not.toHaveBeenCalled();
  });

  it('passes event channel correctly', () => {
    const onPush = vi.fn();
    const router = new PushRouter(onPush);

    router.handleMessage({
      type: 'push',
      channel: 'event',
      subscriptionId: 'evt-1',
      data: { topic: 'user.created', event: {} },
    });

    expect(onPush).toHaveBeenCalledWith('evt-1', 'event', { topic: 'user.created', event: {} });
  });

  it('passes undefined data through', () => {
    const onPush = vi.fn();
    const router = new PushRouter(onPush);

    router.handleMessage({
      type: 'push',
      channel: 'subscription',
      subscriptionId: 'sub-1',
    });

    expect(onPush).toHaveBeenCalledWith('sub-1', 'subscription', undefined);
  });
});
