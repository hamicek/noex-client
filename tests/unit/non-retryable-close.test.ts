import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import { NoexClient } from '../../src/index.js';

// ── Helpers ──────────────────────────────────────────────────────

interface CloseServer {
  port: number;
  wss: WebSocketServer;
  close: () => Promise<void>;
}

/**
 * Create a minimal WebSocket server that sends a welcome message,
 * then closes the connection with the given code + reason.
 */
function createCloseServer(closeCode: number, closeReason: string): Promise<CloseServer> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });

    wss.on('listening', () => {
      const addr = wss.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;

      resolve({
        port,
        wss,
        close: () => new Promise<void>((r) => wss.close(r)),
      });
    });

    wss.on('connection', (ws) => {
      // Send welcome so the client's connect() resolves
      ws.send(JSON.stringify({
        type: 'welcome',
        version: '1.0.0',
        serverTime: Date.now(),
        requiresAuth: false,
      }));

      // Close with the specified code after a short delay (let connect() complete)
      setTimeout(() => {
        ws.close(closeCode, closeReason);
      }, 50);
    });
  });
}

function waitForEvent<T = void>(
  client: NoexClient,
  event: 'connected' | 'disconnected' | 'reconnecting' | 'reconnected',
  timeoutMs = 3000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`waitForEvent('${event}') timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsub = (client as any).on(event, (...args: unknown[]) => {
      clearTimeout(timer);
      unsub();
      resolve(args[0] as T);
    });
  });
}

// ── Tests ────────────────────────────────────────────────────────

const FAST_RECONNECT = {
  initialDelayMs: 50,
  maxDelayMs: 100,
  jitterMs: 0,
  maxRetries: 5,
} as const;

const NON_RETRYABLE_CASES = [
  { code: 1003, reason: 'binary_not_supported', label: '1003 (Unsupported Data)' },
  { code: 4002, reason: 'session_revoked', label: '4002 (session_revoked)' },
  { code: 4003, reason: 'too_many_connections', label: '4003 (too_many_connections)' },
] as const;

describe('Non-retryable close codes', () => {
  let server: CloseServer | undefined;
  let client: NoexClient | undefined;

  afterEach(async () => {
    if (client) {
      try { await client.disconnect(); } catch { /* already disconnected */ }
      client = undefined;
    }
    if (server) {
      await server.close();
      server = undefined;
    }
  });

  for (const { code, reason, label } of NON_RETRYABLE_CASES) {
    it(`does not reconnect on close code ${label}`, async () => {
      server = await createCloseServer(code, reason);

      client = new NoexClient(`ws://127.0.0.1:${server.port}`, {
        WebSocket: WebSocket as never,
        reconnect: FAST_RECONNECT,
      });

      await client.connect();
      expect(client.isConnected).toBe(true);

      // Track reconnect attempts — there should be none
      const reconnectAttempts: number[] = [];
      client.on('reconnecting', (attempt) => reconnectAttempts.push(attempt));

      // Wait for the disconnected event (server closes after 50ms)
      const disconnectedReason = await waitForEvent<string>(client, 'disconnected');

      expect(client.state).toBe('disconnected');
      expect(disconnectedReason).toBe(reason);

      // Wait a bit to confirm no reconnect attempts were made
      await new Promise((r) => setTimeout(r, 300));
      expect(reconnectAttempts).toHaveLength(0);
    });
  }

  it('still reconnects on normal close codes', async () => {
    // Use code 1001 (going away) — a retryable close code
    server = await createCloseServer(1001, 'going_away');

    client = new NoexClient(`ws://127.0.0.1:${server.port}`, {
      WebSocket: WebSocket as never,
      reconnect: FAST_RECONNECT,
    });

    await client.connect();

    // Wait for at least one reconnect attempt
    const reconnected = await new Promise<number>((resolve) => {
      const unsub = client!.on('reconnecting', (attempt) => {
        unsub();
        resolve(attempt);
      });
    });

    expect(reconnected).toBe(1);
    expect(client.state).toBe('reconnecting');
  });
});
