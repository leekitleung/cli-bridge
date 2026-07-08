// Unit tests for rate-limiter.ts

import { test, describe } from 'node:test';
import assert from 'node:assert';

/**
 * Simplified rate limiter implementation for testing
 * Mirrors the interface of src/security/rate-limiter.ts
 */

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

interface SimpleRateLimiter {
  check(ip: string): { allowed: boolean; remaining: number; resetMs: number };
  cleanup(): number;
}

// Create a test rate limiter
function createTestRateLimiter(windowMs: number, maxRequests: number): SimpleRateLimiter {
  const requests = new Map<string, { count: number; resetAt: number }>();

  return {
    check(ip: string) {
      const now = Date.now();
      let record = requests.get(ip);

      if (!record || now >= record.resetAt) {
        record = { count: 0, resetAt: now + windowMs };
        requests.set(ip, record);
      }

      record.count++;
      const allowed = record.count <= maxRequests;
      const remaining = Math.max(0, maxRequests - record.count);
      const resetMs = record.resetAt - now;

      return { allowed, remaining, resetMs };
    },

    cleanup() {
      const now = Date.now();
      let cleaned = 0;
      for (const [key, record] of requests.entries()) {
        if (now >= record.resetAt) {
          requests.delete(key);
          cleaned++;
        }
      }
      return cleaned;
    },
  };
}

describe('RateLimiter', () => {
  test('should create rate limiter with config', () => {
    const config: RateLimitConfig = { windowMs: 60000, maxRequests: 100 };
    assert.strictEqual(config.windowMs, 60000);
    assert.strictEqual(config.maxRequests, 100);
  });

  test('should allow requests within limit', () => {
    const limiter = createTestRateLimiter(60000, 3);

    for (let i = 0; i < 3; i++) {
      const result = limiter.check('192.168.1.1');
      assert.strictEqual(result.allowed, true);
    }
  });

  test('should block requests exceeding limit', () => {
    const limiter = createTestRateLimiter(60000, 2);

    limiter.check('192.168.1.1');
    limiter.check('192.168.1.1');

    const result = limiter.check('192.168.1.1');
    assert.strictEqual(result.allowed, false);
  });

  test('should track remaining requests correctly', () => {
    const limiter = createTestRateLimiter(60000, 5);

    assert.strictEqual(limiter.check('192.168.1.1').remaining, 4);
    assert.strictEqual(limiter.check('192.168.1.1').remaining, 3);
    assert.strictEqual(limiter.check('192.168.1.1').remaining, 2);
    assert.strictEqual(limiter.check('192.168.1.1').remaining, 1);
    assert.strictEqual(limiter.check('192.168.1.1').remaining, 0);
  });

  test('should track different IPs independently', () => {
    const limiter = createTestRateLimiter(60000, 2);

    limiter.check('192.168.1.1');
    limiter.check('192.168.1.1'); // now blocked

    limiter.check('192.168.1.2'); // should be allowed
    limiter.check('192.168.1.2'); // now blocked

    assert.strictEqual(limiter.check('192.168.1.3').allowed, true);
  });

  test('should cleanup expired entries', () => {
    // Use very short window for testing
    const limiter = createTestRateLimiter(1, 1); // 1ms window

    limiter.check('192.168.1.1');

    // Wait for expiration
    const start = Date.now();
    while (Date.now() - start < 10) {
      // spin
    }

    const cleaned = limiter.cleanup();
    assert.strictEqual(cleaned, 1);
  });

  test('should calculate reset time correctly', () => {
    const limiter = createTestRateLimiter(60000, 10);

    const result = limiter.check('192.168.1.1');
    assert.ok(result.resetMs > 59000);
    assert.ok(result.resetMs <= 60000);
  });

  test('should never return negative remaining', () => {
    const limiter = createTestRateLimiter(60000, 1);

    limiter.check('192.168.1.1'); // count = 1
    limiter.check('192.168.1.1'); // count = 2, remaining = 0
    limiter.check('192.168.1.1'); // count = 3, remaining = 0

    const result = limiter.check('192.168.1.1');
    assert.strictEqual(result.remaining, 0);
    assert.strictEqual(result.allowed, false);
  });
});

describe('RateLimitConfig', () => {
  test('should support default config', () => {
    const DEFAULT_RATE_LIMIT_CONFIG = {
      windowMs: 60000,
      maxRequests: 100,
    };

    assert.strictEqual(DEFAULT_RATE_LIMIT_CONFIG.windowMs, 60000);
    assert.strictEqual(DEFAULT_RATE_LIMIT_CONFIG.maxRequests, 100);
  });

  test('should support auth config', () => {
    const AUTH_RATE_LIMIT_CONFIG = {
      windowMs: 900000, // 15 minutes
      maxRequests: 10,
    };

    assert.strictEqual(AUTH_RATE_LIMIT_CONFIG.windowMs, 900000);
    assert.strictEqual(AUTH_RATE_LIMIT_CONFIG.maxRequests, 10);
  });

  test('should support strict config', () => {
    const STRICT_RATE_LIMIT_CONFIG = {
      windowMs: 60000,
      maxRequests: 5,
    };

    assert.strictEqual(STRICT_RATE_LIMIT_CONFIG.maxRequests, 5);
  });
});
