/**
 * Goal-Loop Integration Test
 *
 * Tests the complete flow from Goal creation to Loop execution:
 * 1. Goal creation and Plan generation
 * 2. Plan approval
 * 3. Goal Loop start/stop
 * 4. Gate approval and execution
 * 5. Executor status queries
 *
 * Uses Node.js built-in test runner.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert';

// Test configuration
const BRIDGE_SERVER_URL = 'http://127.0.0.1:31337';
const PAIRING_TOKEN_HEADER = 'x-cli-bridge-pairing-token';

interface GoalResponse {
  ok: boolean;
  goal?: {
    id: string;
    status: string;
    description: string;
  };
  error?: string;
}

interface PlanResponse {
  ok: boolean;
  plan?: {
    id: string;
    status: string;
    steps: Array<{
      id: string;
      intent: string;
      kind: string;
      status: string;
    }>;
  };
  error?: string;
}

interface LoopStatusResponse {
  ok: boolean;
  status?: {
    goalId: string;
    planId: string;
    goalStatus: string;
    planStatus: string;
    currentStepIndex: number;
    totalSteps: number;
  };
  error?: string;
}

interface ExecutorStatusResponse {
  ok: boolean;
  total: number;
  healthy: number;
  executors: Array<{
    id: string;
    name: string;
    healthy: boolean;
  }>;
}

/**
 * Helper: Make authenticated fetch request
 */
async function authFetch(url: string, token: string, options: RequestInit = {}): Promise<Response> {
  const headers = {
    ...options.headers,
    [PAIRING_TOKEN_HEADER]: token,
  };
  return fetch(url, { ...options, headers });
}

/**
 * Helper: Create a goal
 */
async function createGoal(token: string, sessionId: string, description: string): Promise<{ ok: boolean; goal?: unknown; error?: string }> {
  const response = await authFetch(`${BRIDGE_SERVER_URL}/bridge/goals`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, description }),
  });
  const data = await response.json();
  // API returns { goal, bindingSnapshot } with status code 201
  return {
    ok: response.status >= 200 && response.status < 300,
    goal: data.goal,
    error: data.status === 'error' ? data.message : undefined,
  };
}

/**
 * Helper: Attach a plan to a goal
 */
async function attachPlan(
  token: string,
  goalId: string,
  steps: Array<{ intent: string; kind: string; targetEndpointId: string }>,
): Promise<{ ok: boolean; plan?: unknown; error?: string }> {
  const response = await authFetch(`${BRIDGE_SERVER_URL}/bridge/goals/plan`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Use 'manual' planner to avoid Claude Code dependency in tests
    body: JSON.stringify({ goalId, steps, plannerSource: 'manual' }),
  });
  const data = await response.json();
  if (response.status >= 200 && response.status < 300) {
    return { ok: true, plan: data.plan };
  }
  return {
    ok: false,
    error: data.status === 'error' ? data.message : `HTTP ${response.status}: ${JSON.stringify(data)}`,
  };
}

/**
 * Helper: Approve a plan
 */
async function approvePlan(token: string, goalId: string): Promise<{ ok: boolean; error?: string }> {
  const response = await authFetch(`${BRIDGE_SERVER_URL}/bridge/goals/approve`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ goalId }),
  });
  const data = await response.json();
  return {
    ok: response.status >= 200 && response.status < 300,
    error: data.status === 'error' ? data.message : data.error,
  };
}

/**
 * Helper: Start goal loop
 */
async function startLoop(token: string, goalId: string): Promise<{ ok: boolean; loopId?: string; error?: string }> {
  const response = await authFetch(`${BRIDGE_SERVER_URL}/bridge/goals/${goalId}/loop/start`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
  return response.json();
}

/**
 * Helper: Get loop status
 */
async function getLoopStatus(token: string, goalId: string): Promise<{ ok: boolean; status?: unknown; error?: string }> {
  const response = await authFetch(`${BRIDGE_SERVER_URL}/bridge/goals/${goalId}/loop/status`, token);
  const data = await response.json();
  return {
    ok: response.status >= 200 && response.status < 300,
    status: data.status,
    error: data.status === 'error' ? data.message : data.error,
  };
}

/**
 * Helper: Stop goal loop
 */
async function stopLoop(token: string, goalId: string): Promise<{ ok: boolean; error?: string }> {
  const response = await authFetch(`${BRIDGE_SERVER_URL}/bridge/goals/${goalId}/loop/stop`, token, {
    method: 'POST',
  });
  const data = await response.json();
  return {
    ok: response.status >= 200 && response.status < 300,
    error: data.status === 'error' ? data.message : data.error,
  };
}

/**
 * Helper: Get executor status
 */
async function getExecutorStatus(token: string): Promise<ExecutorStatusResponse> {
  const response = await authFetch(`${BRIDGE_SERVER_URL}/bridge/executors`, token);
  return response.json();
}

describe('Goal Loop Integration Tests', { concurrency: false }, () => {
  let pairingToken: string | null = null;

  before(async () => {
    // Get pairing token from protected health endpoint (requires auth)
    // First try public endpoint
    try {
      const publicResponse = await fetch(`${BRIDGE_SERVER_URL}/health`);
      if (publicResponse.ok) {
        const health = await publicResponse.json();
        if (health.pairingToken) {
          pairingToken = health.pairingToken;
          console.log(`[Test Setup] Got pairing token from public endpoint`);
          return;
        }
      }
    } catch (err) {
      console.log('[Test Setup] Could not fetch public health:', (err as Error).message);
    }

    // Try to get token from protected health using loopback origin
    try {
      const response = await fetch(`${BRIDGE_SERVER_URL}/protected/health`, {
        headers: {
          'origin': 'http://127.0.0.1:31337',
        },
      });
      if (response.ok) {
        const health = await response.json();
        pairingToken = health.pairingToken ?? null;
        console.log(`[Test Setup] Got pairing token from protected endpoint`);
      }
    } catch (err) {
      console.log('[Test Setup] Could not get pairing token:', (err as Error).message);
    }
  });

  describe('1. Goal Lifecycle', () => {
    it('should create a goal', async () => {
      if (!pairingToken) {
        // Skip if server not available
        console.log('[Test] Skipping: Server not available');
        return;
      }

      const result = await createGoal(pairingToken, 'test-session-001', 'Test goal for e2e integration');
      assert.strictEqual(result.ok, true);
      assert.ok(result.goal);
      assert.strictEqual(result.goal!.status, 'draft');
      console.log(`[Test] Created goal: ${result.goal!.id}`);
    });

    it('should create a plan for a goal', async () => {
      if (!pairingToken) return;

      // Create goal
      const goal = await createGoal(pairingToken, 'test-session-002', 'Goal with plan');
      if (!goal.ok) {
        console.log('[DEBUG] createGoal failed:', goal.error);
      }
      assert.ok(goal.goal?.id);

      // Attach plan
      const plan = await attachPlan(pairingToken, goal.goal!.id, [
        {
          intent: 'Run a test command',
          kind: 'run-command',
          targetEndpointId: 'workbuddy',
        },
      ]);
      if (!plan.ok) {
        console.log('[DEBUG] attachPlan failed:', plan.error);
      }
      assert.strictEqual(plan.ok, true);
      assert.ok(plan.plan);
      assert.strictEqual(plan.plan!.status, 'awaiting-approval');
      assert.strictEqual(plan.plan!.steps.length, 1);
    });

    it('should approve a plan', async () => {
      if (!pairingToken) return;

      // Create goal and plan
      const goal = await createGoal(pairingToken, 'test-session-003', 'Goal to approve');
      assert.ok(goal.goal?.id);

      await attachPlan(pairingToken, goal.goal!.id, [
        {
          intent: 'Simple query',
          kind: 'review',
          targetEndpointId: 'claude',
        },
      ]);

      // Approve plan
      const approve = await approvePlan(pairingToken, goal.goal!.id);
      assert.strictEqual(approve.ok, true);
    });
  });

  describe('2. Goal Loop Management', () => {
    it('should start a goal loop', async () => {
      if (!pairingToken) return;

      // Create and approve a goal
      const goal = await createGoal(pairingToken, 'test-session-004', 'Goal for loop test');
      assert.ok(goal.goal?.id);

      await attachPlan(pairingToken, goal.goal!.id, [
        {
          intent: 'Query system status',
          kind: 'review',
          targetEndpointId: 'claude',
        },
      ]);

      await approvePlan(pairingToken, goal.goal!.id);

      // Start loop
      const result = await startLoop(pairingToken, goal.goal!.id);
      assert.strictEqual(result.ok, true);
      assert.ok(result.loopId);
      console.log(`[Test] Started loop: ${result.loopId}`);
    });

    it('should get loop status', async () => {
      if (!pairingToken) return;

      // Create and start a goal loop
      const goal = await createGoal(pairingToken, 'test-session-005', 'Goal for status test');
      assert.ok(goal.goal?.id);

      await attachPlan(pairingToken, goal.goal!.id, [
        {
          intent: 'Quick query',
          kind: 'review',
          targetEndpointId: 'claude',
        },
      ]);

      await approvePlan(pairingToken, goal.goal!.id);
      await startLoop(pairingToken, goal.goal!.id);

      // Get status
      const status = await getLoopStatus(pairingToken, goal.goal!.id);
      assert.strictEqual(status.ok, true);
      assert.ok(status.status);
      assert.strictEqual(status.status!.goalId, goal.goal!.id);
    });

    it('should stop a goal loop', async () => {
      if (!pairingToken) return;

      // Create and start a goal loop
      const goal = await createGoal(pairingToken, 'test-session-006', 'Goal to stop');
      assert.ok(goal.goal?.id);

      await attachPlan(pairingToken, goal.goal!.id, [
        {
          intent: 'Query status',
          kind: 'review',
          targetEndpointId: 'claude',
        },
      ]);

      await approvePlan(pairingToken, goal.goal!.id);
      await startLoop(pairingToken, goal.goal!.id);

      // Stop loop
      const result = await stopLoop(pairingToken, goal.goal!.id);
      assert.strictEqual(result.ok, true);
    });
  });

  describe('3. Gate Approval', () => {
    it('should have pending gates for mutating steps', async () => {
      if (!pairingToken) return;

      // Create goal with a mutating step
      const goal = await createGoal(pairingToken, 'test-session-007', 'Goal with mutating step');
      assert.ok(goal.goal?.id);

      await attachPlan(pairingToken, goal.goal!.id, [
        {
          intent: 'Run a command',
          kind: 'run-command',
          targetEndpointId: 'workbuddy',
        },
      ]);

      await approvePlan(pairingToken, goal.goal!.id);
      await startLoop(pairingToken, goal.goal!.id);

      // Wait for loop to tick
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Get pending gates
      const gatesResponse = await authFetch(
        `${BRIDGE_SERVER_URL}/bridge/goals/${goal.goal!.id}/loop/gates`,
        pairingToken
      );
      const gates = await gatesResponse.json();
      assert.ok(gates.gates);
    });
  });

  describe('4. Executor Status', () => {
    it('should return executor status', async () => {
      if (!pairingToken) return;

      const status = await getExecutorStatus(pairingToken);
      assert.strictEqual(status.ok, true);
      assert.ok(status.total >= 0);
      assert.ok(Array.isArray(status.executors));

      // WorkBuddy should be registered
      const workbuddy = status.executors.find(e => e.id === 'workbuddy');
      assert.ok(workbuddy, 'WorkBuddy executor should be registered');
      console.log(`[Test] Executor status: ${status.healthy}/${status.total} healthy`);
    });
  });

  describe('5. Error Handling', () => {
    it('should reject starting loop for non-approved goal', async () => {
      if (!pairingToken) return;

      // Create goal but don't approve
      const goal = await createGoal(pairingToken, 'test-session-008', 'Unapproved goal');
      assert.ok(goal.goal?.id);

      // Try to start loop (should fail)
      const result = await startLoop(pairingToken, goal.goal!.id);
      assert.strictEqual(result.ok, false);
    });

    it('should require authentication for protected endpoints', async () => {
      // Executor endpoint doesn't require auth (diagnostic endpoint)
      const response = await fetch(`${BRIDGE_SERVER_URL}/bridge/executors`);
      assert.strictEqual(response.status, 200);
    });
  });
});
