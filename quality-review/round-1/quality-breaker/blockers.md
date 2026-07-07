# Quality Breaker Review - Blockers (P0/P1)

## P0 Issues - STOP SHIP

These issues are critical security vulnerabilities or stability risks that would cause production incidents.

---

### P0-1: Race Condition in ChatGPT Web Queue ClaimNext

**Severity**: P0 - Race Condition / Data Corruption
**File**: `apps/local-server/src/conversation/chatgpt-web-source-adapter.ts`
**Lines**: 151-157

**Issue**:
```typescript
claimNext(): ChatGptSourceRequest | undefined {
  for (const req of this.requests.values()) {
    if (req.status !== 'pending') continue;
    return this.claim(req.id);  // <-- NOT ATOMIC
  }
  return undefined;
}
```

**Problem**: The `claimNext()` method is NOT atomic. Between iterating to find a pending request and calling `claim()`, another caller can claim the same request. This allows two concurrent callers to receive the same request.

**Exploit Scenario**:
1. Extension A polls `/next`
2. Extension B polls `/next` at same time
3. Both receive the same `chatgpt-src-xxx` request
4. Both execute the same ChatGPT prompt
5. Both submit results, first one wins, second one returns undefined

**Impact**:
- Duplicate ChatGPT executions (wasted API calls/money)
- Race condition causing intermittent failures
- Non-deterministic behavior

**Fix Required**: Make `claimNext()` atomic using compare-and-swap pattern:
```typescript
claimNext(): ChatGptSourceRequest | undefined {
  for (const req of this.requests.values()) {
    if (req.status !== 'pending') continue;
    const prev = this.requests.get(req.id);
    if (prev && prev.status === 'pending') {
      req.status = 'claimed';
      req.claimedAt = Date.now();
      return clone(req);
    }
  }
  return undefined;
}
```

---

### P0-2: Snapshot Hydration Fails Open

**Severity**: P0 - Data Integrity / Silent Corruption
**File**: `apps/local-server/src/routes/bridge-api.ts`
**Lines**: 1667-1735

**Issue**:
```typescript
for (const project of read.snapshot.projects ?? []) {
  projectStore.hydrateProject(project);
}
// ... similar for all other stores
for (const goal of read.snapshot.goals ?? []) {
  goalStore.hydrateGoal(goal);  // Silent failure
}
```

**Problem**: Individual hydration failures are silently ignored with empty catch blocks. This means:
1. Corrupt snapshot data is silently accepted
2. Missing required fields are not validated
3. Invalid state can be restored

**Exploit Scenario**:
1. Snapshot partially written (crash during write)
2. Next startup: corrupt data loaded
3. System operates on invalid state
4. Operations fail in unpredictable ways

**Impact**:
- Silent data corruption
- Inconsistent state across stores
- Impossible to debug production issues

**Fix Required**: Fail-closed hydration with validation:
```typescript
for (const project of read.snapshot.projects ?? []) {
  try {
    const result = projectStore.hydrateProject(project);
    if (!result.ok) {
      throw new Error(`Invalid project: ${result.error}`);
    }
  } catch (err) {
    throw new Error(`Failed to hydrate project ${project.key}: ${err.message}`);
  }
}
```

---

### P0-3: Bridge Timeout Not Cleared on Normal Completion

**Severity**: P0 - Memory Leak / Side Effects
**File**: `apps/local-server/src/server.ts`
**Lines**: 370-391

**Issue**:
```typescript
const BRIDGE_REQUEST_TIMEOUT_MS = 120_000;
const bridgeTimeout = setTimeout(() => {
  if (!response.headersSent) {
    writeJson(504, ...);
  }
}, BRIDGE_REQUEST_TIMEOUT_MS);

handleBridgeRequest(...).then((result) => {
  clearTimeout(bridgeTimeout);  // Only cleared in success path
  // ...
}).catch((err) => {
  clearTimeout(bridgeTimeout);  // Cleared in catch
  // ...
});
```

**Problem**: `bridgeTimeout` is cleared only in `.then()` and `.catch()`. If the response is already sent (e.g., `headersSent` is true), the timeout fires after completion and calls `request.destroy()` on a completed request.

**Impact**:
- Timeout callback fires on completed requests
- Potential memory corruption
- Intermittent crashes after responses sent

**Fix Required**:
```typescript
clearTimeout(requestTimeout);
clearTimeout(bridgeTimeout);
writeBridgeResult(result, response);
```

---

### P0-4: Missing Error Handling in Async Request Handler

**Severity**: P0 - Unhandled Promise Rejection
**File**: `apps/local-server/src/server.ts`
**Lines**: 332-464

**Issue**:
```typescript
(async () => {
  try {
    // ... many async operations
  } catch (err) {
    // ...
  }
})();
```

**Problem**: The async IIFE has a try-catch, but:
1. If an error occurs after a response is already sent, there's no guard
2. Unhandled rejections in nested async operations may escape
3. `response.destroy()` called in timeout while handler is still running

**Impact**:
- Double-write to response
- Corrupted HTTP responses
- Process crashes

**Fix Required**: Add `response.destroyed` checks and ensure only one response per request.

---

### P0-5: No Atomicity in Store Operations

**Severity**: P0 - Data Integrity
**File**: Multiple files
**Lines**: All store operations

**Issue**: Individual store operations are not atomic. Related operations across multiple stores can partially complete.

**Example**:
```typescript
// In handleArtifactPost (bridge-api.ts):
const recorded = runtime.teamStore.recordArtifact(teamId, artifact);
runtime.persist();  // Persist AFTER artifact record
// If persist() fails, in-memory state is inconsistent
```

**Problem**: 
1. `runtime.persist()` is called after all individual operations
2. If persist fails, in-memory state is modified but not persisted
3. Next restart loads inconsistent state

**Impact**:
- Lost updates on persistence failure
- Inconsistent state between in-memory and persisted data
- Corrupt snapshots

**Fix Required**: Implement write-ahead logging or batch operations with rollback.

---

### P0-6: Pairing Token Partially Logged

**Severity**: P0 - Information Disclosure
**File**: `apps/local-server/src/server.ts`
**Lines**: 499-500

**Issue**:
```typescript
const maskedToken = handle.pairingToken.slice(0, 8) + '****';
console.log(`Pairing token: ${maskedToken}`);
```

**Problem**: The first 8 characters of the pairing token are logged. While this seems minor:
1. 16-character hex tokens have only 64 bits of entropy
2. 8 characters = 32 bits exposed = 4 billion possibilities
3. Attacker with access to logs can brute-force remaining 8 characters

**Impact**:
- Token compromise if logs accessed
- Brute-force feasible (32 bits is weak)

**Fix Required**: Either don't log at all, or log a hash:
```typescript
const tokenHash = createHash('sha256').update(handle.pairingToken).digest('hex').slice(0, 8);
console.log(`Pairing token hash: ${tokenHash}`);
```

---

### P0-7: Rate Limiter Bypass via X-Forwarded-For Spoofing

**Severity**: P0 - Security Bypass
**File**: `apps/local-server/src/server.ts` + `rate-limiter.ts`
**Lines**: 260-262, 41-66

**Issue**:
```typescript
// server.ts
const clientIp = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
  ?? request.socket.remoteAddress
  ?? 'unknown';

// rate-limiter.ts
if (directIp === '127.0.0.1' || directIp === '::1' || directIp.startsWith('192.168.') || directIp.startsWith('10.')) {
  return firstIp;  // Trusts X-Forwarded-For
}
```

**Problem**: When `directIp` is a private IP, `X-Forwarded-For` is fully trusted without validation. An attacker can bypass rate limits by sending:
```
X-Forwarded-For: 127.0.0.1
```

**Impact**:
- Rate limit bypass
- Brute force attacks possible
- Denial of service

**Fix Required**: Only trust X-Forwarded-For from known reverse proxies, or don't trust it at all:
```typescript
// Only trust XFF if request comes from known proxy
const isFromProxy = directIp === '127.0.0.1' && proxyList.includes(firstIp);
// Otherwise always use directIp
```

---

### P0-8: No CSRF Protection on Console Endpoints

**Severity**: P0 - CSRF Vulnerability
**File**: `apps/local-server/src/server.ts`
**Lines**: 296-321

**Issue**:
```typescript
if (request.method === 'GET' && url.pathname === CONSOLE_PROJECT_PATH) {
  const session = autoPairStore.createConsoleSession();
  response.setHeader('set-cookie', `cli_bridge_console_session=${session.consoleSessionToken}; HttpOnly; SameSite=Strict; Path=/`);
  // No CSRF token
```

**Problem**: Cookie-based authentication lacks CSRF tokens. While `SameSite=Strict` helps:
1. Not all browsers support it
2. GET requests modify state (session creation)
3. POST to console endpoints from extension could be exploited

**Impact**:
- CSRF attacks possible
- Session hijacking via malicious sites

**Fix Required**: Add CSRF tokens for all state-changing operations.

---

### P0-9: Nonce Validation Missing Bounds Check

**Severity**: P0 - Input Validation
**File**: `apps/local-server/src/server.ts`
**Lines**: 415

**Issue**:
```typescript
const body = JSON.parse(Buffer.concat(chunks).toString());
const result = autoPairStore.claimExtensionSession(body.nonce ?? '');
```

**Problem**: The `nonce` from the request body is passed directly to `claimExtensionSession()` without:
1. Length validation
2. Character set validation
3. Format validation

**Impact**:
- Resource exhaustion with massive nonces
- Potential ReDoS with specially crafted nonces
- Unexpected behavior in session store

**Fix Required**:
```typescript
const nonce = body.nonce;
if (typeof nonce !== 'string' || nonce.length < 32 || nonce.length > 128) {
  return writeJson(400, { ... }, response);
}
const result = autoPairStore.claimExtensionSession(nonce);
```

---

## P1 Issues - HIGH PRIORITY

These issues are significant but may not cause immediate production failures.

### P1-1: In-Memory Stores Not Thread-Safe

**File**: All `InMemory*Store` classes
**Issue**: Map operations are not atomic, allowing concurrent modification corruption

### P1-2: Request Timeout Cleared on Wrong Conditions

**File**: `server.ts:323-392`
**Issue**: `requestTimeout` not cleared for non-bridge paths, causing timeouts on unrelated requests

### P1-3: Snapshot Write Not Atomic

**File**: `bridge-api.ts:1739-1781`
**Issue**: Partial writes possible if process crashes during `snapshotStore.write()`

### P1-4: No Request Correlation IDs

**File**: Throughout
**Issue**: No tracing IDs to correlate requests with logs for security incident investigation

### P1-5: Metrics Arrays Unbounded Growth

**File**: `chatgpt-web-source-adapter.ts:76-77`
**Issue**: `claimTimestamps` and `completionTimestamps` can grow indefinitely

### P1-6: Extension Session Token in Multiple Places

**File**: Multiple handlers
**Issue**: Tokens passed in headers, could leak via logs or referrer

### P1-7: Console Cookie Missing Secure Flag

**File**: `server.ts:317`
**Issue**: Cookie lacks `Secure` flag, allowing transmission over HTTP

### P1-8: Persistence Failure Continues Runtime

**File**: `bridge-api.ts:1738-1742`
**Issue**: `persistenceFailure` set but runtime continues with stale state

### P1-9: Missing Security Headers

**File**: `server.ts`
**Issue**: No CSP, X-Content-Type-Options, or other security headers

### P1-10: Audit Log Not Append-Only

**File**: `audit-log.ts`
**Issue**: Events can be lost if persistence fails mid-write

---

## P2 Issues - MEDIUM PRIORITY

See `improvement-list.md` for full list.

---

## Recommended Actions

1. **Immediate (before next deploy)**:
   - Fix P0-1 (race condition in claimNext)
   - Fix P0-3 (timeout not cleared)
   - Fix P0-7 (XFF spoofing)
   - Fix P0-9 (nonce validation)

2. **Before production**:
   - Fix all remaining P0 issues
   - Address P1 issues related to data integrity
   - Implement proper atomicity

3. **Technical debt**:
   - Address P1/P2 issues
   - Add comprehensive logging
   - Implement circuit breakers
