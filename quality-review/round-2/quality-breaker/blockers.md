# Quality Breaker Review - Round 2: Blockers

## P0 Issues - STOP SHIP

These issues are critical security vulnerabilities that must be fixed before production.

---

### P0-1: OpenCode Executor Command Injection via shell: true

**Severity**: P0 - Command Injection
**File**: `apps/local-server/src/execution/opencode-executor.ts`
**Lines**: 89-95, 154-156

**Issue**:
```typescript
const args = ['exec', '--json', task.prompt];  // User input!

const proc = spawn(this.options.openCodePath, args, {
  cwd: workingDir,
  env: { ...process.env },
  shell: true,  // COMMAND INJECTION VULNERABILITY!
});
```

**Problem**: The OpenCode executor passes user-controlled `task.prompt` directly to a shell with `shell: true`. This enables:

1. Command chaining: `"; rm -rf /; echo "`
2. Shell expansion: `$(malicious_command)`
3. Glob injection: `*.txt | xargs cat`
4. Environment variable injection via inherited env

**Exploit Scenario**:
```javascript
// If task.prompt comes from user input:
task.prompt = '"; cat /etc/passwd; echo "'
// Results in: opencode exec --json "; cat /etc/passwd; echo "
// Shell interprets this as two commands!
```

**Impact**:
- Full command execution on the host system
- Potential data exfiltration
- System compromise if combined with other vulnerabilities

**Fix Required**:
```typescript
// Option 1: Use shell: false (if OpenCode doesn't need shell features)
const proc = spawn(this.options.openCodePath, ['exec', '--json', task.prompt], {
  shell: false,
  cwd: workingDir,
  env: cleanEnv,
});

// Option 2: Proper argument escaping if shell features needed
function escapeArg(arg: string): string {
  // Use a library like shell-quote or implement proper escaping
  return arg.replace(/'/g, "'\\''");
}
const safePrompt = escapeArg(task.prompt);
const proc = spawn(`/bin/sh`, ['-c', `opencode exec --json '${safePrompt}'`], {
  shell: false,
});
```

**Status**: NEW ISSUE - Not present in Round 1 review

---

## P1 Issues - HIGH PRIORITY

These are significant security concerns that should be addressed before production.

---

### P1-1: Pairing Token Still Logged in scripts/start.ts

**Severity**: P1 - Information Disclosure
**File**: `scripts/start.ts`
**Line**: 19

**Issue**:
```typescript
console.log(`Pairing token: ${handle.pairingToken}`);
```

**Problem**: While `apps/local-server/src/server.ts` was fixed to not log the token, the `scripts/start.ts` entry point still logs the full pairing token.

**Impact**:
- Token exposure in terminal logs
- Potential token capture via log files or CI/CD artifacts
- Attackers with log access can authenticate to the bridge

**Fix Required**: Either remove the log entirely or log only a hash:
```typescript
import { createHash } from 'node:crypto';
const tokenHash = createHash('sha256').update(handle.pairingToken).digest('hex').slice(0, 8);
console.log(`Pairing token (first 8 chars of hash): ${tokenHash}`);
```

---

### P1-2: Security Headers Missing on Console UI

**Severity**: P1 - Security Hygiene
**File**: `apps/local-server/src/server.ts`

**Issue**: The console UI is served as HTML but no security headers are set.

**Missing Headers**:
- `Content-Security-Policy` - Prevents XSS
- `X-Content-Type-Options: nosniff` - Prevents MIME sniffing
- `X-Frame-Options: DENY` - Prevents clickjacking
- `Strict-Transport-Security` - Enforces HTTPS (may not apply for local HTTP)

**Fix Required**:
```typescript
function addSecurityHeaders(response: ServerResponse): void {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';");
}
```

---

### P1-3: No Input Sanitization on Workspace Apply Paths

**Severity**: P1 - Path Traversal
**Files**: `apps/local-server/src/storage/workspace-apply-store.ts`

**Issue**: The workspace apply store handles file operations but path traversal protection needs verification.

**Evidence Needed**: All `path.join()` calls with user input must verify the result is within the allowed directory.

**Fix Required**: Implement and verify path containment:
```typescript
function isPathContained(basePath: string, targetPath: string): boolean {
  const resolved = path.resolve(basePath, targetPath);
  return resolved.startsWith(path.resolve(basePath));
}
```

---

### P1-4: ContainedProcess Uses `detached: true` on Windows

**Severity**: P1 - Process Management
**File**: `apps/local-server/src/process/contained-process.ts`
**Line**: 36

**Issue**:
```typescript
const detached = process.platform !== 'win32';
const child = spawn(file, args, {
  cwd: options.cwd,
  env: options.env,
  stdio: 'pipe',
  shell: false,
  detached,  // true on non-Windows!
});
```

**Problem**: On Unix systems, `detached: true` creates a process in a new process group. If the parent crashes, orphaned processes may continue running. On Windows, `detached` has different semantics.

**Impact**: Potential orphaned processes consuming resources or holding file locks.

---

### P1-5: Extension Session Token in Background Script Logs

**Severity**: P1 - Information Disclosure
**File**: `apps/extension/src/background/index.ts`
**Line**: 308

**Issue**:
```typescript
console.log('[Background] handleProxyFetch: forwarding', method, request.path, 'token present:', Boolean(headers[PAIRING_TOKEN_HEADER]));
```

**Problem**: While this only logs whether a token is present (not the token value), it could be combined with timing attacks to determine token validity.

**Impact**: Minor information disclosure about authentication attempts.

---

## P2 Issues - MEDIUM PRIORITY

### P2-1: No Rate Limiting on /health Endpoint

**File**: `apps/local-server/src/server.ts:282-285`

The public health endpoint has no rate limiting, making it a potential DoS vector for information gathering.

---

### P2-2: No Request ID / Correlation ID

**File**: Throughout `apps/local-server/src/server.ts`

No request correlation IDs are generated, making security incident investigation difficult.

---

### P2-3: No Audit Log Integrity Protection

**File**: `apps/local-server/src/storage/audit-log.ts`

The audit log is append-only in memory but has no cryptographic integrity protection (e.g., hash chains).

---

### P2-4: Snapshot Hydration Still Silent-Fails

**File**: `apps/local-server/src/routes/bridge-api.ts:1667-1735`

Round 1 finding P0-2 remains unfixed. Individual hydration failures are still silently ignored.

---

## Recommended Actions

### Immediate (Before Next Deploy)
1. **Fix P0-1**: Change OpenCode executor to `shell: false` or implement proper argument escaping
2. **Fix P1-1**: Remove pairing token logging from `scripts/start.ts`

### Before Production
1. Add security headers to console UI responses
2. Verify all path operations have containment checks
3. Review extension logging for any token leakage

### Technical Debt
1. Fix P1-2 through P1-5
2. Address P2 issues in future iterations
3. Implement comprehensive security testing
