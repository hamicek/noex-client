import { describe, it, expect } from 'vitest';
import { createMetrics } from './metrics.js';

describe('createMetrics', () => {
  it('starts empty with zeroed values', () => {
    const m = createMetrics();
    expect(m.count).toBe(0);
    expect(m.totalMs).toBe(0);
    expect(m.rps).toBe(0);
    expect(m.p50).toBe(0);
    expect(m.p95).toBe(0);
    expect(m.p99).toBe(0);
    expect(m.min).toBe(0);
    expect(m.max).toBe(0);
  });

  it('records a single sample correctly', () => {
    const m = createMetrics();
    m.record(10);
    expect(m.count).toBe(1);
    expect(m.totalMs).toBe(10);
    expect(m.rps).toBe(100); // 1 / 0.01s = 100
    expect(m.min).toBe(10);
    expect(m.max).toBe(10);
    expect(m.p50).toBe(10);
    expect(m.p95).toBe(10);
    expect(m.p99).toBe(10);
  });

  it('computes percentiles for known distribution', () => {
    const m = createMetrics();
    // Record 1..100 (each value once)
    for (let i = 1; i <= 100; i++) {
      m.record(i);
    }
    expect(m.count).toBe(100);
    expect(m.min).toBe(1);
    expect(m.max).toBe(100);
    expect(m.p50).toBe(50);
    expect(m.p95).toBe(95);
    expect(m.p99).toBe(99);
  });

  it('computes RPS as count / (totalMs / 1000)', () => {
    const m = createMetrics();
    // 100 samples of 2ms each => total = 200ms = 0.2s => RPS = 100/0.2 = 500
    for (let i = 0; i < 100; i++) {
      m.record(2);
    }
    expect(m.rps).toBeCloseTo(500, 0);
  });

  it('tracks min and max correctly', () => {
    const m = createMetrics();
    m.record(5);
    m.record(1);
    m.record(9);
    m.record(3);
    expect(m.min).toBe(1);
    expect(m.max).toBe(9);
  });

  it('report outputs formatted metrics to console', () => {
    const m = createMetrics();
    for (let i = 0; i < 10; i++) {
      m.record(1);
    }

    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(' '));
    try {
      m.report('Test label');
    } finally {
      console.log = originalLog;
    }

    expect(lines[0]).toBe('[Stress] Test label');
    expect(lines[1]).toContain('Count:');
    expect(lines[1]).toContain('10');
    expect(lines[2]).toContain('RPS:');
    expect(lines[3]).toContain('p50:');
    expect(lines[4]).toContain('p95:');
    expect(lines[5]).toContain('p99:');
    expect(lines[6]).toContain('Min:');
    expect(lines[7]).toContain('Max:');
  });
});
