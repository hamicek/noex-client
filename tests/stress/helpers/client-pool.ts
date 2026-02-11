import WebSocket from 'ws';
import { NoexClient } from '../../../src/index.js';
import type { ClientOptions } from '../../../src/index.js';

// ── Types ─────────────────────────────────────────────────────────

export interface ClientPool {
  /** Connect all clients in batches to avoid EMFILE. */
  connectAll(): Promise<void>;
  /** Gracefully disconnect all connected clients. */
  disconnectAll(): Promise<void>;
  /** Immediately terminate all WebSocket connections (simulates network failure). */
  forceDisconnectAll(): void;
  /** Get client by index. Throws RangeError if out of bounds. */
  getClient(index: number): NoexClient;
  /** Run an async function on every client and collect results. */
  eachClient<T>(fn: (client: NoexClient, index: number) => Promise<T>): Promise<T[]>;
  readonly size: number;
  readonly connectedCount: number;
}

export interface ClientPoolOptions {
  /** How many clients to connect concurrently per batch. Default: 50. */
  batchSize?: number;
  /** Overrides for individual NoexClient options (WebSocket is provided automatically). */
  clientOptions?: Omit<ClientOptions, 'WebSocket'>;
}

// ── Factory ───────────────────────────────────────────────────────

export function createClientPool(
  url: string,
  count: number,
  options?: ClientPoolOptions,
): ClientPool {
  const batchSize = options?.batchSize ?? 50;

  const clients: NoexClient[] = Array.from({ length: count }, () =>
    new NoexClient(url, {
      WebSocket: WebSocket as never,
      reconnect: false,
      ...options?.clientOptions,
    }),
  );

  return {
    async connectAll(): Promise<void> {
      for (let i = 0; i < clients.length; i += batchSize) {
        const batch = clients.slice(i, i + batchSize);
        await Promise.all(batch.map((c) => c.connect()));
      }
    },

    async disconnectAll(): Promise<void> {
      // Disconnect in parallel — ignore errors from already-closed sockets
      await Promise.all(
        clients.map((c) => c.disconnect().catch(() => {})),
      );
    },

    forceDisconnectAll(): void {
      for (const client of clients) {
        // Access internal ws instance for abrupt termination (test-only).
        // `terminate()` is a ws-specific method that destroys the socket
        // without sending a close frame — simulates a sudden network failure.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ws = (client as any).transport?.ws;
        if (ws && typeof ws.terminate === 'function') {
          ws.terminate();
        }
      }
    },

    getClient(index: number): NoexClient {
      if (index < 0 || index >= clients.length) {
        throw new RangeError(
          `Client index ${index} out of range (pool size: ${clients.length})`,
        );
      }
      return clients[index]!;
    },

    eachClient<T>(fn: (client: NoexClient, index: number) => Promise<T>): Promise<T[]> {
      return Promise.all(clients.map((c, i) => fn(c, i)));
    },

    get size(): number {
      return clients.length;
    },

    get connectedCount(): number {
      return clients.filter((c) => c.isConnected).length;
    },
  };
}
