import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  BRIDGE_PACKETS_PATH,
  BRIDGE_PROJECTS_PATH,
  createBridgeRuntime,
  handleBridgeRequest,
} from '../apps/local-server/src/routes/bridge-api.ts';
import { createMetricsSummary } from '../apps/local-server/src/storage/metrics-summary.ts';
import { SNAPSHOT_FILENAME, JsonSnapshotStore, buildSnapshot } from '../apps/local-server/src/storage/json-snapshot-store.ts';

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

test('runtime persists web relay loops and fails uncertain submitted rounds after restart', () => {
  const dir = tempDir();
  try {
    const first = createBridgeRuntime({ dataDir: dir });
    const created = first.webRelayLoopStore.create({
      projectId: 'cli-bridge',
      goalId: 'goal-stage-c',
      sessionId: 'loop-session',
      endpointId: 'mock-inbound-agent',
      initialPrompt: 'round one prompt',
      now: 1000,
    });
    assert.equal(created.error, undefined);
    const claimed = first.outboundPromptStore.claimNext(2000);
    assert.equal(claimed.id, created.outboundPrompt.id);
    first.outboundPromptStore.acknowledge({
      id: created.outboundPrompt.id,
      claimToken: claimed.claimToken,
      ok: true,
      now: 2001,
    });
    first.outboundPromptStore.markSubmitted(created.outboundPrompt.id, 2002);
    first.persist();

    const second = createBridgeRuntime({ dataDir: dir });
    const restoredLoop = second.webRelayLoopStore.get(created.loop.id);
    const restoredPrompt = second.outboundPromptStore.getPrompt(created.outboundPrompt.id);
    assert.equal(restoredLoop.status, 'failed');
    assert.equal(restoredLoop.failureReason, 'restart-uncertain-submission');
    assert.equal(restoredPrompt.status, 'failed');
    assert.equal(restoredPrompt.failureReason, 'restart-uncertain-submission');
    assert.equal(second.webRelayLoopStore.list().length, 1);

    const snapshotText = readFileSync(resolve(dir, SNAPSHOT_FILENAME), 'utf8');
    assert.match(snapshotText, /"webRelayLoops"/);
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

test('snapshot writes atomically, keeps a backup, and leaves no temporary file', () => {
  const dir = tempDir();
  try {
    const store = new JsonSnapshotStore(dir);
    const first = buildSnapshot({ packets: [], auditEvents: [], pendingPrompts: [] });
    const second = buildSnapshot({
      packets: [],
      auditEvents: [],
      pendingPrompts: [],
      projects: [{ key: 'second', label: 'Second', createdAt: 2 }],
    });
    assert.equal(store.write(first).ok, true);
    assert.equal(store.write(second).ok, true);
    assert.equal(existsSync(resolve(dir, 'bridge-snapshot.json.tmp')), false);
    assert.equal(existsSync(resolve(dir, 'bridge-snapshot.json.bak')), true);
    assert.equal(store.read().snapshot.projects[0].key, 'second');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('snapshot read recovers a corrupt primary from backup and fails when both are corrupt', () => {
  const dir = tempDir();
  try {
    const store = new JsonSnapshotStore(dir);
    const first = buildSnapshot({
      packets: [],
      auditEvents: [],
      pendingPrompts: [],
      projects: [{ key: 'backup', label: 'Backup', createdAt: 1 }],
    });
    const second = buildSnapshot({
      packets: [],
      auditEvents: [],
      pendingPrompts: [],
      projects: [{ key: 'primary', label: 'Primary', createdAt: 2 }],
    });
    store.write(first);
    store.write(second);

    writeFileSync(resolve(dir, SNAPSHOT_FILENAME), '{broken', 'utf8');
    const recovered = store.read();
    assert.equal(recovered.ok, true);
    assert.equal(recovered.recoveredFromBackup, true);
    assert.equal(recovered.snapshot.projects[0].key, 'backup');

    writeFileSync(resolve(dir, 'bridge-snapshot.json.bak'), '{also-broken', 'utf8');
    const failed = store.read();
    assert.equal(failed.ok, false);
    assert.match(failed.error, /snapshot-corrupt/i);
    assert.throws(() => createBridgeRuntime({ dataDir: dir }), /snapshot-corrupt/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('snapshot read fails closed for a non-missing filesystem error', () => {
  const dir = tempDir();
  try {
    mkdirSync(resolve(dir, SNAPSHOT_FILENAME));

    const read = new JsonSnapshotStore(dir).read();
    assert.equal(read.ok, false);
    assert.match(read.error, /snapshot-read-failed/i);
    assert.throws(() => createBridgeRuntime({ dataDir: dir }), /snapshot-read-failed/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('snapshot read rejects an unsupported future schema version', () => {
  const dir = tempDir();
  try {
    const snapshot = buildSnapshot({ packets: [], auditEvents: [], pendingPrompts: [] });
    writeFileSync(
      resolve(dir, SNAPSHOT_FILENAME),
      JSON.stringify({ ...snapshot, version: 999 }),
      'utf8',
    );

    const read = new JsonSnapshotStore(dir).read();
    assert.equal(read.ok, false);
    assert.match(read.error, /snapshot-unsupported-version/i);
    assert.throws(() => createBridgeRuntime({ dataDir: dir }), /snapshot-unsupported-version/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runtime persistence surfaces snapshot write failure', () => {
  const dataPath = tempDir();
  try {
    const runtime = createBridgeRuntime({ dataDir: dataPath });
    mkdirSync(resolve(dataPath, 'bridge-snapshot.json.tmp'));
    assert.throws(() => runtime.persist(), /snapshot write failed/i);
  } finally {
    rmSync(dataPath, { recursive: true, force: true });
  }
});

test('runtime enters a persistence fault state instead of exposing ghost mutations', async () => {
  const dir = tempDir();
  try {
    const runtime = createBridgeRuntime({ dataDir: dir });
    runtime.packetStore.createPacket({
      sessionId: 'ghost',
      source: 'codex',
      target: 'chatgpt-web',
      kind: 'cli-output-review',
      rawContent: 'must not remain observable',
    });
    mkdirSync(resolve(dir, 'bridge-snapshot.json.tmp'));

    assert.throws(() => runtime.persist(), /snapshot write failed/i);
    const result = await handleBridgeRequest(runtime, 'GET', BRIDGE_PACKETS_PATH, null);
    assert.equal(result.statusCode, 503);
    assert.match(result.payload.message, /persistence fault/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('inbound messages and relay context persist across restarts', () => {
  const dir = tempDir();
  try {
    const first = createBridgeRuntime({
      dataDir: dir,
      inboundRelayEndpointId: 'mock-inbound-agent',
    });
    first.relayContextStore.bind('s-return', 'mock-inbound-agent', 1);
    first.relayContextStore.recordDelivered('s-return', 'mock-inbound-agent', 'out-1', 2);
    const created = first.inboundMessageStore.createIdempotent({
      endpointId: 'mock-inbound-agent',
      sessionId: 's-return',
      content: 'reviewed reply',
      source: 'chatgpt-web-extract',
      sourceOutboundPromptId: 'out-1',
      now: 3,
    });
    first.persist();

    const second = createBridgeRuntime({
      dataDir: dir,
      inboundRelayEndpointId: 'mock-inbound-agent',
    });
    assert.equal(second.inboundMessageStore.list().length, 1);
    assert.equal(second.inboundMessageStore.list()[0].id, created.message.id);
    assert.equal(second.relayContextStore.getRelayContext('s-return').lastOutboundPromptId, 'out-1');
    const replay = second.inboundMessageStore.createIdempotent({
      endpointId: 'mock-inbound-agent',
      sessionId: 's-return',
      content: 'reviewed reply',
      source: 'chatgpt-web-extract',
      sourceOutboundPromptId: 'out-1',
      now: 4,
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.message.id, created.message.id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runtime rejects structurally invalid snapshot records instead of skipping them', () => {
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

    assert.throws(
      () => createBridgeRuntime({ dataDir: dir }),
      /snapshot-(invalid-record|corrupt)/i,
    );
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

test('ADR-0014: project workspace roots are runtime config and never persisted to snapshot', () => {
  const dir = tempDir();
  const rootParent = tempDir();
  const root = resolve(rootParent, 'alpha-root');
  try {
    const runtime = createBridgeRuntime({
      dataDir: dir,
      projectWorkspaceRoots: { alpha: root },
    });
    runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha' });
    runtime.persist();

    const snapshotText = readFileSync(resolve(dir, SNAPSHOT_FILENAME), 'utf8');
    assert.equal(snapshotText.includes(root), false, 'absolute project root must not be persisted');
    assert.equal(snapshotText.includes('projectWorkspaceRoots'), false, 'root registry must not be persisted');

    const restored = createBridgeRuntime({ dataDir: dir });
    const project = restored.projectStore.get('alpha');
    assert.ok(project);
    assert.equal(project.workspaceRoot, undefined);
    assert.equal(project.baselineRoot, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(rootParent, { recursive: true, force: true });
  }
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

// v2.13: verificationRunRecords survive write/read cycle
test('v2.13: verificationRunRecords round-trip through snapshot', () => {
  const dir = tempDir();
  const store = new JsonSnapshotStore(dir);
  const run = {
    projectKey: 'alpha', profileId: 'unit-tests', commandLabel: 'Unit tests',
    result: 'passed', recordedAt: 1, elapsedMs: 42, truncated: false, outputDiscarded: true,
  };
  const input = {
    packets: [], auditEvents: [], pendingPrompts: [], outboundPrompts: [],
    goals: [], plans: [], projects: [{ key: 'alpha', label: 'Alpha', createdAt: 1 }],
    workbuddyTaskReferences: [], workbuddyReviewResultSinks: [],
    workbuddyPromptDraftSinks: [], workbuddyExecutionLedgerEvents: [],
    teams: [], teamArtifacts: [],
    verificationRunRecords: [run],
  };
  assert.ok(store.write(buildSnapshot(input)).ok, 'write ok');
  const snap = store.read().snapshot;
  assert.ok(snap, 'snapshot exists');
  assert.equal(Array.isArray(snap.verificationRunRecords), true);
  assert.equal(snap.verificationRunRecords.length, 1);
  assert.equal(snap.verificationRunRecords[0].profileId, 'unit-tests');
  assert.equal(snap.verificationRunRecords[0].result, 'passed');
  rmSync(dir, { recursive: true, force: true });
});
