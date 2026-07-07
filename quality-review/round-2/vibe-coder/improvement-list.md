# Round 2 Improvement List - Vibe Coder Perspective

## Quick Wins (1-2 hours each)

### [ ] Extract path matchers into separate module
**Files**: `bridge-api.ts` (lines ~240-400)

Move these functions to `routes/utils/path-matchers.ts`:
- `matchProjectTeamPath()`
- `matchTeamApplyPath()`
- `matchProjectAutomationLoopsListPath()`
- `matchProjectAutomationLoopsActionPath()`
- `matchProjectObservabilityPath()`
- `matchEndpointAction()`
- `matchEndpointSubPath()`

### [ ] Standardize error message format
**Rule**: All error messages should include:
- What failed
- Why it failed (if recoverable)
- What values were involved (for debugging)

```typescript
// Before
return error(400, 'Invalid project key');

// After
return error(400, `Invalid project key: "${rawKey}" (must match ${PROJECT_KEY_PATTERN})`);
```

### [ ] Add security unit tests
**New file**: `tests/unit/security/`
- `rate-limiter.test.ts`
- `nonce-validation.test.ts`
- `pairing-token.test.ts`
- `origin-guard.test.ts`

### [ ] Document all ADR references
Add ADR number to file headers:
```typescript
/**
 * ADR-0035: ChatGPT Web Source Relay
 * Implements async source relay pattern...
 */
```

---

## Medium Effort (half day)

### [ ] Split bridge-api.ts into modules
**Target**: Reduce from 5474 to ~500 lines per module

```
routes/bridge-api/
  index.ts           # Main router + constants
  handlers/
    packets.ts       # ~400 lines
    prompts.ts       # ~400 lines
    projects.ts      # ~500 lines
    goals.ts         # ~600 lines
    reviews.ts       # ~300 lines
    workbuddy.ts     # ~400 lines
    source-relay.ts  # ~300 lines
  utils/
    body-parser.ts
    path-matchers.ts
    helpers.ts
```

### [ ] Create central timeout configuration
**New file**: `config/timeouts.ts`
```typescript
export const TIMEouts = {
  // HTTP request timeouts
  REQUEST_TIMEOUT_MS: 60_000,
  BRIDGE_REQUEST_TIMEOUT_MS: 120_000,
  
  // Source relay timeouts
  CHATGPT_WEB_RESULT_TIMEOUT_MS: 120_000,
  HEARTBEAT_INTERVAL_MS: 30_000,
  
  // Rate limiting windows
  RATE_LIMIT_WINDOW_MS: 60_000,
  AUTH_RATE_LIMIT_WINDOW_MS: 15 * 60_000,
  
  // TTLs
  CLAIMED_OUTBOUND_PROMPT_TTL_MS: 60_000,
  OUTBOUND_AUTHORIZATION_TTL_MS: 10 * 60_000,
  SESSION_TTL_MS: 8 * 60 * 60 * 1000,
  CLAIM_TTL_MS: 2 * 60 * 1000,
  
  // Cleanup
  SESSION_CLEANUP_INTERVAL_MS: 5 * 60 * 1000,
  RATE_LIMIT_CLEANUP_INTERVAL_MS: 60_000,
} as const;
```

### [ ] Add API integration tests
**New file**: `tests/e2e/api-integration.test.ts`
- Test each major endpoint flow
- Test authentication paths
- Test error cases
- Use actual HTTP requests, not mocked

---

## Larger Efforts (1-2 days)

### [ ] Fix claimNext() race condition
**File**: `apps/local-server/src/storage/outbound-prompt-store.ts`

Implement atomic compare-and-swap:
```typescript
private atomicCompareAndSwap(
  id: string, 
  field: keyof OutboundPrompt, 
  expected: string, 
  newValue: string
): boolean {
  const prompt = this.prompts.get(id);
  if (!prompt || (prompt as any)[field] !== expected) {
    return false;
  }
  (prompt as any)[field] = newValue;
  return true;
}
```

Note: This is not truly atomic in JS, but combined with the synchronous nature of the Map operations (single-threaded event loop), it provides sufficient protection for the current use case.

### [ ] Add OpenAPI/Swagger documentation
Generate API docs from JSDoc + types:
```typescript
/**
 * @route POST /bridge/goals
 * @param sessionId - Session identifier
 * @param description - Goal description in natural language
 * @returns Created goal with ID and status
 */
```

### [ ] Create developer quickstart guide
**New file**: `docs/developer-quickstart.md`

1. Clone and install
2. Start local server
3. Pair extension
4. Run first goal
5. Debug tips

### [ ] Add circuit breaker for external calls
**Issue**: If GitHub API or Claude API fails, requests pile up.

**Fix**: Implement circuit breaker pattern:
```typescript
class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > RECOVERY_TIMEOUT) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker open');
      }
    }
    // ... execute with failure tracking
  }
}
```

---

## Nice to Have (when time permits)

### [ ] Add request ID tracking
```typescript
// Every request gets a unique ID for tracing
const requestId = randomUUID();
console.log(`[${requestId}] ${method} ${pathname}`);
// Include in error responses
return error(500, { code: 'INTERNAL_ERROR', requestId, message: '...' });
```

### [ ] Add health check for dependencies
```typescript
GET /health/detailed
{
  "status": "healthy",
  "checks": {
    "memory": "ok",
    "disk": "ok", 
    "external": {
      "github": "ok",
      "openai": "degraded"
    }
  }
}
```

### [ ] Add changelog for API
**New file**: `CHANGELOG.md`
Track breaking changes, new endpoints, deprecations.

### [ ] Create migration guide for v2.0
Document how to migrate from previous versions.
