# Quality Breaker Review - Round 2: Improvement List

## Security Fixes Status

### Completed Fixes

| Issue | Status | Evidence |
|-------|--------|----------|
| X-Forwarded-For Spoofing | FIXED | server.ts:259-261, rate-limiter.ts:40-45 |
| claimNext() Atomic | FIXED | chatgpt-web-source-adapter.ts:156-181 |
| Nonce Validation | FIXED | server.ts:415-419 |
| Token Logging (server) | FIXED | server.ts:506 |

### Partial/Incomplete Fixes

| Issue | Status | Evidence |
|-------|--------|----------|
| Token Logging (scripts) | NOT FIXED | scripts/start.ts:19 |

---

## New Improvements Required

### High Priority (Security)

#### 1. OpenCode Executor - Remove shell: true

**File**: `apps/local-server/src/execution/opencode-executor.ts`

**Current Code** (lines 89-95):
```typescript
const args = ['exec', '--json', task.prompt];

const proc = spawn(this.options.openCodePath, args, {
  cwd: workingDir,
  env: { ...process.env },
  shell: true,
});
```

**Recommended Fix**:
```typescript
// If OpenCode CLI accepts arguments directly (no shell needed):
const args = ['exec', '--json', task.prompt];

const proc = spawn(this.options.openCodePath, args, {
  cwd: workingDir,
  env: filterSensitiveEnv(process.env),
  shell: false,
});

// Helper to filter sensitive env vars
function filterSensitiveEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const filtered = { ...env };
  const sensitive = ['AWS_SECRET', 'GITHUB_TOKEN', 'API_KEY', 'SECRET'];
  for (const key of Object.keys(filtered)) {
    if (sensitive.some(s => key.toUpperCase().includes(s))) {
      delete filtered[key];
    }
  }
  return filtered;
}
```

---

#### 2. Remove Pairing Token Logging from scripts/start.ts

**File**: `scripts/start.ts`

**Current Code** (line 19):
```typescript
console.log(`Pairing token: ${handle.pairingToken}`);
```

**Recommended Fix**:
```typescript
// Option A: Don't log at all
console.log('Pairing token: [see /health endpoint or console UI]');

// Option B: Log a hash only
import { createHash } from 'node:crypto';
const tokenHash = createHash('sha256').update(handle.pairingToken).digest('hex').slice(0, 8);
console.log(`Pairing token identifier: ${tokenHash}`);
```

---

### Medium Priority (Security Hygiene)

#### 3. Add Security Headers to Console UI Responses

**File**: `apps/local-server/src/server.ts`

**Recommended Fix** - Add a helper and use it for HTML responses:
```typescript
function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
}

// Use when serving HTML:
if (request.method === 'GET' && url.pathname === CONSOLE_PROJECT_PATH) {
  setSecurityHeaders(response);
  // ... rest of handler
}
```

---

#### 4. Add Rate Limiting to Public Health Endpoint

**File**: `apps/local-server/src/server.ts`

**Issue**: The `/health` endpoint has no rate limiting, enabling information gathering.

**Recommended Fix**:
```typescript
// Already has defaultRateLimiter available - just add /health to publicPaths
const publicPaths = [
  PUBLIC_HEALTH_PATH,  // Already included
  CONSOLE_PATH,
  CONSOLE_GOALS_PATH,
  CONSOLE_PROJECT_PATH,
];
// Health endpoint is already protected by defaultRateLimiter
```

Wait, health is already in `publicPaths` at line 264. This is already protected.

---

#### 5. Add Request Correlation IDs

**File**: `apps/local-server/src/server.ts`

**Recommended Fix**:
```typescript
import { randomUUID } from 'node:crypto';

const requestHandler: RequestListener = (request, response) => {
  const requestId = randomUUID();
  const startTime = Date.now();

  // Attach to request for logging
  (request as any).requestId = requestId;

  // Add to response headers for client correlation
  response.setHeader('X-Request-Id', requestId);

  // Log with correlation ID
  console.log(`[${requestId}] ${request.method} ${url.pathname} started`);
  // ...
};
```

---

#### 6. Improve Extension Background Logging

**File**: `apps/extension/src/background/index.ts`

**Current** (line 308):
```typescript
console.log('[Background] handleProxyFetch: forwarding', method, request.path, 'token present:', Boolean(headers[PAIRING_TOKEN_HEADER]));
```

**Recommended Fix**:
```typescript
// Remove token presence indicator - too much information
console.log('[Background] handleProxyFetch: forwarding', method, request.path);

// Or use a more generic message
console.log('[Background] handleProxyFetch: method=%s path=%s', method, request.path);
```

---

### Lower Priority (Code Quality)

#### 7. Add Path Traversal Tests for Workspace Apply

**Files**: `apps/local-server/src/storage/workspace-apply-store.ts`

Add test cases for:
- `../etc/passwd`
- `..%2F..%2Fetc%2Fpasswd`
- Null bytes (`\0`)
- Very long paths

---

#### 8. Add Security Integration Tests

Create tests that verify:
- XFF spoofing attempts are rejected
- Nonce validation rejects invalid inputs
- Rate limiting works correctly
- Authentication is enforced on protected endpoints

---

#### 9. Document Security Boundaries

Add security documentation:
- What the pairing token protects
- Trust boundaries between components
- Assumptions about local-only access
- Known attack surface

---

#### 10. Review All spawn() Calls for shell: true

Current `shell: true` usages found:
- `apps/local-server/src/execution/opencode-executor.ts:94` - **NEEDS FIX**
- `apps/local-server/src/execution/opencode-executor.ts:155` - **NEEDS FIX**

Other `shell: true` usages are in test scripts or controlled environments:
- `scripts/web-auto-release-e2e.ts` - Test script, acceptable
- `scripts/start-local-configured.ts` - Test script, acceptable
- `scripts/remote-review-gate.mjs` - Test script, acceptable

---

## Summary

| Priority | Count | Estimated Effort |
|----------|-------|------------------|
| Critical (P0) | 1 | 30 min |
| High (P1) | 2 | 1 hour |
| Medium (P2) | 3 | 2 hours |
| Low | 4 | 3 hours |

**Total**: ~6.5 hours of security improvements

---

## Test Coverage Recommendations

### Security Tests to Add

1. **XFF Bypass Test**: Verify rate limiting cannot be bypassed with fake XFF headers
2. **Nonce Validation Tests**: Test boundary conditions (15 chars, 257 chars, non-string types)
3. **Token Logging Test**: Ensure no full tokens appear in logs
4. **CSRF Test**: Verify state-changing endpoints require proper origins
5. **Command Injection Test**: For any user-input-to-shell paths

---

## Verification Checklist

Before closing this review:

- [ ] OpenCode executor changed to `shell: false` OR argument escaping implemented
- [ ] Pairing token logging removed from `scripts/start.ts`
- [ ] Security headers added to HTML responses
- [ ] Request correlation IDs implemented
- [ ] Security integration tests added
- [ ] All `shell: true` usages reviewed and justified
