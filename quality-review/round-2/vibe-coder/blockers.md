# Round 2 Blockers - Vibe Coder Perspective

## P0 (Must Fix Before Production)

### 1. Race Condition in claimNext() Still Exists
**File**: `apps/local-server/src/storage/outbound-prompt-store.ts` (lines 278-308)

**Issue**: The `claimNext()` method has a TOCTOU (Time-of-Check-Time-of-Use) race condition:
```typescript
claimNext(now: number = Date.now()): OutboundPrompt | undefined {
  this.recoverStaleClaims(now);
  const prompt = Array.from(this.prompts.values())
    .filter((candidate) => candidate.status === 'queued')
    .sort((left, right) => left.createdAt - right.createdAt)[0];  // <- Race: another request can claim first

  if (!prompt) {
    return undefined;
  }
  // ... modify and save
}
```

Between finding the prompt and marking it as `claimed`, another concurrent request could claim the same prompt. This needs atomic compare-and-swap.

**Impact**: Two concurrent requests could both get the same prompt, leading to duplicate execution.

**Fix**: Use atomic compare-and-swap pattern:
```typescript
claimNext(now: number = Date.now()): OutboundPrompt | undefined {
  for (const prompt of this.prompts.values()) {
    if (prompt.status === 'queued') {
      const current = prompt.status;
      // Atomic CAS - would need to implement properly
      if (this.atomicCompareAndSwap(prompt.id, 'status', 'queued', 'claimed')) {
        // success
      }
    }
  }
}
```

---

## P1 (Should Fix Soon)

### 2. bridge-api.ts is Unmaintainably Large
**File**: `apps/local-server/src/routes/bridge-api.ts`

**Lines**: 5474 lines in a single file

**Issue**: This is a "God file" that handles all bridge API routes. It's impossible to navigate, review, or test in isolation.

**Impact**: 
- Reviewers miss bugs in 5000+ lines
- Tests can only run against the whole file
- Difficult to onboard new developers

**Fix**: Split into modules:
```
routes/bridge-api/
  index.ts           # Main router, constants
  handlers/
    packets.ts       # Packet endpoints
    prompts.ts       # Prompt endpoints
    projects.ts      # Project endpoints
    goals.ts         # Goal/plan endpoints
    reviews.ts       # Review endpoints
    workbuddy.ts     # WorkBuddy endpoints
    source-relay.ts  # ADR-0035 source relay
  utils/
    body-parser.ts
    path-matchers.ts
```

### 3. No Unit Tests for Security-Critical Paths
**Issue**: Security fixes in Round 1 have no automated verification:
- X-Forwarded-For rejection
- Nonce validation (16-256 chars)
- Pairing token timing-safe comparison
- Rate limiter behavior under concurrent load

**Fix**: Add security-focused unit tests in `tests/unit/security/`

### 4. Inconsistent Documentation Language
**Issue**: Mix of Chinese and English in:
- Error messages (some in Chinese, some in English)
- Inline comments (mix throughout)
- Doc files (some .md files in Chinese, some in English)

**Impact**: Confusing for international contributors, inconsistent developer experience.

**Fix**: Standardize on English for code/comments; allow Chinese for user-facing error messages only.

---

## P2 (Nice to Have)

### 5. Magic Constants Scattered Throughout
**Examples**:
- `BRIDGE_FETCH_TIMEOUT_MS = 10_000` (bridge-client.ts)
- `REQUEST_TIMEOUT_MS = 60_000` (server.ts)
- `BRIDGE_REQUEST_TIMEOUT_MS = 120_000` (server.ts)
- `CLAIMED_OUTBOUND_PROMPT_TTL_MS = 60_000` (outbound-prompt-store.ts)

**Issue**: Hard to reason about system behavior, no central place to tune timeouts.

**Fix**: Create `config/timeouts.ts` with documented constants.

### 6. Error Messages Lack Context
**Examples from code**:
```typescript
// Cryptic
return error(409, 'Conversation action cannot be confirmed');  // Why not?

// Better (found elsewhere)
return error(400, `planStepId out of range (0..${plan.steps.length - 1})`);  // Shows bounds
```

**Fix**: Include relevant bounds/values in error messages.

### 7. No API Versioning
**Issue**: All endpoints are `/bridge/*` with no versioning. Breaking changes require major version bump.

**Fix**: Add `/bridge/v1/*` prefix with migration path documented.
