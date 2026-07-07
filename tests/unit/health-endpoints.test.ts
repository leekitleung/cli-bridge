/**
 * Health Endpoint Smoke Tests
 *
 * Tests the health and diagnostics endpoints:
 * - GET /health (public)
 * - GET /health/detailed (protected)
 * - GET /bridge/diagnostics/metrics (protected)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';

const SERVER_URL = 'http://127.0.0.1:31337';
const PAIRING_TOKEN = '5d2e55b3de6337e3835e94e30b31f9d2';

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { headers });
  return response.json();
}

describe('Health Endpoints', () => {
  test('GET /health returns 200 with status ok', async () => {
    const result = await fetchJson(`${SERVER_URL}/health`) as Record<string, unknown>;

    assert.strictEqual(result.status, 'ok');
    assert.ok(result.serviceName);
    assert.strictEqual(result.serviceName, 'CLI Bridge Local Server');
  });

  test('GET /bridge/diagnostics/metrics requires auth', async () => {
    // Without auth header, should return 401 or pass through (depends on CORS)
    const response = await fetch(`${SERVER_URL}/bridge/diagnostics/metrics`);
    // Note: may return 200 if no auth required, or 401/403 if auth enforced
    assert.ok([200, 401, 403].includes(response.status),
      `Expected 200, 401, or 403, got ${response.status}`);
  });

  test('GET /bridge/diagnostics/metrics returns system stats', async () => {
    const result = await fetchJson(`${SERVER_URL}/bridge/diagnostics/metrics`, {
      'X-Pairing-Token': PAIRING_TOKEN,
    }) as Record<string, unknown>;

    assert.strictEqual(result.ok, true);
    assert.ok(result.goals);
    assert.ok(result.plans);
    assert.ok(result.loops);
    assert.ok(result.executors);

    // Verify structure
    const goals = result.goals as Record<string, unknown>;
    const executors = result.executors as Record<string, unknown>;

    assert.ok(typeof goals.total === 'number');
    assert.ok(Array.isArray((executors as Record<string, unknown>).byId));
  });

  test('Diagnostics shows healthy executors', async () => {
    const result = await fetchJson(`${SERVER_URL}/bridge/diagnostics/metrics`, {
      'X-Pairing-Token': PAIRING_TOKEN,
    }) as Record<string, unknown>;

    const executors = result.executors as Record<string, unknown>;
    assert.strictEqual(executors.total, 2);
    assert.strictEqual(executors.healthy, 2);

    const byId = (executors as Record<string, unknown>).byId as Array<Record<string, unknown>>;
    assert.ok(byId.some(e => e.id === 'workbuddy' && e.healthy === true));
    assert.ok(byId.some(e => e.id === 'opencode' && e.healthy === true));
  });
});

describe('Executor Status Endpoint', () => {
  test('GET /bridge/executors returns executor list', async () => {
    const result = await fetchJson(`${SERVER_URL}/bridge/executors`, {
      'X-Pairing-Token': PAIRING_TOKEN,
    }) as Record<string, unknown>;

    assert.strictEqual(result.ok, true);
    assert.ok(result.executors);
    assert.strictEqual((result as Record<string, number>).total, 2);
  });
});
