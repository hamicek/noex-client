import { describe, it, expect, vi } from 'vitest';
import { SubscriptionManager } from '../../../src/subscription/subscription-manager.js';
import type { SubscriptionEntry } from '../../../src/subscription/types.js';

function createEntry(overrides: Partial<SubscriptionEntry> = {}): SubscriptionEntry {
  return {
    id: 'sub-1',
    channel: 'subscription',
    callback: vi.fn(),
    resubscribe: { type: 'store.subscribe', payload: { query: 'all-users' } },
    ...overrides,
  };
}

describe('SubscriptionManager', () => {
  // ── register / unregister ─────────────────────────────────────

  it('starts with zero count', () => {
    const manager = new SubscriptionManager();
    expect(manager.count).toBe(0);
  });

  it('increments count on register', () => {
    const manager = new SubscriptionManager();
    manager.register(createEntry({ id: 'sub-1' }));
    expect(manager.count).toBe(1);

    manager.register(createEntry({ id: 'sub-2' }));
    expect(manager.count).toBe(2);
  });

  it('decrements count on unregister', () => {
    const manager = new SubscriptionManager();
    manager.register(createEntry({ id: 'sub-1' }));
    manager.register(createEntry({ id: 'sub-2' }));

    manager.unregister('sub-1');
    expect(manager.count).toBe(1);

    manager.unregister('sub-2');
    expect(manager.count).toBe(0);
  });

  it('unregister of unknown id is a no-op', () => {
    const manager = new SubscriptionManager();
    manager.register(createEntry({ id: 'sub-1' }));
    manager.unregister('sub-nonexistent');
    expect(manager.count).toBe(1);
  });

  // ── handlePush ────────────────────────────────────────────────

  it('calls matching callback with data', () => {
    const manager = new SubscriptionManager();
    const callback = vi.fn();
    manager.register(createEntry({ id: 'sub-1', callback }));

    manager.handlePush('sub-1', [{ id: '1', name: 'Alice' }]);

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith([{ id: '1', name: 'Alice' }]);
  });

  it('ignores push for unknown subscriptionId', () => {
    const manager = new SubscriptionManager();
    const callback = vi.fn();
    manager.register(createEntry({ id: 'sub-1', callback }));

    manager.handlePush('sub-unknown', []);

    expect(callback).not.toHaveBeenCalled();
  });

  it('does not call callback after unregister', () => {
    const manager = new SubscriptionManager();
    const callback = vi.fn();
    manager.register(createEntry({ id: 'sub-1', callback }));

    manager.unregister('sub-1');
    manager.handlePush('sub-1', []);

    expect(callback).not.toHaveBeenCalled();
  });

  it('dispatches to the correct callback among multiple subscriptions', () => {
    const manager = new SubscriptionManager();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    manager.register(createEntry({ id: 'sub-1', callback: cb1 }));
    manager.register(createEntry({ id: 'sub-2', callback: cb2 }));

    manager.handlePush('sub-2', 42);

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledWith(42);
  });

  it('catches callback errors without propagating', () => {
    const manager = new SubscriptionManager();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const badCallback = vi.fn(() => {
      throw new Error('boom');
    });

    manager.register(createEntry({ id: 'sub-1', callback: badCallback }));

    // Should not throw
    expect(() => manager.handlePush('sub-1', 'data')).not.toThrow();
    expect(badCallback).toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledOnce();

    consoleError.mockRestore();
  });

  it('passes scalar data through', () => {
    const manager = new SubscriptionManager();
    const callback = vi.fn();
    manager.register(createEntry({ id: 'sub-1', callback }));

    manager.handlePush('sub-1', 5);
    expect(callback).toHaveBeenCalledWith(5);
  });

  it('passes null/undefined data through', () => {
    const manager = new SubscriptionManager();
    const callback = vi.fn();
    manager.register(createEntry({ id: 'sub-1', callback }));

    manager.handlePush('sub-1', null);
    expect(callback).toHaveBeenCalledWith(null);

    manager.handlePush('sub-1', undefined);
    expect(callback).toHaveBeenCalledWith(undefined);
  });

  // ── clear ─────────────────────────────────────────────────────

  it('removes all subscriptions on clear', () => {
    const manager = new SubscriptionManager();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    manager.register(createEntry({ id: 'sub-1', callback: cb1 }));
    manager.register(createEntry({ id: 'sub-2', callback: cb2 }));

    manager.clear();
    expect(manager.count).toBe(0);

    manager.handlePush('sub-1', []);
    manager.handlePush('sub-2', []);

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();
  });

  // ── register overwrites existing entry ─────────────────────────

  it('overwrites entry with same id', () => {
    const manager = new SubscriptionManager();
    const oldCallback = vi.fn();
    const newCallback = vi.fn();

    manager.register(createEntry({ id: 'sub-1', callback: oldCallback }));
    manager.register(createEntry({ id: 'sub-1', callback: newCallback }));

    expect(manager.count).toBe(1);

    manager.handlePush('sub-1', 'data');
    expect(oldCallback).not.toHaveBeenCalled();
    expect(newCallback).toHaveBeenCalledWith('data');
  });

  // ── resubscribeAll ──────────────────────────────────────────────

  describe('resubscribeAll', () => {
    it('re-sends subscribe requests for all entries', async () => {
      const manager = new SubscriptionManager();
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      manager.register(createEntry({
        id: 'sub-1',
        callback: cb1,
        resubscribe: { type: 'store.subscribe', payload: { query: 'all-users' } },
      }));
      manager.register(createEntry({
        id: 'sub-2',
        channel: 'event',
        callback: cb2,
        resubscribe: { type: 'rules.subscribe', payload: { pattern: 'user.*' } },
      }));

      const send = vi.fn()
        .mockResolvedValueOnce({ subscriptionId: 'new-sub-1', data: [{ name: 'Alice' }] })
        .mockResolvedValueOnce({ subscriptionId: 'new-sub-2' });

      await manager.resubscribeAll(send);

      expect(send).toHaveBeenCalledTimes(2);
      expect(send).toHaveBeenCalledWith('store.subscribe', { query: 'all-users' });
      expect(send).toHaveBeenCalledWith('rules.subscribe', { pattern: 'user.*' });
    });

    it('updates subscription IDs after resubscribe', async () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      manager.register(createEntry({
        id: 'old-sub',
        callback,
        resubscribe: { type: 'store.subscribe', payload: { query: 'q' } },
      }));

      const send = vi.fn().mockResolvedValue({ subscriptionId: 'new-sub', data: [] });

      await manager.resubscribeAll(send);

      expect(manager.count).toBe(1);

      // Old ID should not route pushes
      manager.handlePush('old-sub', 'should-not-arrive');
      expect(callback).toHaveBeenCalledTimes(1); // Only the resubscribe data call

      // New ID should work
      manager.handlePush('new-sub', 'fresh-data');
      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenLastCalledWith('fresh-data');
    });

    it('delivers initial data for store subscriptions', async () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      manager.register(createEntry({
        id: 'sub-1',
        callback,
        resubscribe: { type: 'store.subscribe', payload: { query: 'all-users' } },
      }));

      const send = vi.fn().mockResolvedValue({
        subscriptionId: 'new-sub-1',
        data: [{ id: '1', name: 'Alice' }],
      });

      await manager.resubscribeAll(send);

      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith([{ id: '1', name: 'Alice' }]);
    });

    it('does not deliver data when result has no data field', async () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      manager.register(createEntry({
        id: 'sub-1',
        channel: 'event',
        callback,
        resubscribe: { type: 'rules.subscribe', payload: { pattern: 'test.*' } },
      }));

      const send = vi.fn().mockResolvedValue({ subscriptionId: 'new-sub-1' });

      await manager.resubscribeAll(send);

      expect(callback).not.toHaveBeenCalled();
    });

    it('removes subscription on resubscribe failure', async () => {
      const manager = new SubscriptionManager();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      manager.register(createEntry({ id: 'sub-1' }));
      expect(manager.count).toBe(1);

      const send = vi.fn().mockRejectedValue(new Error('server error'));

      await manager.resubscribeAll(send);

      expect(manager.count).toBe(0);
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('continues with remaining subscriptions when one fails', async () => {
      const manager = new SubscriptionManager();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      manager.register(createEntry({ id: 'sub-1', callback: cb1 }));
      manager.register(createEntry({
        id: 'sub-2',
        callback: cb2,
        resubscribe: { type: 'store.subscribe', payload: { query: 'other' } },
      }));

      const send = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce({ subscriptionId: 'new-sub-2', data: 'ok' });

      await manager.resubscribeAll(send);

      expect(manager.count).toBe(1);
      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledWith('ok');
      consoleError.mockRestore();
    });

    it('handles empty subscription list', async () => {
      const manager = new SubscriptionManager();
      const send = vi.fn();

      await manager.resubscribeAll(send);

      expect(send).not.toHaveBeenCalled();
    });

    it('catches callback errors during data delivery', async () => {
      const manager = new SubscriptionManager();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      const badCallback = vi.fn(() => { throw new Error('callback boom'); });

      manager.register(createEntry({
        id: 'sub-1',
        callback: badCallback,
      }));

      const send = vi.fn().mockResolvedValue({ subscriptionId: 'new-sub', data: 'test' });

      await manager.resubscribeAll(send);

      // Subscription is kept despite callback error
      expect(manager.count).toBe(1);
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });
});
