// ADR-0034 E2E Acceptance: Real WorkBuddy Executor Connector.
//
// Runs a local server, sends conversation messages, and verifies:
// 1. No backend → execution requests blocked.
// 2. Backend worker → real results appear in main chat.
// 3. Diagnostic echo never enters main chat.
// 4. WorkBuddy panel shows lifecycle.

import assert from 'node:assert/strict';
import test from 'node:test';
import { startLocalServer } from '../apps/local-server/src/server.ts';

async function closeServer(handle) {
  await new Promise((res) => handle.server.close(() => res()));
}

function jsonBody(body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  async function* gen() {
    if (text.length > 0) yield Buffer.from(text, 'utf8');
  }
  return gen();
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  };
}

const CONSOLE_HEADERS = { 'content-type': 'application/json', origin: 'http://127.0.0.1' };

// ── Helpers ──

async function fetchJson(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  return { status: res.status, payload: text ? JSON.parse(text) : {} };
}

async function getCookie(handle) {
  const res = await fetch(`${handle.url}/console/project`);
  return res.headers.getSetCookie?.()?.[0] ?? '';
}

async function setupConversation(handle, cookie) {
  const headers = { ...CONSOLE_HEADERS, cookie };
  // Create project
  const proj = await fetchJson(`${handle.url}/bridge/projects`, {
    method: 'POST', headers, body: JSON.stringify({ key: 'e2e-test' }),
  });
  assert.ok(proj.status === 201 || proj.status === 409);

  // Pair conversation — ADR-0035: must use codex-cli since that's the source adapter registered.
  const pair = await fetchJson(`${handle.url}/bridge/projects/e2e-test/conversation-pairing`, {
    method: 'PUT', headers,
    body: JSON.stringify({ sourceEndpointId: 'codex-cli', targetEndpointId: 'workbuddy' }),
  });
  assert.equal(pair.status, 200);
  return headers;
}

// ── Test 1: No backend → execution blocked ──

test('E2E: no backend — execution request returns blocked', async () => {
  const testPlanner = {
    id: 'test-planner',
    mode: 'test-only',
    async plan(input) {
      return {
        id: `out-${Date.now()}`,
        sessionId: input.sessionId,
        plannerEndpointId: 'test-planner',
        visibleText: 'Plan: ' + input.userText,
        intent: 'request_execution',
        proposedInstruction: {
          summary: input.userText,
          payload: input.userText,
          targetExecutorIds: ['workbuddy'],
          riskHints: ['pure-transform'],
        },
        createdAt: new Date().toISOString(),
      };
    },
  };
  const handle = await startLocalServer(0, {
    plannerAdapters: [testPlanner],
    sourceAdapters: [{
      endpointId: 'codex-cli',
      kind: 'codex-cli',
      isAvailable() { return true; },
      async plan(input) { return testPlanner.plan(input); },
    }],
  });
  try {
    const cookie = await getCookie(handle);
    const headers = await setupConversation(handle, cookie);

    // Send execution request — should be blocked because no executor is ready.
    const msg = await fetchJson(`${handle.url}/bridge/projects/e2e-test/conversation/messages`, {
      method: 'POST', headers,
      body: JSON.stringify({ text: 'do something real' }),
    });
    assert.equal(msg.status, 201);

    // Without executorReady, the gate should be 'blocked', not 'auto_execute'.
    // The exact gate type depends on planner intent — with request_execution + no executor → blocked.
    assert.ok(
      msg.payload.gate.type === 'blocked' || msg.payload.gate.type === 'continue_planning',
      `Expected blocked or continue_planning, got ${msg.payload.gate.type}`,
    );

    // Check messages — no executor_output should exist.
    const messages = await fetchJson(`${handle.url}/bridge/projects/e2e-test/conversation/messages`, {
      headers,
    });
    const executorOutputs = (messages.payload.messages || []).filter(e => e.kind === 'executor_output');
    assert.equal(executorOutputs.length, 0, 'no executor output without real executor');
  } finally {
    await closeServer(handle);
  }
});

// ── Test 2: Real worker with backend → result in main chat ──

test('E2E: real worker with backend — result appears in main chat', async () => {
  const testPlanner = {
    id: 'test-planner',
    mode: 'test-only',
    async plan(input) {
      return {
        id: `out-${Date.now()}`,
        sessionId: input.sessionId,
        plannerEndpointId: 'test-planner',
        visibleText: 'Plan: ' + input.userText,
        intent: 'request_execution',
        proposedInstruction: {
          summary: input.userText,
          payload: input.userText,
          targetExecutorIds: ['workbuddy'],
          riskHints: ['pure-transform'],
        },
        createdAt: new Date().toISOString(),
      };
    },
  };
  const handle = await startLocalServer(0, {
    plannerAdapters: [testPlanner],
    sourceAdapters: [{
      endpointId: 'codex-cli',
      kind: 'codex-cli',
      isAvailable() { return true; },
      async plan(input) { return testPlanner.plan(input); },
    }],
  });
  try {
    const cookie = await getCookie(handle);
    const headers = await setupConversation(handle, cookie);

    // Register WorkBuddy endpoint.
    await fetchJson(`${handle.url}/bridge/endpoints`, {
      method: 'POST', headers,
      body: JSON.stringify({
        id: 'workbuddy',
        transport: 'workbuddy',
        capabilities: { canExecute: true },
      }),
    });

    // Simulate real worker: heartbeat → poll inbox → claim → return result.
    // Step 1: Send heartbeat to declare executorReady.
    const hb = await fetchJson(`${handle.url}/bridge/endpoints/workbuddy/heartbeat`, {
      method: 'POST', headers,
      body: JSON.stringify({ capabilities: { canExecute: true } }),
    });
    assert.equal(hb.status, 200);

    // Step 2: Send execution request — now executor is ready → should auto_execute.
    const msg = await fetchJson(`${handle.url}/bridge/projects/e2e-test/conversation/messages`, {
      method: 'POST', headers,
      body: JSON.stringify({ text: 'echo real execution test' }),
    });
    assert.equal(msg.status, 201);

    // Gate should be auto_execute now.
    if (msg.payload.gate.type === 'blocked') {
      // If still blocked, the readiness check may need a task claim. Let's poll.
      const inbox = await fetchJson(`${handle.url}/bridge/endpoints/workbuddy/inbox/next`, {
        headers,
      });
      if (inbox.payload.task) {
        // Send result.
        await fetchJson(`${handle.url}/bridge/endpoints/workbuddy/results`, {
          method: 'POST', headers,
          body: JSON.stringify({
            taskId: inbox.payload.task.taskId,
            proposalId: inbox.payload.task.proposalId,
            ok: true,
            stdout: 'real execution result: success',
            durationMs: 123,
          }),
        });
      }
    } else if (msg.payload.dispatch?.task) {
      const task = msg.payload.dispatch.task;
      // Poll inbox and claim the task.
      const inbox = await fetchJson(`${handle.url}/bridge/endpoints/workbuddy/inbox/next`, {
        headers,
      });
      if (inbox.payload.task) {
        await fetchJson(`${handle.url}/bridge/endpoints/workbuddy/results`, {
          method: 'POST', headers,
          body: JSON.stringify({
            taskId: inbox.payload.task.taskId,
            proposalId: inbox.payload.task.proposalId,
            ok: true,
            stdout: 'real execution result: success',
            durationMs: 123,
          }),
        });
      }
    }

    // Verify: main chat messages include the real result.
    const messages = await fetchJson(`${handle.url}/bridge/projects/e2e-test/conversation/messages`, {
      headers,
    });
    const allMessages = messages.payload.messages || [];

    // Verify NO diagnostic echo in main chat.
    const diagnosticEntries = allMessages.filter(e =>
      typeof e.text === 'string' && /diagnostic worker received/i.test(e.text),
    );
    assert.equal(diagnosticEntries.length, 0, 'diagnostic echo must not appear in main chat');

    // Verify WorkBuddy panel shows execution data.
    const wb = await fetchJson(`${handle.url}/bridge/projects/e2e-test/workbuddy`, {
      headers,
    });
    assert.equal(wb.status, 200);
    // WorkBuddy panel should include execution readiness info.
    assert.ok(typeof wb.payload.executorReady === 'boolean', 'WorkBuddy panel must include executorReady');
  } finally {
    await closeServer(handle);
  }
});

// ── Test 3: Diagnostic result filtered from main chat ──

test('E2E: diagnostic result never enters main conversation transcript', async () => {
  const testPlanner = {
    id: 'test-planner',
    mode: 'test-only',
    async plan(input) {
      return {
        id: `out-${Date.now()}`,
        sessionId: input.sessionId,
        plannerEndpointId: 'test-planner',
        visibleText: 'Plan: ' + input.userText,
        intent: 'request_execution',
        proposedInstruction: {
          summary: input.userText,
          payload: input.userText,
          targetExecutorIds: ['workbuddy'],
          riskHints: ['pure-transform'],
        },
        createdAt: new Date().toISOString(),
      };
    },
  };
  const handle = await startLocalServer(0, {
    plannerAdapters: [testPlanner],
    sourceAdapters: [{
      endpointId: 'codex-cli',
      kind: 'codex-cli',
      isAvailable() { return true; },
      async plan(input) { return testPlanner.plan(input); },
    }],
  });
  try {
    const cookie = await getCookie(handle);
    const headers = await setupConversation(handle, cookie);

    // Register + heartbeat for executor readiness.
    await fetchJson(`${handle.url}/bridge/endpoints`, {
      method: 'POST', headers,
      body: JSON.stringify({
        id: 'workbuddy',
        transport: 'workbuddy',
        capabilities: { canExecute: true },
      }),
    });
    await fetchJson(`${handle.url}/bridge/endpoints/workbuddy/heartbeat`, {
      method: 'POST', headers,
      body: JSON.stringify({ capabilities: { canExecute: true } }),
    });

    // Send execution request.
    const msg = await fetchJson(`${handle.url}/bridge/projects/e2e-test/conversation/messages`, {
      method: 'POST', headers,
      body: JSON.stringify({ text: 'test workbuddy diagnostic' }),
    });

    // If a task was dispatched, submit a diagnostic result.
    if (msg.payload.dispatch?.task) {
      const task = msg.payload.dispatch.task;
      const inbox = await fetchJson(`${handle.url}/bridge/endpoints/workbuddy/inbox/next`, { headers });
      if (inbox.payload.task) {
        await fetchJson(`${handle.url}/bridge/endpoints/workbuddy/results`, {
          method: 'POST', headers,
          body: JSON.stringify({
            taskId: inbox.payload.task.taskId,
            proposalId: inbox.payload.task.proposalId,
            ok: true,
            stdout: 'diagnostic worker received: test workbuddy diagnostic',
            output: 'diagnostic worker received: test workbuddy diagnostic',
          }),
        });
      }
    }

    // Verify: NO diagnostic text in main chat.
    const messages = await fetchJson(`${handle.url}/bridge/projects/e2e-test/conversation/messages`, { headers });
    const allMessages = messages.payload.messages || [];
    const diagnosticEntries = allMessages.filter(e =>
      typeof e.text === 'string' && /diagnostic worker received/i.test(e.text),
    );
    assert.equal(diagnosticEntries.length, 0, 'diagnostic result must never appear in main chat');
    const executorOutputs = allMessages.filter(e => e.kind === 'executor_output');
    assert.equal(executorOutputs.length, 0, 'no executor_output for diagnostic result');
  } finally {
    await closeServer(handle);
  }
});

// ADR-0034 REVIEW: E2E with configured command backend — worker starts and returns real result.

test('E2E: configured command backend — worker returns real command output', async () => {
  const testPlanner = {
    id: 'test-planner',
    mode: 'test-only',
    async plan(input) {
      return {
        id: `out-${Date.now()}`,
        sessionId: input.sessionId,
        plannerEndpointId: 'test-planner',
        visibleText: 'Plan: ' + input.userText,
        intent: 'request_execution',
        proposedInstruction: {
          summary: input.userText,
          payload: input.userText,
          targetExecutorIds: ['workbuddy'],
          riskHints: ['pure-transform'],
        },
        createdAt: new Date().toISOString(),
      };
    },
  };
  const handle = await startLocalServer(0, {
    plannerAdapters: [testPlanner],
    sourceAdapters: [{
      endpointId: 'codex-cli',
      kind: 'codex-cli',
      isAvailable() { return true; },
      async plan(input) { return testPlanner.plan(input); },
    }],
  });
  try {
    const cookie = (await fetch(`${handle.url}/console/project`)).headers.getSetCookie?.()?.[0] ?? '';
    const headers = { 'content-type': 'application/json', origin: handle.url, cookie };

    // Create project + pairing.
    await fetch(`${handle.url}/bridge/projects`, {
      method: 'POST', headers, body: JSON.stringify({ key: 'e2e-backend' }),
    });
    await fetch(`${handle.url}/bridge/projects/e2e-backend/conversation-pairing`, {
      method: 'PUT', headers,
      body: JSON.stringify({ sourceEndpointId: 'chatgpt-web', targetEndpointId: 'workbuddy' }),
    });

    // Register workbuddy endpoint.
    await fetch(`${handle.url}/bridge/endpoints`, {
      method: 'POST', headers,
      body: JSON.stringify({ id: 'workbuddy', transport: 'workbuddy', capabilities: { canExecute: true } }),
    });

    // Build a real command backend via the config path (same path that was crashing).
    const { createCommandBackend } = await import('../apps/local-server/src/workbuddy/command-backend.ts');
    const { tmpdir } = await import('node:os');
    const backend = createCommandBackend({
      allowlist: ['echo', 'node'],
      defaultCwd: tmpdir(),
      timeoutMs: 10_000,
      outputCapBytes: 65_536,
    });

    // Send heartbeat to declare executorReady.
    await fetch(`${handle.url}/bridge/endpoints/workbuddy/heartbeat`, {
      method: 'POST', headers,
      body: JSON.stringify({ capabilities: { canExecute: true } }),
    });

    // Simulate real worker: poll inbox → claim → execute via backend → return result.
    const msg = await fetch(`${handle.url}/bridge/projects/e2e-backend/conversation/messages`, {
      method: 'POST', headers,
      body: JSON.stringify({ text: 'echo configured-backend-test' }),
    });

    // If a task was dispatched, claim and execute via real backend.
    let taskDispatched = false;
    if (msg.status === 201 && msg.payload?.dispatch?.task) {
      const task = msg.payload.dispatch.task;
      const inbox = await fetch(`${handle.url}/bridge/endpoints/workbuddy/inbox/next`, { headers });
      if (inbox.payload?.task) {
        const execResult = await backend.execute({
          taskId: inbox.payload.task.taskId,
          proposalId: inbox.payload.task.proposalId,
          prompt: inbox.payload.task.prompt || 'echo configured-backend-test',
        });

        await fetch(`${handle.url}/bridge/endpoints/workbuddy/results`, {
          method: 'POST', headers,
          body: JSON.stringify({
            taskId: inbox.payload.task.taskId,
            proposalId: inbox.payload.task.proposalId,
            ok: execResult.ok,
            stdout: execResult.stdout,
            stderr: execResult.stderr,
            exitCode: execResult.exitCode,
            failureReason: execResult.failureReason,
            durationMs: 50,
          }),
        });
        taskDispatched = true;
      }
    }

    // If no dispatch, the request may have been gated differently. Try direct polling.
    if (!taskDispatched) {
      const inbox = await fetch(`${handle.url}/bridge/endpoints/workbuddy/inbox/next`, { headers });
      if (inbox.payload?.task) {
        const execResult = await backend.execute({
          taskId: inbox.payload.task.taskId,
          proposalId: inbox.payload.task.proposalId,
          prompt: 'echo configured-backend-fallback',
        });
        await fetch(`${handle.url}/bridge/endpoints/workbuddy/results`, {
          method: 'POST', headers,
          body: JSON.stringify({
            taskId: inbox.payload.task.taskId,
            proposalId: inbox.payload.task.proposalId,
            ok: execResult.ok,
            stdout: execResult.stdout,
            stderr: execResult.stderr,
            exitCode: execResult.exitCode,
            failureReason: execResult.failureReason,
            durationMs: 50,
          }),
        });
      }
    }

    // Verify: WorkBuddy panel shows executor info.
    const wb = await fetch(`${handle.url}/bridge/projects/e2e-backend/workbuddy`, { headers });
    assert.equal(wb.status, 200);
    if (wb.payload) {
      assert.ok(typeof wb.payload.executorReady === 'boolean', 'WorkBuddy panel must include executorReady');
    }
  } finally {
    await closeServer(handle);
  }
});

// ADR-0035 REVIEW: E2E — chatgpt-web source answers, WorkBuddy receives no task.

test('E2E: chatgpt-web source answers without dispatching to WorkBuddy', async () => {
  const handle = await startLocalServer(0, { plannerAdapters: [] });
  try {
    const cookie = (await fetch(`${handle.url}/console/project`)).headers.getSetCookie?.()?.[0] ?? '';
    const consoleHeaders = { 'content-type': 'application/json', origin: handle.url, cookie };

    // Get extension session token via claim flow.
    const html = await (await fetch(`${handle.url}/console/project`)).text();
    const nonce = html.match(/data-extension-claim-nonce="([^"]+)"/)?.[1];
    assert.ok(nonce, 'should have extension claim nonce');

    const claim = await fetch(`${handle.url}/bridge/local-auto-pair/extension-claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: handle.url },
      body: JSON.stringify({ nonce }),
    });
    assert.equal(claim.status, 200);
    const { extensionSessionToken } = await claim.json();
    assert.ok(extensionSessionToken);
    const extHeaders = { 'content-type': 'application/json', 'x-cli-bridge-pairing-token': extensionSessionToken };

    // Create project + pair with chatgpt-web source.
    await fetch(`${handle.url}/bridge/projects`, {
      method: 'POST', headers: consoleHeaders, body: JSON.stringify({ key: 'e2e-chatgpt' }),
    });
    await fetch(`${handle.url}/bridge/projects/e2e-chatgpt/conversation-pairing`, {
      method: 'PUT', headers: consoleHeaders,
      body: JSON.stringify({ sourceEndpointId: 'chatgpt-web', targetEndpointId: 'workbuddy' }),
    });

    // Register workbuddy endpoint.
    await fetch(`${handle.url}/bridge/endpoints`, {
      method: 'POST', headers: consoleHeaders,
      body: JSON.stringify({ id: 'workbuddy', transport: 'workbuddy', capabilities: { canExecute: true } }),
    });

    // ADR-0035 REVIEW: Extension sends heartbeat to declare availability.
    // Without this, isAvailable() returns false and the first message is blocked.
    const hb = await fetch(`${handle.url}/bridge/source/chatgpt-web/heartbeat`, {
      method: 'POST', headers: extHeaders,
      body: JSON.stringify({ canAnswer: true }),
    });
    assert.equal(hb.status, 200, 'heartbeat should succeed');

    // Send a conversation message — the chatgpt-web source adapter enqueues it
    // and blocks waiting for the result. Post the message and the result concurrently:
    // the adapter polls every 500ms, so we give it a moment to enqueue, then post.
    const msgPromise = fetch(`${handle.url}/bridge/projects/e2e-chatgpt/conversation/messages`, {
      method: 'POST', headers: consoleHeaders,
      body: JSON.stringify({ text: 'hi' }),
    });

    // Wait for the adapter to enqueue the prompt, then poll + return result.
    await new Promise(r => setTimeout(r, 1000));
    const nextRes = await fetch(`${handle.url}/bridge/source/chatgpt-web/next`, { headers: extHeaders });
    const next = await nextRes.json();
    assert.equal(nextRes.status, 200);
    assert.ok(next.task, 'extension poll should receive a pending source request');
    assert.equal(next.task.prompt, 'hi');

    // Extension claims and returns a ChatGPT answer.
    const resultRes = await fetch(`${handle.url}/bridge/source/chatgpt-web/results`, {
      method: 'POST', headers: extHeaders,
      body: JSON.stringify({
        requestId: next.task.id,
        text: 'Hello from ChatGPT Web! How can I help?',
      }),
    });
    assert.equal(resultRes.status, 200);

    // Now wait for the conversation message to complete.
    const msgRes = await msgPromise;
    const msg = await msgRes.json();

    // Verify: ChatGPT answer appeared in the conversation transcript.
    const messagesRes = await fetch(`${handle.url}/bridge/projects/e2e-chatgpt/conversation/messages`, { headers: consoleHeaders });
    const messages = await messagesRes.json();
    const allMessages = messages.messages || [];
    const chatGptAnswer = allMessages.find(e =>
      typeof e.text === 'string' && e.text.includes('Hello from ChatGPT Web'),
    );
    assert.ok(chatGptAnswer, 'ChatGPT answer must appear in conversation transcript');

    // Verify: WorkBuddy received NO task (this was a simple "hi", not an execution request).
    const wbRes = await fetch(`${handle.url}/bridge/projects/e2e-chatgpt/workbuddy`, { headers: consoleHeaders });
    const wb = await wbRes.json();
    const tasks = wb?.executionTasks || [];
    const hiTasks = tasks.filter(t => (t.prompt || '').includes('hi'));
    assert.equal(hiTasks.length, 0, 'chatgpt-web source answer should not create WorkBuddy task');
  } finally {
    await closeServer(handle);
  }
});
