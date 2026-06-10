import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  BRIDGE_PROJECTS_PATH,
  createBridgeRuntime,
} from '../apps/local-server/src/routes/bridge-api.ts';
import { createMetricsSummary } from '../apps/local-server/src/storage/metrics-summary.ts';
import { SNAPSHOT_FILENAME } from '../apps/local-server/src/storage/json-snapshot-store.ts';

function tempDir() {
  return mkdtempSync(resolve(tmpdir(), 'cli-bridge-test-'));
}

test('runtime persists and rehydrates packets, audit, and pending prompts across restarts', () => {
  const dir = tempDir();
  try {
    const first = createBridgeRuntime({ dataDir: dir });
    const packet = first.packetStore.createPacket({
      sessionId: 's1',
      source: 'codex',
      target: 'chatgpt-web',
      kind: 'cli-output-review',
      rawContent: 'OPENAI=sk-abcdefghijklmnopqrstuvwxyz123456 output',
    });
    first.persist();
    const prompt = first.pendingPromptStore.createPendingPrompt({
      sessionId: 's1',
      prompt: 'next step',
      source: 'chatgpt-web',
      transport: 'clipboard',
    });
    first.persist();

    // New runtime from the same dir simulates a server restart.
    const second = createBridgeRuntime({ dataDir: dir });
    const packets = second.packetStore.listPackets();
    const prompts = second.pendingPromptStore.listPrompts();

    // createPendingPrompt also creates a backing packet, so two packets exist:
    // the explicit one plus the prompt's packet.
    assert.equal(packets.length, 2);
    assert.equal(packets.some((p) => p.id === packet.id), true);
    const restoredPacket = packets.find((p) => p.id === packet.id);
    assert.match(restoredPacket.processedContent, /\[REDACTED_OPENAI_KEY\]/);
    assert.equal(prompts.some((p) => p.id === prompt.id), true);
    assert.ok(second.auditLog.listEvents().length >= 1);

    const metrics = createMetricsSummary({
      packetStore: second.packetStore,
      auditLog: second.auditLog,
      pendingPromptStore: second.pendingPromptStore,
    });
    assert.ok(metrics.packetCreatedCount >= 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('snapshot file never contains raw secret content', () => {
  const dir = tempDir();
  try {
    const runtime = createBridgeRuntime({ dataDir: dir });
    runtime.packetStore.createPacket({
      sessionId: 's1',
      source: 'codex',
      target: 'chatgpt-web',
      kind: 'cli-output-review',
      rawContent: 'GITHUB=ghp_abcdefghijklmnopqrstuvwxyz123456 some output',
    });
    runtime.persist();

    const snapshotText = readFileSync(resolve(dir, SNAPSHOT_FILENAME), 'utf8');
    // The raw secret token must be redacted before persistence.
    assert.equal(snapshotText.includes('ghp_abcdefghijklmnopqrstuvwxyz123456'), false);
    assert.match(snapshotText, /\[REDACTED_GITHUB_TOKEN\]/);
    // No rawContentRef-backed raw content map is serialized.
    assert.equal(snapshotText.includes('"rawContents"'), false);
    assert.equal(snapshotText.includes('"rawContent"'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runtime stays in-memory and writes nothing when no data dir is configured', () => {
  const runtime = createBridgeRuntime();
  runtime.packetStore.createPacket({
    sessionId: 's1',
    source: 'codex',
    target: 'chatgpt-web',
    kind: 'cli-output-review',
    rawContent: 'hello',
  });
  // persist() is a no-op without a data dir; must not throw.
  assert.doesNotThrow(() => runtime.persist());
  assert.equal(runtime.packetStore.listPackets().length, 1);
});

test('hydration skips invalid records without throwing', () => {
  const dir = tempDir();
  try {
    // Write a hand-crafted snapshot with one valid and one invalid packet.
    const runtime = createBridgeRuntime({ dataDir: dir });
    runtime.packetStore.createPacket({
      sessionId: 's1',
      source: 'codex',
      target: 'chatgpt-web',
      kind: 'cli-output-review',
      rawContent: 'valid',
    });
    runtime.persist();

    const path = resolve(dir, SNAPSHOT_FILENAME);
    const snapshot = JSON.parse(readFileSync(path, 'utf8'));
    snapshot.packets.push({ id: 'broken', notAPacket: true });
    snapshot.auditEvents.push({ bogus: 'event' });
    writeFileSync(path, JSON.stringify(snapshot), 'utf8');

    const restored = createBridgeRuntime({ dataDir: dir });
    // Only the one valid packet survives; the broken one is skipped.
    assert.equal(restored.packetStore.listPackets().length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════
// Phase B closeout — snapshot persistence regression
// ════════════════════════════════════════════════════════════════════

test('project metadata persists and rehydrates across restarts', () => {
  const dir = tempDir();
  let runtime1 = createBridgeRuntime({ dataDir: dir });
  runtime1.projectStore.upsert({ key: 'alpha', label: 'Alpha', description: 'Test project' });
  runtime1.persist();

  let runtime2 = createBridgeRuntime({ dataDir: dir });
  const project = runtime2.projectStore.get('alpha');
  assert.ok(project, 'project must persist across restart');
  assert.equal(project.label, 'Alpha');
  assert.equal(project.description, 'Test project');
  rmSync(dir, { recursive: true, force: true });
});

test('project archivedAt persists and rehydrates across restarts', () => {
  const dir = tempDir();
  let runtime1 = createBridgeRuntime({ dataDir: dir });
  runtime1.projectStore.upsert({ key: 'alpha', label: 'Alpha' });
  runtime1.projectStore.archive('alpha');
  runtime1.persist();

  let runtime2 = createBridgeRuntime({ dataDir: dir });
  const project = runtime2.projectStore.get('alpha');
  assert.ok(project, 'archived project must persist');
  assert.equal(typeof project.archivedAt, 'number');
  rmSync(dir, { recursive: true, force: true });
});

test('AuditEvent.projectId persists and rehydrates across restarts', () => {
  const dir = tempDir();
  let runtime1 = createBridgeRuntime({ dataDir: dir });
  runtime1.pendingPromptStore.createPendingPrompt({
    sessionId: 's1', prompt: 'test', source: 'chatgpt-web',
    transport: 'clipboard', projectId: 'alpha',
  });
  runtime1.persist();

  let runtime2 = createBridgeRuntime({ dataDir: dir });
  const events = runtime2.auditLog.listEvents();
  const promptEvent = events.find(e => e.type === 'create_pending_prompt');
  assert.ok(promptEvent, 'audit event must persist');
  assert.equal(promptEvent.projectId, 'alpha', 'projectId must survive round-trip');
  rmSync(dir, { recursive: true, force: true });
});

test('legacy audit event without projectId hydrates and appears via endpoint packetId fallback', async () => {
  const dir = tempDir();
  const legacyEvent = {
    id: 'legacy-1', sessionId: 's1', packetId: 'pkt-legacy',
    type: 'create_pending_prompt', source: 'cli', target: 'agent',
    result: { ok: true }, timestamp: 1, snapshot: {}, safety: {},
  };
  const snapshot = {
    version: 2,
    packets: [{ id: 'pkt-legacy', sessionId: 's1', source: 'cli', target: 'agent',
      kind: 'cli-message', rawContent: '', safety: { contentHash: '' },
      persistedAt: 1 }],
    auditEvents: [legacyEvent],
    pendingPrompts: [{ id: 'prompt-legacy', sessionId: 's1', packetId: 'pkt-legacy',
      source: 'cli', prompt: 'legacy', transport: 'clipboard', status: 'confirmed',
      projectId: 'alpha', createdAt: 1, updatedAt: 1 }],
    outboundPrompts: [],
    goals: [],
    plans: [],
    projects: [{ key: 'alpha', label: 'Alpha', createdAt: 1 }],
  };
  writeFileSync(resolve(dir, 'bridge-snapshot.json'), JSON.stringify(snapshot));
  const runtime = createBridgeRuntime({ dataDir: dir });

  const events = runtime.auditLog.listEvents();
  const legacy = events.find(e => e.id === 'legacy-1');
  assert.ok(legacy, 'legacy event must hydrate');
  assert.equal(legacy.projectId, undefined, 'legacy event must have no projectId');

  // Endpoint-level: the legacy event should appear in alpha detail
  // via packetId fallback even though it lacks a projectId.
  const { handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const detail = await handleBridgeRequest(runtime, 'GET', `${BRIDGE_PROJECTS_PATH}/alpha`, {});
  assert.equal(detail.statusCode, 200);
  assert.ok(detail.payload.auditEvents.some(e => e.id === 'legacy-1'),
    'legacy audit event without projectId must appear via packetId fallback');
  rmSync(dir, { recursive: true, force: true });
});
