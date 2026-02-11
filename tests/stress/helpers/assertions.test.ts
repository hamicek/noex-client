import { describe, it, expect } from 'vitest';
import { waitFor, flush } from './assertions.js';

describe('waitFor', () => {
  it('resolves immediately when predicate is already true', async () => {
    await waitFor(() => true);
  });

  it('resolves once predicate becomes true', async () => {
    let ready = false;
    setTimeout(() => { ready = true; }, 30);

    await waitFor(() => ready, 500);
    expect(ready).toBe(true);
  });

  it('rejects after timeout when predicate stays false', async () => {
    await expect(
      waitFor(() => false, 50),
    ).rejects.toThrow('waitFor timed out after 50ms');
  });

  it('uses custom interval for polling', async () => {
    let polls = 0;
    const predicate = () => { polls++; return polls >= 3; };

    await waitFor(predicate, 1000, 5);
    expect(polls).toBeGreaterThanOrEqual(3);
  });
});

describe('flush', () => {
  it('resolves after the specified delay', async () => {
    const start = Date.now();
    await flush(50);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(40); // timer jitter tolerance
  });

  it('defaults to 50ms when no argument given', async () => {
    const start = Date.now();
    await flush();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});
