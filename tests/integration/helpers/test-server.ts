import { Store } from '@hamicek/noex-store';
import { NoexServer } from '@hamicek/noex-server';
import type { AuthConfig, AuditConfig, BackpressureConfig, RateLimitConfig, RevocationConfig } from '@hamicek/noex-server';
import type { RuleEngine } from '@hamicek/noex-rules';

export interface TestServerContext {
  server: NoexServer;
  store: Store;
  rules?: RuleEngine;
  url: string;
  port: number;
  stop: () => Promise<void>;
}

let storeCounter = 0;

export async function startTestServer(
  options?: {
    port?: number;
    buckets?: Array<{ name: string; schema: Record<string, unknown> }>;
    rules?: RuleEngine;
    auth?: AuthConfig;
    audit?: AuditConfig;
    revocation?: RevocationConfig;
    backpressure?: BackpressureConfig;
    rateLimit?: RateLimitConfig;
  },
): Promise<TestServerContext> {
  const store = await Store.start({ name: `client-test-${++storeCounter}` });

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
    audit: options?.audit,
    revocation: options?.revocation,
    backpressure: options?.backpressure,
    rateLimit: options?.rateLimit,
    port: options?.port ?? 0,
    host: '127.0.0.1',
  });

  const port = server.port;
  const url = `ws://127.0.0.1:${port}`;

  return {
    server,
    store,
    rules: options?.rules,
    url,
    port,
    async stop() {
      if (server.isRunning) {
        await server.stop();
      }
      await store.stop();
    },
  };
}
