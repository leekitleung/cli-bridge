# CLI Bridge Quality Review - Improvement List

**Reviewer**: Vibe Coder (Developer Experience Focus)
**Date**: 2026-07-07
**Project**: CLI Bridge

---

## Prioritized Improvements

### Phase 1: Critical Fixes (Week 1-2)

| # | Improvement | Files | Effort | Impact |
|---|-------------|-------|--------|--------|
| 1 | Split `bridge-api.ts` into route modules | `bridge-api.ts` | High | DX, Maintainability |
| 2 | Add request body validation | `server.ts`, route handlers | Medium | Security |
| 3 | Implement structured logging | All files | Medium | Observability |
| 4 | Add request body size limits | `server.ts` | Low | Security |
| 5 | Replace silent catch blocks with logging | `bridge-api.ts` hydration | Low | Debugging |

---

### Phase 2: High Priority (Week 3-4)

| # | Improvement | Files | Effort | Impact |
|---|-------------|-------|--------|--------|
| 6 | Create error type hierarchy | `errors.ts` | Medium | Type Safety |
| 7 | Add store health checks | `health.ts` | Low | Reliability |
| 8 | Increase test coverage to 60% | `tests/` | High | Quality |
| 9 | Fix cmd.exe allowlist bypass | `command-backend.ts` | Low | Security |
| 10 | Split `BridgeRuntime` interface | `bridge-api.ts` | High | Architecture |

---

### Phase 3: Medium Priority (Week 5-6)

| # | Improvement | Files | Effort | Impact |
|---|-------------|-------|--------|--------|
| 11 | Add API request/response types | `types/` | Medium | DX, Type Safety |
| 12 | Implement request ID tracing | `server.ts` | Low | Observability |
| 13 | Remove global singletons | `executor-registry.ts` | Medium | Testability |
| 14 | Add OpenAPI documentation | `docs/` | Medium | DX |
| 15 | Implement circuit breakers | Route handlers | Medium | Resilience |

---

### Phase 4: Nice to Have (Week 7+)

| # | Improvement | Files | Effort | Impact |
|---|-------------|-------|--------|--------|
| 16 | Add API versioning | Routes | Low | API Design |
| 17 | Implement persistent rate limit blocklist | `rate-limiter.ts` | Medium | Security |
| 18 | Add Docker/containerization | `Dockerfile` | Medium | DevOps |
| 19 | Set up CI/CD pipeline | `.github/workflows/` | Medium | DevOps |
| 20 | Performance benchmarks | `benchmarks/` | Low | Performance |

---

## Detailed Improvement Descriptions

### Phase 1-1: Split bridge-api.ts (HIGH PRIORITY)

**Current State**: 5474 lines in single file
**Target State**: ~10 route handler files, ~200 lines each

**Proposed Structure**:
```
src/routes/
  goals.ts          # Goal CRUD + approval
  plans.ts          # Plan management
  teams.ts          # Team operations
  apply.ts          # Workspace apply
  workbuddy.ts      # WorkBuddy operations
  verification.ts   # Verification endpoints
  bridge-api.ts     # Main router + factory
```

**Benefits**:
- Parallel development possible
- Smaller PRs, faster reviews
- Easier to test individual routes
- Reduced cognitive load

---

### Phase 1-2: Add Request Body Validation (MEDIUM PRIORITY)

**Current State**: Direct JSON.parse with no validation
**Target State**: All bodies validated against schemas

**Example Fix**:
```typescript
// Before
const body = JSON.parse(Buffer.concat(chunks).toString());
const result = autoPairStore.claimExtensionSession(body.nonce ?? '');

// After
const parsed = await readJsonBody(request);
if (!parsed.ok) return error(400, parsed.message);
const body = parsed.body as ClaimBody;
if (typeof body.nonce !== 'string') return error(400, 'nonce required');
```

**Benefits**:
- Prevents type confusion
- Fail-fast on bad input
- Self-documenting API

---

### Phase 1-3: Implement Structured Logging (MEDIUM PRIORITY)

**Current State**: `console.log/error` throughout
**Target State**: pino/winston with structured output

**Example**:
```typescript
// Before
console.log('[Server] Bridge request error:', err);

// After
logger.info({ err, path, method }, 'Bridge request completed');
logger.error({ err, path }, 'Bridge request failed');
```

**Benefits**:
- Machine-parseable logs
- Log levels (debug/info/warn/error)
- Structured context
- Performance (pino is 10x faster)

---

### Phase 2-6: Create Error Type Hierarchy (MEDIUM PRIORITY)

**Current State**: String-based error messages
**Target State**: Typed error classes with codes

```typescript
// Proposed structure
class BridgeError extends Error {
  constructor(
    public readonly code: BridgeErrorCode,
    message: string,
    public readonly statusCode: number = 500
  ) { super(message); }
}

enum BridgeErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  TIMEOUT = 'TIMEOUT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
```

**Benefits**:
- Programmatic error handling
- Consistent error format
- Easier debugging
- Better API client experience

---

### Phase 3-11: Add API Request/Response Types (MEDIUM PRIORITY)

**Current State**: Implicit JSON contracts
**Target State**: Explicit Zod schemas + generated types

```typescript
// schemas/goal-schemas.ts
import { z } from 'zod';

export const CreateGoalRequest = z.object({
  sessionId: z.string(),
  description: z.string().min(1).max(10000),
  projectId: z.string().optional(),
});

export type CreateGoalRequest = z.infer<typeof CreateGoalRequest>;
```

**Benefits**:
- Runtime validation
- Type inference
- Self-documenting
- Frontend can import shared schemas

---

### Phase 4-18: Set Up CI/CD Pipeline (MEDIUM PRIORITY)

**Proposed GitHub Actions Workflow**:
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: npm run build-extension
```

**Benefits**:
- Catch issues before merge
- Faster feedback loop
- Automated quality gates
- Reproducible builds

---

## Effort Estimates

| Phase | Total Points | Team Size | Duration |
|-------|-------------|-----------|----------|
| Phase 1 | 13 | 1-2 | 1-2 weeks |
| Phase 2 | 11 | 1-2 | 1-2 weeks |
| Phase 3 | 9 | 1 | 1 week |
| Phase 4 | 7 | 1 | 1 week |

**Total**: ~6 weeks for full implementation

---

## Quick Wins (Do First)

1. **Add body size limit** - 2 lines of code, prevents DoS
2. **Log skipped hydration records** - 5 minutes, huge debugging win
3. **Add request ID header** - 10 minutes, essential for tracing
4. **Document error codes** - 1 hour, improves DX immediately
5. **Split `handleGoalLoopRequest` into separate file** - 30 minutes, starts modularization

---

## Risk Assessment

| Improvement | Risk | Mitigation |
|-------------|------|------------|
| Split bridge-api.ts | Breaking existing routes | Keep router in place, move handlers |
| Add body validation | Breaking existing clients | Add deprecation warnings |
| Remove global singletons | Test breakage | Update tests alongside changes |
| Change error format | Client breakage | Version the API |

---

## Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| File size (max) | 5474 lines | 500 lines | `wc -l` |
| Test coverage | ~35% | 60%+ | Istanbul/builtin |
| API validation | 0% | 100% | Code review |
| Error type usage | 0% | 80%+ | Code review |
| Structured logging | 0% | 100% | Code review |
