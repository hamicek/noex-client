/**
 * Shared helpers for examples.
 *
 * Starts a real NoexServer on a random port, returns the URL and
 * a cleanup function. Every example is fully self-contained.
 */
import { Store } from '@hamicek/noex-store';
import { NoexServer } from '@hamicek/noex-server';
import type { AuthConfig } from '@hamicek/noex-server';
import type { RuleEngine } from '@hamicek/noex-rules';

export interface ExampleContext {
  store: Store;
  server: NoexServer;
  url: string;
  stop: () => Promise<void>;
}

let counter = 0;

export async function startExample(options?: {
  buckets?: Array<{ name: string; schema: Record<string, unknown> }>;
  rules?: RuleEngine;
  auth?: AuthConfig;
}): Promise<ExampleContext> {
  const store = await Store.start({ name: `example-${++counter}` });

  if (options?.buckets) {
    for (const b of options.buckets) {
      await store.defineBucket(b.name, {
        key: 'id',
        schema: {
          id: { type: 'string', generated: 'uuid' },
          ...b.schema,
        },
      });
    }
  }

  const server = await NoexServer.start({
    store,
    rules: options?.rules,
    auth: options?.auth,
    port: 0,
    host: '127.0.0.1',
  });

  const url = `ws://127.0.0.1:${server.port}`;

  return {
    store,
    server,
    url,
    async stop() {
      if (server.isRunning) await server.stop();
      await store.stop();
    },
  };
}

/** Poll until a condition is true (useful for push-based tests). */
export function waitFor(
  fn: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fn()) { resolve(); return; }
    const start = Date.now();
    const interval = setInterval(() => {
      if (fn()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error('waitFor timed out'));
      }
    }, 10);
  });
}
