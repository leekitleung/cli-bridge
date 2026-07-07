# Blocking Issues - P0/P1/P2

## P0 - Critical (Must Fix Before Production)

### P0-1: Inconsistent Authentication Enforcement

**File:** `apps/local-server/src/routes/bridge-api.ts`  
**Lines:** ~2604-5484 (entire `handleBridgeRequest` function)

**Issue:**
The `authContext` parameter is optional throughout `handleBridgeRequest()`, and most routes do not enforce authentication. Only specific routes (team actions, plan accept/reject, automation loops) check `authContext?.kind`. This creates a large attack surface where unauthenticated requests can mutate state.

**Proof:**
```typescript
// Line 4170: Team actions require auth
if (authContext?.kind !== 'console-cookie') {
  return error(403, 'Conversation action confirmation requires local Console session');
}

// But line 4069 (conversation/messages POST) has NO auth check
if (method === 'POST') {
  // ... can create conversation actions without auth
}
```

**Attack Scenario:**
1. Attacker sends POST to `/bridge/projects/default/conversation/messages` with malicious content
2. Creates conversation transcript entries, triggers planner execution
3. Can cause WorkBuddy to execute arbitrary tasks

**Fix Required:**
Add authentication check at the start of `handleBridgeRequest()` and use route-level decorators/exceptions for public endpoints.

---

### P0-2: Race Condition in Goal/Plan State Transitions

**File:** `apps/local-server/src/goal/goal-automation-loop.ts`  
**Lines:** 147-269 (`tickGoalLoop` function)

**Issue:**
Multiple concurrent calls to `tickGoalLoop()` can corrupt goal/plan state without synchronization. The function reads goal state, advances it, and writes back - between read and write, another call could modify the state.

**Proof:**
```typescript
export function tickGoalLoop(
  runtime: BridgeRuntime,
  loopId: string,
  options: {...},
): GoalTickResult {
  // READ: No lock held
  const goal = runtime.goalStore.getGoal(goalId);  // Line 169
  const plan = runtime.goalStore.getPlanByGoal(goalId);  // Line 174
  
  // PROCESS: State can change here
  const advanceResult = orchestrator.advance(goalId);  // Line 197
  
  // WRITE: Another concurrent call could have modified state
  runtime.goalStore.completeStep(goal.id, stepId, ...);  // Line 298
}
```

**Attack Scenario:**
1. Two concurrent requests to tick the same loop
2. Both read goal at "step-1 pending"
3. Both advance, creating two "step-2" executions
4. State machine corrupted, double-execution occurs

**Fix Required:**
Add mutex/lock around goal state transitions, or use optimistic locking with version numbers.

---

### P0-3: Unrestricted `workingDirectory` in Executor

**File:** `apps/local-server/src/execution/opencode-executor.ts`  
**Lines:** 85-96

**Issue:**
The `workingDirectory` is passed directly to `spawn()` without validation. While `shell: false` prevents command injection, path traversal could allow execution in arbitrary directories.

**Proof:**
```typescript
const workingDir = task.workingDirectory ?? this.options.workingDirectory;

const proc = spawn(this.options.openCodePath, args, {
  cwd: workingDir,  // No validation
  env: { ...process.env },  // Full environment passed
  shell: false,
});
```

**Attack Scenario:**
1. Attacker crafts task with `workingDirectory: "../../root"`
2. WorkBuddy/Codex executes in `/root` directory
3. Could access sensitive system files

**Fix Required:**
Validate `workingDirectory` stays within allowed project workspace roots.

---

## P1 - High Priority (Fix Within Sprint)

### P1-1: `rawProviderOutput` Stored Without Redaction

**File:** `apps/local-server/src/routes/bridge-api.ts`  
**Lines:** 901-903

**Issue:**
The `rawProviderOutput` field is stored in artifacts without passing through `redactSensitiveContent()`.

**Proof:**
```typescript
// Line 901-903
if (body.rawProviderOutput !== undefined && typeof body.rawProviderOutput === 'string') {
  artifact.rawProviderOutput = body.rawProviderOutput;  // No redaction!
}
```

**Attack Scenario:**
1. User sends artifact with `rawProviderOutput` containing `sk-...` API key
2. Key stored in artifact, accessible via API
3. Leak persists until snapshot is cleared

**Fix Required:**
Apply redaction before storage:
```typescript
artifact.rawProviderOutput = redactSensitiveContent(body.rawProviderOutput).processedContent;
```

---

### P1-2: Timer Memory Leak in ChatGPT Web Source

**File:** `apps/local-server/src/routes/bridge-api.ts`  
**Lines:** 1867-1896

**Issue:**
`setTimeout()` created in `scheduleChatGptWebSourceTimeout()` is never cleaned up if the request completes before timeout.

**Proof:**
```typescript
function scheduleChatGptWebSourceTimeout(
  runtime: BridgeRuntime,
  input: {...},
): void {
  const timer = setTimeout(() => {
    // ... timeout logic
  }, runtime.chatGptWebSourceResultTimeoutMs);
  timer.unref?.();  // Only prevents process exit, not cleanup
}
```

**Attack Scenario:**
1. Attacker sends many requests that complete quickly
2. Timers accumulate in Node.js timer heap
3. Memory grows until process restart

**Fix Required:**
Track timers in a Map and clear them when request completes or fails.

---

### P1-3: GitHub Token Appears in Audit Metadata

**File:** `apps/local-server/src/routes/bridge-api.ts`  
**Lines:** 1396-1409

**Issue:**
GitHub checks result includes metadata that could be sensitive, and the token is used for the API call.

**Proof:**
```typescript
runtime.verificationRunStore.add(projectKey, {
  projectKey,
  profileId: 'github-checks',
  commandLabel: 'github-checks',
  result: result.view.result,  // Could include sensitive details
  recordedAt: result.view.fetchedAt,
  // ...
  outputDiscarded: true,  // But result might not be fully redacted
});
```

**Fix Required:**
Ensure `result.view.result` is fully redacted before storage.

---

## P2 - Medium Priority (Fix in Next Release)

### P2-1: Async Adapter Call Not Wrapped in Try/Catch

**File:** `apps/local-server/src/routes/bridge-api.ts`  
**Lines:** 3981-3994

**Issue:**
The `sourceAdapter.plan()` call can throw an exception that is caught by the outer try/catch, but the outer catch at line 3990 only handles the error message, not potential async rejection issues.

**Proof:**
```typescript
try {
  if (localEnvelope) {
    envelope = localEnvelope;
  } else {
    const planPromise = sourceAdapter!.plan({...});
    envelope = await planPromise;  // Could reject
  }
} catch (err) {
  const errMsg = String(err);
  return error(500, `Source error: ${errMsg}`);
}
```

**Fix Required:**
The current implementation is mostly correct, but should add explicit rejection handling:
```typescript
try {
  envelope = await Promise.race([
    sourceAdapter.plan(...),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Source adapter timeout')), 15000))
  ]);
} catch (err) { ... }
```

---

### P2-2: Rate Limiter Entries Never Cleaned During High Load

**File:** `apps/local-server/src/security/rate-limiter.ts`  
**Lines:** 28-32

**Issue:**
Cleanup interval is 60 seconds, but under high load with many unique IPs, the entries Map could grow large before cleanup runs.

**Proof:**
```typescript
constructor(config: RateLimitConfig) {
  this.config = config;
  this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);  // 1 minute
}
```

**Fix Required:**
Reduce cleanup interval or add size-based eviction.

---

### P2-3: Session Store Cleanup Uses Non-Atomic Iteration

**File:** `apps/local-server/src/security/local-auto-pair-session.ts`  
**Lines:** 68-88

**Issue:**
The cleanup interval iterates over Maps while other operations might be modifying them.

**Proof:**
```typescript
const cleanupInterval = setInterval(() => {
  let cleaned = 0;
  const cutoff = now() - sessionTtlMs;
  for (const [key, record] of byConsole.entries()) {  // Could race
    if (record.expiresAt < cutoff && !isActive(record)) {
      byConsole.delete(key);
      // ...
    }
  }
}, CLEANUP_INTERVAL_MS);
```

**Fix Required:**
Use a dedicated cleanup lock or copy entries before iteration.

---

## Summary Table

| ID | Severity | Category | Fix Effort |
|----|----------|----------|------------|
| P0-1 | Critical | Auth | High |
| P0-2 | Critical | Concurrency | High |
| P0-3 | Critical | Path Traversal | Medium |
| P1-1 | High | Data Leak | Low |
| P1-2 | High | Memory Leak | Medium |
| P1-3 | High | Data Leak | Low |
| P2-1 | Medium | Error Handling | Low |
| P2-2 | Medium | Resource | Low |
| P2-3 | Medium | Concurrency | Medium |
