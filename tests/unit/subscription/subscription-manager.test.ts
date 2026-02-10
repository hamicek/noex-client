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
});
