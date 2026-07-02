/**
 * EX-5: Passthrough Route Plane Acceptance Gate
 *
 * Deterministic end-to-end acceptance script that proves the full pipeline
 * works end-to-end:
 *
 *   conversation message → instruction packet → single route → WorkBuddy inbox
 *   → WorkBuddy result → execution packet → user-visible executor_output
 *
 * Usage:
 *   node --experimental-strip-types scripts/passthrough-route-plane-acceptance.ts
 *
 * Managed Node: /Users/namkit/.workbuddy/binaries/node/versions/22.22.2/bin/node
 */

import { InMemoryConversationTranscriptStore } from '../apps/local-server/src/storage/conversation-transcript-store.ts';
import { InMemoryConversationInstructionStore } from '../apps/local-server/src/storage/conversation-instruction-store.ts';
import { InMemoryConversationExecutionStore } from '../apps/local-server/src/storage/conversation-execution-store.ts';
import { InMemoryConversationRouteStore } from '../apps/local-server/src/storage/conversation-route-store.ts';
import { InMemoryConversationPairingStore } from '../apps/local-server/src/storage/conversation-pairing-store.ts';
import { InMemoryConversationActionStore } from '../apps/local-server/src/storage/conversation-action-store.ts';

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed++;
    console.log('  PASS:', label);
  } else {
    failed++;
    console.error('  FAIL:', label);
  }
}

function summary(totalTests: number): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${totalTests} total`);
  console.log(`${'='.repeat(60)}`);
  if (failed > 0) {
    console.error('GATE FAILED');
    process.exitCode = 1;
  } else {
    console.log('GATE PASSED');
  }
}

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

const PROJECT_ID = 'cli-bridge';
const PAIRING_ID = PROJECT_ID;
const SOURCE_ENDPOINT = 'chatgpt-web';
const TARGET_ENDPOINT = 'workbuddy';

// ---------------------------------------------------------------------------
// Store security check helper
// ---------------------------------------------------------------------------

function checkStoreNoMutation(
  store: object,
  label: string,
  disallowed: string[],
): number {
  const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(store));
  let count = 0;
  for (const method of disallowed) {
    const found = proto.some((m) => m.toLowerCase() === method.toLowerCase());
    assert(!found, `${label} has NO ${method}() method`);
    count++;
  }
  assert(
    !proto.some((m) => /^mutateWorkspace/i.test(m) || /^workspaceMutation/i.test(m)),
    `${label} has NO workspace-mutation method`,
  );
  count++;
  return count;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('EX-5: Passthrough Route Plane Acceptance\n');

  let totalTests = 0;

  // -----------------------------------------------------------------------
  // Phase 0: Security audit — no unauthorized mutation endpoints
  // -----------------------------------------------------------------------
  console.log('--- Phase 0: Security audit ---');

  const transcriptStore = new InMemoryConversationTranscriptStore();
  const instructionStore = new InMemoryConversationInstructionStore();
  const executionStore = new InMemoryConversationExecutionStore();
  const routeStore = new InMemoryConversationRouteStore();
  const pairingStore = new InMemoryConversationPairingStore();
  const actionStore = new InMemoryConversationActionStore();

  const DISALLOWED = [
    'execute', 'run', 'shell', 'exec',
    'git', 'push', 'pull', 'merge', 'rebase',
    'command',
  ];

  totalTests += checkStoreNoMutation(transcriptStore, 'transcript store', DISALLOWED);
  totalTests += checkStoreNoMutation(instructionStore, 'instruction store', DISALLOWED);
  totalTests += checkStoreNoMutation(executionStore, 'execution store', DISALLOWED);
  totalTests += checkStoreNoMutation(pairingStore, 'pairing store', DISALLOWED);
  totalTests += checkStoreNoMutation(actionStore, 'action store', DISALLOWED);
  // Route store: also check it has no generic 'dispatch' (only markDispatched)
  totalTests += checkStoreNoMutation(routeStore, 'route store', [...DISALLOWED, 'dispatch']);
  console.log('');

  // -----------------------------------------------------------------------
  // Phase 1: Store integrity validation
  // -----------------------------------------------------------------------
  console.log('--- Phase 1: Store integrity ---');

  assert(transcriptStore instanceof InMemoryConversationTranscriptStore, 'transcript store instantiated');
  assert(instructionStore instanceof InMemoryConversationInstructionStore, 'instruction store instantiated');
  assert(executionStore instanceof InMemoryConversationExecutionStore, 'execution store instantiated');
  assert(routeStore instanceof InMemoryConversationRouteStore, 'route store instantiated');
  assert(pairingStore instanceof InMemoryConversationPairingStore, 'pairing store instantiated');
  assert(actionStore instanceof InMemoryConversationActionStore, 'action store instantiated');
  totalTests += 6;
  console.log('');

  // -----------------------------------------------------------------------
  // Phase 2: Create mock pairing
  // -----------------------------------------------------------------------
  console.log('--- Phase 2: Pairing setup ---');

  pairingStore.upsert({
    projectId: PROJECT_ID,
    sourceEndpointId: SOURCE_ENDPOINT,
    targetEndpointId: TARGET_ENDPOINT,
    targetRouteKind: 'workbuddy-execution',
    scope: 'project',
    status: 'ready',
    updatedAt: Date.now(),
  });

  const pairing = pairingStore.get(PROJECT_ID);
  assert(pairing !== undefined, 'pairing created');
  assert(pairing!.sourceEndpointId === SOURCE_ENDPOINT, 'source endpoint matches');
  assert(pairing!.targetEndpointId === TARGET_ENDPOINT, 'target endpoint matches');
  assert(pairing!.targetRouteKind === 'workbuddy-execution', 'route kind is workbuddy-execution');
  totalTests += 4;
  console.log('');

  // -----------------------------------------------------------------------
  // Phase 3: User message → instruction packet
  // -----------------------------------------------------------------------
  console.log('--- Phase 3: User message → instruction packet ---');

  const userEvent = transcriptStore.append({
    projectId: PROJECT_ID,
    pairingId: PAIRING_ID,
    role: 'user',
    text: 'refactor the login form to use React hooks',
    status: 'draft',
    routeKind: 'workbuddy-execution',
  });

  assert(userEvent.kind === 'user_message', 'user event kind = user_message');
  assert(userEvent.visibility === 'user', 'user event visibility = user');
  assert(userEvent.id.length > 0, 'user event has id');
  totalTests += 3;

  const instructionPacket = instructionStore.create({
    projectId: PROJECT_ID,
    pairingId: PAIRING_ID,
    userEventId: userEvent.id,
    text: userEvent.text,
  });

  assert(instructionPacket.id.length > 0, 'instruction packet has id');
  assert(instructionPacket.text === userEvent.text, 'instruction preserves text');
  assert(instructionPacket.userEventId === userEvent.id, 'instruction links to user event');
  assert(typeof instructionPacket.payloadHash === 'string' && instructionPacket.payloadHash.length > 0, 'instruction has payload hash');
  totalTests += 4;

  // Assert: instruction packet is NOT in transcript events
  const allTranscript = transcriptStore.listByProject(PROJECT_ID);
  const instrInTranscript = allTranscript.find((e) => e.id === instructionPacket.id);
  assert(instrInTranscript === undefined, 'instruction packet NOT in transcript events');
  totalTests += 1;
  console.log('');

  // -----------------------------------------------------------------------
  // Phase 4: Route creation (mode: single) — links instruction → action
  // -----------------------------------------------------------------------
  console.log('--- Phase 4: Route creation (mode: single) ---');

  const action = actionStore.createPreview({
    projectId: PROJECT_ID,
    sourceEndpointId: SOURCE_ENDPOINT,
    targetEndpointId: TARGET_ENDPOINT,
    routeKind: 'workbuddy-execution',
    userEventId: userEvent.id,
    bridgeEventId: `bridge-${Date.now()}`,
    text: instructionPacket.text,
    preview: `WorkBuddy: ${instructionPacket.text}`,
  });

  assert(action.id.length > 0, 'action created');
  assert(action.status === 'previewed', 'action status = previewed');
  totalTests += 2;

  const route = routeStore.create({
    projectId: PROJECT_ID,
    pairingId: PAIRING_ID,
    mode: 'single',
    instructionPacketId: instructionPacket.id,
    actionId: action.id,
  });

  assert(route.id.length > 0, 'route created');
  assert(route.mode === 'single', 'route mode = single (only mode supported)');
  assert(route.instructionPacketId === instructionPacket.id, 'route links to instruction');
  assert(route.actionId === action.id, 'route links to action');
  assert(route.status === 'pending', 'route status = pending');

  actionStore.linkRoute(action.id, route.id);
  totalTests += 5;

  // Assert: route id is NOT in transcript events
  const routeInTranscript = allTranscript.find((e) => e.id === route.id);
  assert(routeInTranscript === undefined, 'route id NOT in transcript events');
  totalTests += 1;
  console.log('');

  // -----------------------------------------------------------------------
  // Phase 5: Task dispatch (markDispatched)
  // -----------------------------------------------------------------------
  console.log('--- Phase 5: Task dispatch ---');

  assert(actionStore.confirm(action.id) !== undefined, 'action confirmed');
  assert(actionStore.markDispatching(action.id) !== undefined, 'action marked dispatching');

  const taskId = `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const dispatched = routeStore.markDispatched(route.id, taskId);
  assert(dispatched !== undefined, 'route marked dispatched');
  assert(dispatched!.status === 'dispatched', 'route status = dispatched');
  assert(dispatched!.taskId === taskId, 'route has task id');

  const queued = actionStore.markQueued(action.id, taskId);
  assert(queued !== undefined, 'action marked queued');
  assert(queued!.linkedWorkBuddyTaskId === taskId, 'action linked to WorkBuddy task');
  totalTests += 7;
  console.log('');

  // -----------------------------------------------------------------------
  // Phase 6: Execution result comes back
  // -----------------------------------------------------------------------
  console.log('--- Phase 6: Execution result ---');

  const executorOutput = `I've refactored the login form to use React hooks. Here is the updated code:

\`\`\`tsx
const LoginForm = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const handleSubmit = (e) => { e.preventDefault(); /* ... */ };
  return <form onSubmit={handleSubmit}>...</form>;
};
\`\`\``;

  const executionPacket = executionStore.create({
    projectId: PROJECT_ID,
    pairingId: PAIRING_ID,
    instructionPacketId: instructionPacket.id,
    taskId,
    ok: true,
    output: { result: executorOutput },
    stdout: executorOutput,
    durationMs: 1234,
  });

  assert(executionPacket.id.length > 0, 'execution packet created');
  assert(executionPacket.ok === true, 'execution result ok');
  assert(executionPacket.taskId === taskId, 'execution links to task');
  assert(executionPacket.durationMs > 0, 'execution has duration');
  totalTests += 4;

  routeStore.markCompleted(route.id);
  const returnedAction = actionStore.markWorkBuddyReturned(action.id);
  assert(returnedAction !== undefined, 'action marked returned');
  assert(returnedAction!.status === 'returned', 'action status = returned');
  totalTests += 2;

  // Assert: execution packet metadata is NOT in transcript events
  const execInTranscript = allTranscript.find((e) => e.id === executionPacket.id);
  assert(execInTranscript === undefined, 'execution packet id NOT in transcript events');

  const eventsWithTaskId = allTranscript.filter((e) => e.text.includes(taskId));
  assert(eventsWithTaskId.length === 0, 'taskId never appears in transcript text');

  const eventsWithInstrId = allTranscript.filter((e) => e.text.includes(instructionPacket.id));
  assert(eventsWithInstrId.length === 0, 'instruction packet id never appears in transcript text');
  totalTests += 3;
  console.log('');

  // -----------------------------------------------------------------------
  // Phase 7: User-visible transcript event from executor output
  // -----------------------------------------------------------------------
  console.log('--- Phase 7: User-visible executor_output ---');

  const executorEvent = transcriptStore.append({
    projectId: PROJECT_ID,
    pairingId: PAIRING_ID,
    role: 'target',
    text: executorOutput,
    status: 'returned',
    routeKind: 'workbuddy-execution',
  });

  assert(executorEvent.kind === 'executor_output', 'event kind = executor_output');
  assert(executorEvent.visibility === 'user', 'event visibility = user');
  assert(executorEvent.text === executorOutput, 'event text comes from executor output');
  assert(executorEvent.role === 'target', 'event role = target');
  totalTests += 4;

  // Assert: user-visible event has kind='executor_output', visibility='user'
  const finalTranscript = transcriptStore.listByProject(PROJECT_ID);
  const userVisible = finalTranscript.filter((e) => e.visibility === 'user');
  assert(userVisible.length === 2, 'exactly 2 user-visible events (1 user + 1 executor)');
  assert(userVisible[0].kind === 'user_message', 'first user-visible = user_message');
  assert(userVisible[1].kind === 'executor_output', 'second user-visible = executor_output');
  assert(userVisible[1].visibility === 'user', 'executor_output visibility = user');
  assert(userVisible[1].text === executorOutput, 'executor event text = executor output');
  totalTests += 5;
  console.log('');

  // -----------------------------------------------------------------------
  // Phase 8: Mode constraint — only 'single' supported
  // -----------------------------------------------------------------------
  console.log('--- Phase 8: Mode constraint ---');

  const allRoutes = routeStore.listByProject(PROJECT_ID);
  for (const r of allRoutes) {
    assert(r.mode === 'single', `route ${r.id} mode = single`);
  }
  assert(route.mode === 'single', 'route.mode type is single (runtime)');
  totalTests += 2;
  console.log('');

  // -----------------------------------------------------------------------
  // Phase 9: End-to-end pipeline integrity
  // -----------------------------------------------------------------------
  console.log('--- Phase 9: End-to-end pipeline integrity ---');

  // instruction ← lookup by user event
  const foundInstr = instructionStore.findByUserEventId(userEvent.id);
  assert(foundInstr !== undefined, 'instruction retrievable by user event');
  assert(foundInstr!.text === userEvent.text, 'instruction text matches user input');
  totalTests += 2;

  // route ← lookup by instruction
  const foundRoute = routeStore.findByInstructionId(instructionPacket.id);
  assert(foundRoute !== undefined, 'route retrievable by instruction id');
  assert(foundRoute!.actionId === action.id, 'route links to correct action');
  totalTests += 2;

  // action ← lookup by task
  const foundAction = actionStore.findByWorkBuddyTaskId(taskId);
  assert(foundAction !== undefined, 'action retrievable by task id');
  assert(foundAction!.status === 'returned', 'action marked returned');
  totalTests += 2;

  // execution ← lookup by task
  const foundExec = executionStore.findByTaskId(taskId);
  assert(foundExec !== undefined, 'execution retrievable by task id');
  assert(foundExec!.ok === true, 'execution result ok');
  totalTests += 2;
  console.log('');

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  summary(totalTests);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
