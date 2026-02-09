import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RequestManager } from '../../../src/protocol/request-manager.js';
import { NoexClientError, TimeoutError } from '../../../src/errors.js';

// ── Mock transport ───────────────────────────────────────────────

function createMockTransport() {
  const sent: string[] = [];
  return {
    send(data: string): void {
      sent.push(data);
    },
    sent,
    get lastSent(): Record<string, unknown> | undefined {
      const last = sent[sent.length - 1];
      return last ? (JSON.parse(last) as Record<string, unknown>) : undefined;
    },
  };
}

type MockTransport = ReturnType<typeof createMockTransport>;

// ── Tests ────────────────────────────────────────────────────────

describe('RequestManager', () => {
  let manager: RequestManager;
  let transport: MockTransport;

  beforeEach(() => {
    manager = new RequestManager({ timeoutMs: 5_000 });
    transport = createMockTransport();
  });

  describe('send', () => {
    it('should send a request with auto-incremented id', () => {
      manager.send(transport as never, 'store.get', { bucket: 'users', key: '1' });
      manager.send(transport as never, 'store.all', { bucket: 'products' });

      expect(transport.sent).toHaveLength(2);

      const msg1 = JSON.parse(transport.sent[0]!) as Record<string, unknown>;
      const msg2 = JSON.parse(transport.sent[1]!) as Record<string, unknown>;

      expect(msg1['id']).toBe(1);
      expect(msg1['type']).toBe('store.get');
      expect(msg1['bucket']).toBe('users');
      expect(msg1['key']).toBe('1');

      expect(msg2['id']).toBe(2);
      expect(msg2['type']).toBe('store.all');
    });

    it('should track pending requests', () => {
      expect(manager.pendingCount).toBe(0);

      manager.send(transport as never, 'store.get', { bucket: 'x', key: '1' });
      manager.send(transport as never, 'store.get', { bucket: 'x', key: '2' });

      expect(manager.pendingCount).toBe(2);
    });
  });

  describe('handleMessage — success', () => {
    it('should resolve promise on result message', async () => {
      const promise = manager.send(transport as never, 'store.get', { bucket: 'users', key: '1' });

      const handled = manager.handleMessage({
        id: 1,
        type: 'result',
        data: { id: '1', name: 'Alice' },
      });

      expect(handled).toBe(true);
      expect(manager.pendingCount).toBe(0);

      const result = await promise;
      expect(result).toEqual({ id: '1', name: 'Alice' });
    });

    it('should resolve with null data', async () => {
      const promise = manager.send(transport as never, 'store.get', { bucket: 'users', key: '999' });

      manager.handleMessage({ id: 1, type: 'result', data: null });

      const result = await promise;
      expect(result).toBeNull();
    });
  });

  describe('handleMessage — error', () => {
    it('should reject promise on error message', async () => {
      const promise = manager.send(transport as never, 'store.get', { bucket: 'users', key: '1' });

      manager.handleMessage({
        id: 1,
        type: 'error',
        code: 'NOT_FOUND',
        message: 'Record not found',
      });

      await expect(promise).rejects.toThrow(NoexClientError);
      await expect(promise).rejects.toThrow('Record not found');

      try {
        await promise;
      } catch (err) {
        expect((err as NoexClientError).code).toBe('NOT_FOUND');
      }
    });

    it('should include details in error', async () => {
      const promise = manager.send(transport as never, 'store.insert', { bucket: 'users', data: {} });

      manager.handleMessage({
        id: 1,
        type: 'error',
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'name', message: 'required' }],
      });

      try {
        await promise;
      } catch (err) {
        expect((err as NoexClientError).details).toEqual([
          { field: 'name', message: 'required' },
        ]);
      }
    });
  });

  describe('handleMessage — non-response messages', () => {
    it('should return false for push messages', () => {
      expect(manager.handleMessage({ type: 'push', channel: 'subscription', subscriptionId: 'sub-1', data: [] }))
        .toBe(false);
    });

    it('should return false for welcome messages', () => {
      expect(manager.handleMessage({ type: 'welcome', version: '1.0.0', serverTime: 0, requiresAuth: false }))
        .toBe(false);
    });

    it('should return false for ping messages', () => {
      expect(manager.handleMessage({ type: 'ping', timestamp: 12345 })).toBe(false);
    });

    it('should return false for system messages', () => {
      expect(manager.handleMessage({ type: 'system', event: 'shutdown' })).toBe(false);
    });

    it('should return false for unknown id', () => {
      expect(manager.handleMessage({ id: 999, type: 'result', data: null })).toBe(false);
    });
  });

  describe('concurrent requests', () => {
    it('should correlate responses to correct requests', async () => {
      const p1 = manager.send(transport as never, 'store.get', { bucket: 'a', key: '1' });
      const p2 = manager.send(transport as never, 'store.get', { bucket: 'b', key: '2' });
      const p3 = manager.send(transport as never, 'store.get', { bucket: 'c', key: '3' });

      // Respond out of order
      manager.handleMessage({ id: 3, type: 'result', data: 'third' });
      manager.handleMessage({ id: 1, type: 'result', data: 'first' });
      manager.handleMessage({ id: 2, type: 'result', data: 'second' });

      expect(await p1).toBe('first');
      expect(await p2).toBe('second');
      expect(await p3).toBe('third');
    });
  });

  describe('timeout', () => {
    it('should reject after timeout', async () => {
      const fast = new RequestManager({ timeoutMs: 50 });
      const promise = fast.send(transport as never, 'store.get', { bucket: 'x', key: '1' });

      await expect(promise).rejects.toThrow(TimeoutError);
      await expect(promise).rejects.toThrow('timed out');
      expect(fast.pendingCount).toBe(0);
    });
  });

  describe('rejectAll', () => {
    it('should reject all pending requests', async () => {
      const p1 = manager.send(transport as never, 'store.get', { bucket: 'a', key: '1' });
      const p2 = manager.send(transport as never, 'store.get', { bucket: 'b', key: '2' });

      expect(manager.pendingCount).toBe(2);

      manager.rejectAll(new Error('Connection lost'));

      expect(manager.pendingCount).toBe(0);

      await expect(p1).rejects.toThrow('Connection lost');
      await expect(p2).rejects.toThrow('Connection lost');
    });
  });
});
