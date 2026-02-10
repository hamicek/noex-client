import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSocketTransport } from '../../../src/transport/transport.js';
import type { WebSocketLike, WebSocketConstructor } from '../../../src/types.js';

// ── Mock WebSocket ───────────────────────────────────────────────

class MockWebSocket implements WebSocketLike {
  static instances: MockWebSocket[] = [];

  readyState = 0; // CONNECTING
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  readonly url: string;
  sent: string[] = [];
  private closed = false;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    if (this.onclose) {
      this.onclose({ code: code ?? 1000, reason: reason ?? '' });
    }
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  simulateMessage(data: string): void {
    this.onmessage?.({ data });
  }

  simulateClose(code = 1000, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  simulateError(): void {
    this.onerror?.({});
  }
}

function createMockWSConstructor(): WebSocketConstructor {
  return MockWebSocket as unknown as WebSocketConstructor;
}

function lastMockWS(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
}

// ── Tests ────────────────────────────────────────────────────────

describe('WebSocketTransport', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
  });

  const defaultOpts = {
    connectTimeoutMs: 5_000,
    WebSocket: createMockWSConstructor(),
    heartbeat: true,
  };

  describe('connect', () => {
    it('should transition to connected on successful open', async () => {
      const transport = new WebSocketTransport('ws://localhost:8080', defaultOpts);

      expect(transport.state).toBe('idle');
      expect(transport.isConnected).toBe(false);

      const connectPromise = transport.connect();

      // WS constructor was called
      const ws = lastMockWS();
      expect(ws.url).toBe('ws://localhost:8080');

      expect(transport.state).toBe('connecting');

      ws.simulateOpen();
      await connectPromise;

      expect(transport.state).toBe('connected');
      expect(transport.isConnected).toBe(true);
    });

    it('should emit open event on connect', async () => {
      const transport = new WebSocketTransport('ws://localhost:8080', defaultOpts);
      const onOpen = vi.fn();
      transport.on('open', onOpen);

      const p = transport.connect();
      lastMockWS().simulateOpen();
      await p;

      expect(onOpen).toHaveBeenCalledOnce();
    });

    it('should reject on close during connect', async () => {
      const transport = new WebSocketTransport('ws://localhost:8080', defaultOpts);

      const p = transport.connect();
      lastMockWS().simulateClose(1006, 'Connection refused');

      await expect(p).rejects.toThrow('WebSocket closed during connect');
      expect(transport.state).toBe('disconnected');
    });

    it('should reject on connect timeout', async () => {
      const transport = new WebSocketTransport('ws://localhost:8080', {
        ...defaultOpts,
        connectTimeoutMs: 50,
      });

      await expect(transport.connect()).rejects.toThrow('Connect timeout');
      expect(transport.state).toBe('disconnected');
    });
  });

  describe('connect — idempotency', () => {
    it('should be a no-op when already connected', async () => {
      const transport = new WebSocketTransport('ws://localhost:8080', defaultOpts);

      const p = transport.connect();
      lastMockWS().simulateOpen();
      await p;

      expect(transport.state).toBe('connected');
      expect(MockWebSocket.instances).toHaveLength(1);

      // Second connect should not create another WebSocket
      await transport.connect();
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(transport.state).toBe('connected');
    });

    it('should be a no-op when connecting is in progress', async () => {
      const transport = new WebSocketTransport('ws://localhost:8080', defaultOpts);

      const p1 = transport.connect();
      expect(transport.state).toBe('connecting');

      // Second connect while first is pending
      const p2 = transport.connect();

      // Should not create a second WebSocket
      expect(MockWebSocket.instances).toHaveLength(1);

      lastMockWS().simulateOpen();
      await p1;
      await p2;

      expect(transport.state).toBe('connected');
    });
  });

  describe('disconnect', () => {
    it('should close the socket and transition to disconnected', async () => {
      const transport = new WebSocketTransport('ws://localhost:8080', defaultOpts);

      const p = transport.connect();
      lastMockWS().simulateOpen();
      await p;

      await transport.disconnect();

      expect(transport.state).toBe('disconnected');
      expect(transport.isConnected).toBe(false);
    });

    it('should be a no-op when already disconnected', async () => {
      const transport = new WebSocketTransport('ws://localhost:8080', defaultOpts);
      await transport.disconnect(); // Should not throw
      expect(transport.state).toBe('idle');
    });
  });

  describe('send', () => {
    it('should send data through the WebSocket', async () => {
      const transport = new WebSocketTransport('ws://localhost:8080', defaultOpts);
      const p = transport.connect();
      lastMockWS().simulateOpen();
      await p;

      transport.send('{"type":"test"}');
      expect(lastMockWS().sent).toEqual(['{"type":"test"}']);
    });

    it('should throw when not connected', () => {
      const transport = new WebSocketTransport('ws://localhost:8080', defaultOpts);
      expect(() => transport.send('test')).toThrow('not connected');
    });
  });

  describe('message events', () => {
    it('should emit message events for incoming data', async () => {
      const transport = new WebSocketTransport('ws://localhost:8080', defaultOpts);
      const onMessage = vi.fn();
      transport.on('message', onMessage);

      const p = transport.connect();
      lastMockWS().simulateOpen();
      await p;

      lastMockWS().simulateMessage('{"type":"result","id":1,"data":null}');

      expect(onMessage).toHaveBeenCalledWith('{"type":"result","id":1,"data":null}');
    });
  });

  describe('heartbeat (ping/pong)', () => {
    it('should auto-reply pong to ping messages', async () => {
      const transport = new WebSocketTransport('ws://localhost:8080', defaultOpts);
      const onMessage = vi.fn();
      transport.on('message', onMessage);

      const p = transport.connect();
      lastMockWS().simulateOpen();
      await p;

      lastMockWS().simulateMessage('{"type":"ping","timestamp":12345}');

      // Pong should have been sent
      expect(lastMockWS().sent).toHaveLength(1);
      const pong = JSON.parse(lastMockWS().sent[0]!);
      expect(pong).toEqual({ type: 'pong', timestamp: 12345 });

      // Ping should NOT be emitted as a regular message
      expect(onMessage).not.toHaveBeenCalled();
    });

    it('should not auto-reply when heartbeat is disabled', async () => {
      const transport = new WebSocketTransport('ws://localhost:8080', {
        ...defaultOpts,
        heartbeat: false,
      });
      const onMessage = vi.fn();
      transport.on('message', onMessage);

      const p = transport.connect();
      lastMockWS().simulateOpen();
      await p;

      lastMockWS().simulateMessage('{"type":"ping","timestamp":12345}');

      // No pong sent
      expect(lastMockWS().sent).toHaveLength(0);

      // Message IS emitted
      expect(onMessage).toHaveBeenCalledOnce();
    });
  });

  describe('heartbeat edge cases', () => {
    it('should not crash on non-JSON ping-like data', async () => {
      const transport = new WebSocketTransport('ws://localhost:8080', defaultOpts);
      const onMessage = vi.fn();
      transport.on('message', onMessage);

      const p = transport.connect();
      lastMockWS().simulateOpen();
      await p;

      // Non-JSON data should pass through as regular message
      lastMockWS().simulateMessage('not json at all');
      expect(onMessage).toHaveBeenCalledWith('not json at all');
      expect(lastMockWS().sent).toHaveLength(0);
    });

    it('should not auto-reply to ping without timestamp', async () => {
      const transport = new WebSocketTransport('ws://localhost:8080', defaultOpts);
      const onMessage = vi.fn();
      transport.on('message', onMessage);

      const p = transport.connect();
      lastMockWS().simulateOpen();
      await p;

      // Ping with non-number timestamp — should NOT auto-reply, just pass through
      lastMockWS().simulateMessage('{"type":"ping","timestamp":"not-a-number"}');
      expect(lastMockWS().sent).toHaveLength(0);
      expect(onMessage).toHaveBeenCalledOnce();
    });
  });

  describe('close event', () => {
    it('should emit close and transition to disconnected on server close', async () => {
      const transport = new WebSocketTransport('ws://localhost:8080', defaultOpts);
      const onClose = vi.fn();
      transport.on('close', onClose);

      const p = transport.connect();
      lastMockWS().simulateOpen();
      await p;

      expect(transport.state).toBe('connected');

      lastMockWS().simulateClose(1001, 'Going away');

      expect(transport.state).toBe('disconnected');
      expect(onClose).toHaveBeenCalledWith(1001, 'Going away');
    });
  });

  describe('error event', () => {
    it('should emit error events', async () => {
      const transport = new WebSocketTransport('ws://localhost:8080', defaultOpts);
      const onError = vi.fn();
      transport.on('error', onError);

      const p = transport.connect();
      lastMockWS().simulateOpen();
      await p;

      lastMockWS().simulateError();

      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
    });
  });

  describe('event unsubscribe', () => {
    it('should remove listener when unsubscribe is called', async () => {
      const transport = new WebSocketTransport('ws://localhost:8080', defaultOpts);
      const handler = vi.fn();
      const unsub = transport.on('message', handler);

      const p = transport.connect();
      lastMockWS().simulateOpen();
      await p;

      unsub();
      lastMockWS().simulateMessage('{"type":"test"}');

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
