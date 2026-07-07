# Vibe Coder Quality Review - Improvement List

## Prioritized Improvements for Developer Experience

---

## Phase 1: Quick Wins (1-2 days)

### 1. Add Test Utilities Module

**Priority**: P1
**Estimated Effort**: 0.5 day

**Current State**:
```typescript
// Each test file duplicates authFetch
async function authFetch(url: string, token: string, options: RequestInit = {}): Promise<Response> {
  const headers = { ...options.headers, [PAIRING_TOKEN_HEADER]: token };
  return fetch(url, { ...options, headers });
}
```

**Target State**:
```typescript
// tests/helpers/runtime.ts
export function createTestRuntime(options?: Partial<BridgeRuntimeOptions>): BridgeRuntime {
  return createBridgeRuntime({
    dataDir: undefined, // In-memory
    ...options,
  });
}

// tests/helpers/auth.ts
export async function authFetch(runtime: BridgeRuntime, url: string, options?: RequestInit) {
  const token = getPairingToken(runtime);
  return fetch(url, { ...options, headers: { [PAIRING_TOKEN_HEADER]: token, ...options?.headers } });
}
```

**Benefits**:
- Faster test authoring
- Consistent patterns
- Easier onboarding

---

### 2. Add Integration Tests for HTTP Endpoints

**Priority**: P1
**Estimated Effort**: 1-2 days

**Current State**:
E2E tests require running server, skip if unavailable.

**Target State**:
```typescript
// tests/integration/goals.test.ts
import { createTestRuntime, startTestServer } from '../helpers/';

describe('Goals API', () => {
  let runtime: BridgeRuntime;
  let baseUrl: string;
  
  beforeEach(async () => {
    runtime = createTestRuntime();
    baseUrl = await startTestServer(runtime);
  });

  it('should create goal with valid session', async () => {
    const res = await authFetch(baseUrl + '/bridge/goals', {
      method: 'POST',
      body: { sessionId: 'test', description: 'Test goal' }
    });
    expect(res.status).toBe(201);
    expect(res.data.goal.status).toBe('draft');
  });

  it('should reject goal without sessionId', async () => {
    const res = await authFetch(baseUrl + '/bridge/goals', {
      method: 'POST',
      body: { description: 'Test goal' }
    });
    expect(res.status).toBe(400);
  });
});
```

**Benefits**:
- Fast feedback without running full server
- Test all error paths
- Confidence for refactoring

---

### 3. Split bridge-api.ts by Route

**Priority**: P1
**Estimated Effort**: 2-3 days

**Current State**:
Single 5500+ line file with 50+ functions.

**Target State**:
```
apps/local-server/src/routes/
├── bridge-api.ts           # Main factory + common utilities
├── goals.ts                # Goal lifecycle
├── plans.ts                # Plan management  
├── projects.ts             # Project endpoints
├── teams.ts                # Team management
├── workbuddy.ts            # WorkBuddy multiplex
├── apply.ts                # Workspace apply
├── verification.ts         # Git/GitHub checks
└── source-relay.ts         # ChatGPT Web relay
```

**Migration Strategy**:
1. Create new files with empty exports
2. Move functions one-by-one, updating imports
3. Keep tests passing after each move
4. Delete dead code from original file

**Benefits**:
- Faster navigation
- Smaller review diffs
- Parallel development friendly

---

## Phase 2: Medium Effort (1 week)

### 4. Standardize English Comments

**Priority**: P2
**Estimated Effort**: 2-3 days

**Current State**:
```typescript
// 任务特征到执行器标签的映射
const TASK_TAG_MAPPING: Record<...> = { ... };

// 分发任务到执行器
async dispatch(task: TaskDescriptor): Promise<DispatchResult> {
```

**Target State**:
```typescript
// Maps task features to executor tags
const TASK_TAG_MAPPING: Record<...> = { ... };

// Dispatches a task to the selected executor
async dispatch(task: TaskDescriptor): Promise<DispatchResult> {
```

**Files to Update**:
- `apps/local-server/src/execution/*.ts`
- `apps/local-server/src/goal/*.ts`
- `apps/local-server/src/routes/goal-loop-routes.ts`

**Benefits**:
- Consistent developer experience
- Easier code reviews
- Better for future hiring/onboarding

---

### 5. Add OpenAPI Documentation

**Priority**: P2
**Estimated Effort**: 2-3 days

**Current State**:
Markdown table in README.md.

**Target State**:
```yaml
# openapi.yaml
openapi: 3.0.0
info:
  title: CLI Bridge API
  version: 2.14.0
paths:
  /bridge/goals:
    post:
      summary: Create a new goal
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/GoalCreate'
      responses:
        '201':
          description: Goal created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/GoalResponse'
```

**Benefits**:
- Auto-generated API docs
- Client SDK generation
- Contract testing foundation

---

### 6. Add Development Hot-Reload

**Priority**: P2
**Estimated Effort**: 1 day

**Current State**:
```json
"start:local-server": "node --experimental-strip-types apps/local-server/src/server.ts"
```

**Target State**:
```json
{
  "scripts": {
    "dev:server": "tsx watch apps/local-server/src/server.ts",
    "dev": "npm run dev:server"
  }
}
```

**Benefits**:
- Faster iteration
- Better developer flow
- Less context switching

---

## Phase 3: Nice to Have (1-2 weeks)

### 7. Structured Error Codes

**Priority**: P3
**Estimated Effort**: 2-3 days

**Current State**:
```typescript
return error(400, 'Invalid slot status: ${nextStatus}');
```

**Target State**:
```typescript
// errors.ts
export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  // ...
} as const;

return error(400, {
  code: ErrorCodes.VALIDATION_ERROR,
  message: 'Invalid slot status',
  details: { received: nextStatus, expected: VALID_SLOT_STATUSES }
});
```

**Benefits**:
- Programmatic error handling
- Better logging/analytics
- Consistent error structure

---

### 8. Contribution Guidelines

**Priority**: P3
**Estimated Effort**: 0.5 day

**Create** `CONTRIBUTING.md`:
- Branch naming convention
- PR requirements
- Testing expectations
- Code style guide

---

### 9. Stale Documentation Cleanup

**Priority**: P3
**Estimated Effort**: 1-2 days

**Issue**:
100+ planning handoff documents from v0.1-v1.x that are now obsolete.

**Action**:
- Archive old planning docs to `docs/archive/`
- Keep only latest version
- Keep ADRs as source of truth

---

## ROI Summary

| Improvement | Effort | Impact | Priority |
|-------------|--------|--------|----------|
| Test utilities | 0.5d | High | P1 |
| Integration tests | 2d | High | P1 |
| Split bridge-api.ts | 3d | High | P1 |
| English comments | 3d | Medium | P2 |
| OpenAPI docs | 3d | Medium | P2 |
| Hot-reload | 1d | Medium | P2 |
| Error codes | 3d | Low | P3 |
| Contribution guide | 0.5d | Low | P3 |

**Total P1-P2 effort**: 8-12 days
**Expected impact**: Significant DX improvement for a project this size
