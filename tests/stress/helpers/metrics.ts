export interface Metrics {
  record(durationMs: number): void;
  readonly count: number;
  readonly totalMs: number;
  readonly rps: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly min: number;
  readonly max: number;
  report(label: string): void;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)]!;
}

function formatMs(ms: number): string {
  return ms < 1 ? `${ms.toFixed(3)}ms` : `${ms.toFixed(1)}ms`;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function createMetrics(): Metrics {
  const samples: number[] = [];
  let total = 0;
  let minVal = Infinity;
  let maxVal = -Infinity;

  function ensureSorted(): number[] {
    return [...samples].sort((a, b) => a - b);
  }

  return {
    record(durationMs: number): void {
      samples.push(durationMs);
      total += durationMs;
      if (durationMs < minVal) minVal = durationMs;
      if (durationMs > maxVal) maxVal = durationMs;
    },

    get count(): number {
      return samples.length;
    },

    get totalMs(): number {
      return total;
    },

    get rps(): number {
      if (samples.length === 0 || total === 0) return 0;
      return (samples.length / total) * 1000;
    },

    get p50(): number {
      return percentile(ensureSorted(), 50);
    },

    get p95(): number {
      return percentile(ensureSorted(), 95);
    },

    get p99(): number {
      return percentile(ensureSorted(), 99);
    },

    get min(): number {
      return samples.length === 0 ? 0 : minVal;
    },

    get max(): number {
      return samples.length === 0 ? 0 : maxVal;
    },

    report(label: string): void {
      const sorted = ensureSorted();
      console.log(`[Stress] ${label}`);
      console.log(`  Count:  ${formatNumber(samples.length)}`);
      console.log(`  RPS:    ${formatNumber((samples.length / total) * 1000)}`);
      console.log(`  p50:    ${formatMs(percentile(sorted, 50))}`);
      console.log(`  p95:    ${formatMs(percentile(sorted, 95))}`);
      console.log(`  p99:    ${formatMs(percentile(sorted, 99))}`);
      console.log(`  Min:    ${formatMs(samples.length === 0 ? 0 : minVal)}`);
      console.log(`  Max:    ${formatMs(samples.length === 0 ? 0 : maxVal)}`);
    },
  };
}
