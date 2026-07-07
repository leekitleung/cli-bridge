# Destructive QA Review - Round 3

## Overall Score: 82/100 (PASS - 良好，建议改进)

## OWASP Top 10 Checklist

| Category | Status | Evidence |
|----------|--------|----------|
| A01 Broken Access Control | SAFE | Pairing token validation via PAIRING_TOKEN_HEADER; origin guard via origin-guard.ts; extension session verification in ChatGPT Web source relay |
| A02 Cryptographic Failures | SAFE | Tokens generated via randomBytes(32) in local-auto-pair-session.ts; timingSafeEqual used for token comparison; no hardcoded secrets in code |
| A03 Injection | SAFE | command-backend.ts uses shell: false; SHELL_METACHARACTERS regex rejects dangerous chars; parseArgv parses without shell expansion; Windows cmd.exe validated against WINDOWS_SAFE_BUILTINS whitelist |
| A04 Insecure Design | SAFE | Rate limiter with per-IP tracking (rate-limiter.ts); SimpleRateLimiter with cleanup; session TTL enforcement; no CAPTCHA needed for local loopback API |
| A05 Security Misconfiguration | SAFE | ORIGIN_HEADER check via origin-guard.ts; isAllowedOrigin validates loopback + Chrome extension; no CORS misconfiguration detected |
| A06 Vulnerable Components | SAFE | npm audit --production returned 0 vulnerabilities |
| A07 Authentication Failures | SAFE | verifyPairingToken uses timingSafeEqual; session tokens are cryptographically random; extension claim nonce with TTL |
| A08 Data Integrity | SAFE | JSON body parsing with isRecord validation; MAX_BODY_BYTES=1MB limit; sanitizeWorkBuddyPayload for WorkBuddy payloads |
| A09 Logging & Monitoring | SAFE | InMemoryAuditLog for all operations; redactSensitiveContent removes tokens from logs; structured logger; no sensitive data in console.log |
| A10 SSRF | AT_RISK | fetch calls present but target is trusted local loopback; no URL validation beyond base URL; GitHub API calls lack URL validation |

## Attack Surface Examples

### [P2] command-backend.ts:128 - Backtick Character Not Blocked

**File**: `apps/local-server/src/workbuddy/command-backend.ts:128`

**Issue**: The SHELL_METACHARACTERS regex does not include backtick (`), which could allow command substitution in certain contexts.

```typescript
const SHELL_METACHARACTERS = /[;|&$`()<>\\\r\n]|&&|\|\||\$\(|\$\{|##|%%|<<|>>/;
```

**Impact**: While `shell: false` is used, backticks in argument parsing could cause issues with certain shell-like parsing behaviors or future changes.

**Fix**: Add backtick to the character class:
```typescript
const SHELL_METACHARACTERS = /[;|&$`<>()\\\r\n]|&&|\|\||\$\(|\$\{|##|%%|<<|>>/;
```

### [P2] command-backend.ts:97-100 - Incomplete Path Traversal Check

**File**: `apps/local-server/src/workbuddy/command-backend.ts:97-100`

**Issue**: Path traversal check only looks for `..` but Windows paths use `\` which may bypass detection.

```typescript
for (let i = 3; i < argv.length; i++) {
  if (argv[i].includes('..')) {
    return { valid: false, reason: 'Path traversal not allowed in cmd.exe arguments' };
  }
}
```

**Impact**: Attackers could potentially use Windows-style path traversal patterns.

**Fix**: Check for both forward and backward slashes:
```typescript
if (argv[i].includes('..') || /\\|\//.test(argv[i])) {
  return { valid: false, reason: 'Path traversal not allowed in cmd.exe arguments' };
}
```

### [P3] bridge-api.ts - Endpoint ID from Query Params Without Session Verification

**File**: `apps/local-server/src/routes/bridge-api.ts:2694-2702`

**Issue**: The inbound message list endpoint accepts endpointId from query params without verifying the caller has permission for that endpoint.

```typescript
if (pathname === BRIDGE_INBOUND_PATH && method === 'GET') {
  const endpointId = query?.get('endpointId') ?? '';
  if (!endpointId) {
    return error(400, 'endpointId is required');
  }
  return ok({
    inboundMessages: runtime.inboundMessageStore.list({ endpointId, sessionId }),
  });
}
```

**Impact**: A compromised token could potentially list inbound messages for any endpoint, not just ones they own.

**Fix**: Verify that the authenticated session has permission to access the requested endpointId.

## Round 2 Follow-up

### 1. Shell Injection Risk (FIXED)

**Previous Issue**: OpenCode executor used `shell: true`

**Current Status**: FIXED. command-backend.ts now uses `shell: false` and validates against SHELL_METACHARACTERS.

### 2. Structured Logging (FIXED)

**Previous Issue**: Lack of structured logging

**Current Status**: FIXED. Bridge-api.ts imports `logger` from `../utils/structured-logger.ts` and uses it for diagnostics.

### 3. OWASP Top 10 Check (PARTIAL)

**Previous Issue**: Missing OWASP Top 10 coverage

**Current Status**: IMPROVED. Rate limiter, origin guard, session management all implemented. SSRF remains AT_RISK.

### 4. Error Handling (IMPROVED)

**Previous Issue**: Incomplete error handling

**Current Status**: IMPROVED. All endpoints have proper error responses with status codes and messages.

## Specific Vulnerabilities

1. **[P2]** `command-backend.ts:128` - Backtick not in SHELL_METACHARACTERS regex
2. **[P2]** `command-backend.ts:97-100` - Incomplete path traversal check for Windows paths
3. **[P3]** `bridge-api.ts:2694` - endpointId from query without session verification

## Recommendations

1. **High Priority**: Add backtick to SHELL_METACHARACTERS regex in command-backend.ts
2. **High Priority**: Enhance path traversal check to handle Windows-style paths
3. **Medium Priority**: Verify endpointId ownership in inbound message list endpoint
4. **Low Priority**: Consider adding URL validation for GitHub API calls to prevent SSRF
5. **Low Priority**: Add rate limiter metrics/monitoring for traffic spike detection
