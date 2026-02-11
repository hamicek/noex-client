import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/stress/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true, execArgv: ['--expose-gc'] },
    },
  },
});
