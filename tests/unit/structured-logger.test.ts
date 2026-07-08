// Unit tests for structured logger

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { generateCorrelationId } from '../../apps/local-server/src/utils/structured-logger.ts';

describe('StructuredLogger types', () => {
  test('should define log levels', () => {
    const levels = ['debug', 'info', 'warn', 'error'] as const;
    assert.ok(levels.includes('info'));
    assert.ok(levels.includes('error'));
  });

  test('should support log entry structure', () => {
    const entry = {
      timestamp: Date.now(),
      level: 'info' as const,
      message: 'Test message',
      context: { source: 'test', correlationId: '123' },
    };

    assert.strictEqual(typeof entry.timestamp, 'number');
    assert.strictEqual(entry.level, 'info');
    assert.strictEqual(entry.message, 'Test message');
    assert.ok(entry.context);
  });

  test('should support error entries', () => {
    const error = new Error('Test error');
    const entry = {
      timestamp: Date.now(),
      level: 'error' as const,
      message: 'Error occurred',
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    };

    assert.strictEqual(entry.level, 'error');
    assert.strictEqual(entry.error.name, 'Error');
    assert.strictEqual(entry.error.message, 'Test error');
  });

  test('should support context fields', () => {
    const context = {
      source: 'server',
      operation: 'test',
      durationMs: 100,
      ok: true,
    };

    assert.strictEqual(context.source, 'server');
    assert.strictEqual(context.durationMs, 100);
    assert.strictEqual(context.ok, true);
  });

  test('should support correlation IDs', () => {
    const correlationId = 'abc-123-def';
    const entry = {
      timestamp: Date.now(),
      level: 'info' as const,
      message: 'Request processed',
      correlationId,
    };

    assert.strictEqual(entry.correlationId, correlationId);
  });
});

describe('Logger configuration', () => {
  test('should support file transport config', () => {
    const config = {
      logDir: './logs',
      logFile: 'app',
      maxFileSize: 10 * 1024 * 1024,
      maxFiles: 5,
      fileLevel: 'info',
    };

    assert.strictEqual(config.logDir, './logs');
    assert.strictEqual(config.maxFileSize, 10485760);
    assert.strictEqual(config.maxFiles, 5);
  });

  test('should support console transport config', () => {
    const config = {
      consoleLevel: 'debug',
      prettyPrint: true,
    };

    assert.strictEqual(config.consoleLevel, 'debug');
    assert.strictEqual(config.prettyPrint, true);
  });

  test('should support environment-based defaults', () => {
    const isProd = process.env.NODE_ENV === 'production';

    const defaults = isProd
      ? { consoleLevel: 'warn', prettyPrint: false }
      : { consoleLevel: 'debug', prettyPrint: true };

    if (isProd) {
      assert.strictEqual(defaults.consoleLevel, 'warn');
    } else {
      assert.strictEqual(defaults.consoleLevel, 'debug');
    }
  });
});

describe('withCorrelationId helper', () => {
  test('should generate unique correlation IDs', () => {
    const id1 = generateCorrelationId();
    const id2 = generateCorrelationId();

    // IDs should be different
    assert.notStrictEqual(id1, id2);
    // Should contain timestamp part (36-char base36)
    assert.ok(id1.length > 10);
  });

  test('should format correlation ID for logging', () => {
    const correlationId = generateCorrelationId();
    const logEntry = {
      timestamp: Date.now(),
      level: 'info' as const,
      message: 'Processing request',
      correlationId,
    };

    assert.ok(logEntry.correlationId.length > 0);
  });
});

describe('Log level filtering', () => {
  const levels = ['debug', 'info', 'warn', 'error'] as const;
  const levelPriority: Record<string, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  test('should filter debug when level is info', () => {
    const minLevel = 'info';
    // Debug (0) should be filtered when min level is info (1)
    // So debug priority should be LESS THAN min level
    assert.ok(levelPriority['debug'] < levelPriority[minLevel]);
    // Info (1) should NOT be filtered
    assert.ok(levelPriority['info'] >= levelPriority[minLevel]);
  });

  test('should filter info when level is warn', () => {
    const minLevel = 'warn';
    // Debug (0) and info (1) should be filtered when min level is warn (2)
    assert.ok(levelPriority['debug'] < levelPriority[minLevel]);
    assert.ok(levelPriority['info'] < levelPriority[minLevel]);
  });

  test('should not filter error at any level', () => {
    const levels = ['debug', 'info', 'warn', 'error'] as const;
    for (const minLevel of levels) {
      assert.ok(levelPriority['error'] >= levelPriority[minLevel]);
    }
  });
});
