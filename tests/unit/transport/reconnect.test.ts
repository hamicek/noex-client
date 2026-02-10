import { describe, it, expect, vi } from 'vitest';
import { ReconnectStrategy } from '../../../src/transport/reconnect.js';

describe('ReconnectStrategy', () => {
  describe('getDelay', () => {
    it('returns initial delay for first attempt', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const strategy = new ReconnectStrategy({
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        jitterMs: 0,
        maxDelayMs: 30_000,
        maxRetries: 10,
      });

      expect(strategy.getDelay(0)).toBe(1000);
      vi.restoreAllMocks();
    });

    it('applies exponential backoff', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const strategy = new ReconnectStrategy({
        initialDelayMs: 100,
        backoffMultiplier: 2,
        jitterMs: 0,
        maxDelayMs: 100_000,
        maxRetries: 10,
      });

      expect(strategy.getDelay(0)).toBe(100);  // 100 * 2^0
      expect(strategy.getDelay(1)).toBe(200);  // 100 * 2^1
      expect(strategy.getDelay(2)).toBe(400);  // 100 * 2^2
      expect(strategy.getDelay(3)).toBe(800);  // 100 * 2^3
      vi.restoreAllMocks();
    });

    it('caps delay at maxDelayMs', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const strategy = new ReconnectStrategy({
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        maxDelayMs: 5000,
        jitterMs: 0,
        maxRetries: 10,
      });

      // 1000 * 2^3 = 8000, capped at 5000
      expect(strategy.getDelay(3)).toBe(5000);
      // 1000 * 2^9 = 512000, still capped at 5000
      expect(strategy.getDelay(9)).toBe(5000);
      vi.restoreAllMocks();
    });

    it('adds jitter within range', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const strategy = new ReconnectStrategy({
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        jitterMs: 500,
        maxDelayMs: 30_000,
        maxRetries: 10,
      });

      // 1000 + 0.5 * 500 = 1250
      expect(strategy.getDelay(0)).toBe(1250);
      vi.restoreAllMocks();
    });

    it('returns null when max retries reached', () => {
      const strategy = new ReconnectStrategy({
        maxRetries: 3,
        initialDelayMs: 100,
        backoffMultiplier: 2,
        jitterMs: 0,
        maxDelayMs: 30_000,
      });

      expect(strategy.getDelay(0)).not.toBeNull();
      expect(strategy.getDelay(1)).not.toBeNull();
      expect(strategy.getDelay(2)).not.toBeNull();
      expect(strategy.getDelay(3)).toBeNull(); // attempt >= maxRetries
      expect(strategy.getDelay(4)).toBeNull();
    });

    it('uses default values when no options provided', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const strategy = new ReconnectStrategy();

      // Default: initialDelayMs=1000, backoffMultiplier=2, jitterMs=500 (mocked to 0)
      expect(strategy.getDelay(0)).toBe(1000);
      vi.restoreAllMocks();
    });

    it('handles Infinity maxRetries', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const strategy = new ReconnectStrategy({
        maxRetries: Infinity,
        initialDelayMs: 100,
        backoffMultiplier: 2,
        jitterMs: 0,
        maxDelayMs: 1000,
      });

      expect(strategy.getDelay(100)).not.toBeNull();
      expect(strategy.getDelay(1000)).not.toBeNull();
      // At high attempts, still capped at maxDelayMs
      expect(strategy.getDelay(100)).toBe(1000);
      vi.restoreAllMocks();
    });

    it('jitter stays within [0, jitterMs) range', () => {
      const strategy = new ReconnectStrategy({
        initialDelayMs: 100,
        backoffMultiplier: 1,
        jitterMs: 1000,
        maxDelayMs: 30_000,
        maxRetries: 10,
      });

      for (let i = 0; i < 50; i++) {
        const delay = strategy.getDelay(0)!;
        expect(delay).toBeGreaterThanOrEqual(100);
        expect(delay).toBeLessThan(1100); // 100 + 1000
      }
    });

    it('works with custom backoff multiplier', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const strategy = new ReconnectStrategy({
        initialDelayMs: 100,
        backoffMultiplier: 3,
        jitterMs: 0,
        maxDelayMs: 100_000,
        maxRetries: 5,
      });

      expect(strategy.getDelay(0)).toBe(100);   // 100 * 3^0
      expect(strategy.getDelay(1)).toBe(300);   // 100 * 3^1
      expect(strategy.getDelay(2)).toBe(900);   // 100 * 3^2
      expect(strategy.getDelay(3)).toBe(2700);  // 100 * 3^3
      vi.restoreAllMocks();
    });
  });
});
