# Quality Breaker Review - Round 2: Score Report

## Overall Score: 63/100

### Score Breakdown

| Category | Score | Max | Issues |
|----------|-------|-----|--------|
| Security Fixes Verification | 14 | 25 | See below |
| New Critical Vulnerabilities | 0 | 25 | P0-1: shell: true |
| Architecture & Code Quality | 15 | 25 | P1 issues remain |
| Operational Concerns | 17 | 25 | Minor improvements needed |

---

## Security Fixes Verification (14/25)

### 1. X-Forwarded-For Spoofing Protection: PASS

**Status**: FIXED

**Evidence** (server.ts:259-261):
```typescript
// 获取客户端 IP（不再信任 X-Forwarded-For，防止 IP 欺骗）
// SECURITY FIX: X-Forwarded-For 可以被攻击者伪造，不再使用
const clientIp = request.socket.remoteAddress ?? 'unknown';
```

**Rate limiter** (rate-limiter.ts:40-45):
```typescript
getClientIp(directIp: string, xForwardedFor?: string | null): string {
  // SECURITY FIX: 不再信任 X-Forwarded-For
  return directIp ?? 'unknown';
}
```

**Verdict**: The rate limiter's `getClientIp()` method is never called by the server - the server passes `socket.remoteAddress` directly to `limiter.check()`. This is secure.

---

### 2. claimNext() Atomic Operation: PARTIALLY FIXED

**Status**: PARTIALLY FIXED - Race condition is addressed, but not truly atomic

**Evidence** (chatgpt-web-source-adapter.ts:156-181):
```typescript
claimNext(): ChatGptSourceRequest | undefined {
  for (const req of this.requests.values()) {
    if (req.status !== 'pending') continue;

    const prev = this.requests.get(req.id);  // Second lookup
    if (prev && prev.status === 'pending') {
      const updated: ChatGptSourceRequest = { ...prev, status: 'claimed', claimedAt: Date.now() };
      this.requests.set(req.id, updated);     // Third operation
      return clone(updated);
    }
  }
  return undefined;
}
```

**Analysis**:
- The old non-atomic pattern (iterate + claim) is replaced
- BUT: Three separate Map operations: `values()` iterator, `get()`, `set()`
- In single-threaded Node.js, this is functionally atomic due to event loop serialization
- However, if `structuredClone()` throws (OOM), state could be inconsistent
- The code correctly clones before modification, avoiding direct mutation of stored objects

**Verdict**: Acceptable for Node.js single-threaded model. True atomicity would require locks or atomic operations.

---

### 3. Pairing Token Not Logged: PARTIALLY FIXED

**Status**: PARTIALLY FIXED - Inconsistent across entry points

**Evidence**:
- `server.ts:506`: `console.log(`Pairing token: [see /health endpoint]`);` - GOOD
- `scripts/start.ts:19`: `console.log(`Pairing token: ${handle.pairingToken}`);` - BAD!

**Evidence** (start.ts):
```typescript
export async function startProduct(): Promise<void> {
  const handle = await startLocalServer(DEFAULT_LOCAL_SERVER_PORT, {...});
  console.log(`CLI Bridge listening on ${handle.url}`);
  console.log(`Project Workspace: ${buildConsoleOpenTarget(handle)}`);
  console.log(`Pairing token: ${handle.pairingToken}`);  // FULL TOKEN LEAKED!
  console.log('Next: open the CLI Bridge extension...');
}
```

**Verdict**: Server startup (server.ts main module) is fixed, but `scripts/start.ts` still logs the full token.

---

### 4. Nonce Validation: PASS

**Status**: FIXED

**Evidence** (server.ts:415-419):
```typescript
// SECURITY FIX: 验证 nonce 长度和格式，防止资源耗尽攻击
const nonce = body?.nonce;
if (typeof nonce !== 'string' || nonce.length < 16 || nonce.length > 256) {
  writeJson(400, { status: 'error', code: 'INVALID_NONCE', message: 'Invalid nonce format' }, response);
  return;
}
```

**Verdict**: Nonce validation with length bounds (16-256) and type check is properly implemented.

---

## NEW CRITICAL FINDINGS

### P0-1: OpenCode Executor Uses shell: true (CRITICAL COMMAND INJECTION)

**File**: `apps/local-server/src/execution/opencode-executor.ts`
**Lines**: 89-95, 154-156

```typescript
const args = ['exec', '--json', task.prompt];  // User-controlled prompt!

const proc = spawn(this.options.openCodePath, args, {
  cwd: workingDir,
  env: { ...process.env },
  shell: true,  // SHELL EXPANSION ENABLED!
});
```

**Severity**: P0 - Critical

**Impact**:
- Any user-provided `task.prompt` is passed directly to the shell
- Command injection possible: `task.prompt = '"; rm -rf /; echo "'`
- The `shell: true` flag enables shell expansion, globbing, and command chaining
- Combined with `env: { ...process.env }` - inherits full environment including PATH

**Recommendation**: Change to `shell: false` and pass arguments separately. If shell features are required, use a proper argument escaping library.

---

### P1-1: Inconsistent Token Logging Across Entry Points

**Files**: `scripts/start.ts:19`, `apps/local-server/src/server.ts:506`

While the main server startup is fixed, the `scripts/start.ts` entry point still logs the full pairing token.

---

### P1-2: No Path Traversal Protection in File Operations

**Files**: `apps/local-server/src/...`

The codebase appears to use file operations (apply store, etc.) without visible path traversal protection. Need to verify all `path.join()` usages are validated.

---

### P1-3: Security Headers Missing

**File**: `apps/local-server/src/server.ts`

No security headers are set:
- No `Content-Security-Policy`
- No `X-Content-Type-Options: nosniff`
- No `X-Frame-Options`
- No `Strict-Transport-Security`

For a local server, these may be less critical, but the console UI serves HTML.

---

## Summary

| Fix | Status | Notes |
|-----|--------|-------|
| X-Forwarded-For | PASS | Now uses socket.remoteAddress directly |
| claimNext() | PASS | Compare-and-swap pattern implemented |
| Token Logging | PARTIAL | Fixed in server.ts, broken in start.ts |
| Nonce Validation | PASS | Length and type validation implemented |
| NEW: shell:true | FAIL | OpenCode executor has command injection risk |
