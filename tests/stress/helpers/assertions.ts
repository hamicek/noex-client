// ── Stress-test assertion helpers ────────────────────────────────

/**
 * Polls `fn` every `intervalMs` until it returns `true` or `timeoutMs` elapses.
 * Resolves immediately if `fn` is already satisfied.
 */
export function waitFor(
  fn: () => boolean,
  timeoutMs = 5000,
  intervalMs = 10,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fn()) {
      resolve();
      return;
    }

    const start = Date.now();
    const timer = setInterval(() => {
      if (fn()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start >= timeoutMs) {
        clearInterval(timer);
        reject(new Error(`waitFor timed out after ${timeoutMs}ms`));
      }
    }, intervalMs);
  });
}

/**
 * Returns a promise that resolves after `ms` milliseconds.
 * Useful for letting async side-effects (close handlers, GC, etc.) settle.
 */
export function flush(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
