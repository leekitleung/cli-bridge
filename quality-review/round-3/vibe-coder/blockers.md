# Vibe Coder Quality Review - Blockers

## Summary

**P0 Blockers**: 0
**P1 Blockers**: 2
**P2 Blockers**: 4

---

## P0 - Critical (0)

None identified. The codebase is functional and production-ready.

---

## P1 - High Priority (2)

### P1-1: Monolithic bridge-api.ts

**Severity**: High
**File**: `apps/local-server/src/routes/bridge-api.ts`
**Lines**: 5500+

**Issue**:
The entire bridge API is contained in a single 5500+ line file. This creates friction for:
- Navigating during debugging
- Code review (huge diffs)
- Onboarding new developers
- Parallel development

**Impact**:
- Slow iteration cycles
- High risk of merge conflicts
- Hard to locate specific functionality

**Recommendation**:
Split into logical modules:
```
routes/
├── bridge-api.ts           # Main entry, BridgeRuntime factory
├── goals.ts                # Goal CRUD + approval
├── plans.ts                # Plan management
├── projects.ts             # Project endpoints
├── teams.ts                # Team management  
├── workbuddy.ts            # WorkBuddy multiplex
├── apply.ts                # Workspace apply
├── verification.ts         # Git/GitHub verification
└── source-relay.ts         # ChatGPT Web source relay
```

---

### P1-2: Insufficient Integration Test Coverage

**Severity**: High
**Files**: `tests/e2e/*.ts`, `tests/unit/*.ts`

**Issue**:
Only 4 test files exist for a complex multi-component system:
- `tests/unit/verify-step-output.test.ts`
- `tests/unit/executor-registry.test.ts`
- `tests/e2e/goal-loop-integration.test.ts`
- `tests/e2e/adr-0036-verification.test.ts`

No tests exist for:
- HTTP endpoint behavior
- Store interactions
- Authentication/authorization flows
- Error recovery paths

**Impact**:
- High risk of regressions
- Slows refactoring confidence
- Error handling paths untested

**Recommendation**:
1. Add supertest-style HTTP integration tests
2. Create test fixtures for common runtime states
3. Add integration tests for each route handler
4. Add tests for error recovery paths

---

## P2 - Medium Priority (4)

### P2-1: Bilingual Code Comments

**Severity**: Medium
**Files**: Multiple, notably `execution-dispatcher-v2.ts`, `goal-loop-runner.ts`

**Issue**:
Mixing Chinese and English comments creates cognitive load:
```typescript
// WorkBuddy 执行器 - 实现 ExecutorBackend 接口
// 将任务放入 WorkBuddy 的 inbox，等待执行结果。
async execute(task: ExecutorTask): Promise<ExecutorResult> {
```

**Impact**:
- Friction for non-Chinese speakers
- Inconsistent developer experience
- Harder to maintain

**Recommendation**:
Standardize on English for all code comments. Chinese can remain in docs/ for local team context.

---

### P2-2: No OpenAPI/Swagger Documentation

**Severity**: Medium
**Files**: N/A

**Issue**:
All API endpoints are documented only in README.md as a markdown table. No machine-readable spec exists.

**Impact**:
- Hard to discover available endpoints
- No auto-generated client SDKs
- Manual documentation drift

**Recommendation**:
Add OpenAPI 3.0 spec alongside routes, generated from JSDoc or hand-authored.

---

### P2-3: Missing Test Utilities and Fixtures

**Severity**: Medium
**Files**: `tests/**/*.ts`

**Issue**:
Each test file re-implements similar patterns:
- `authFetch` helper in goal-loop-integration.test.ts
- No shared runtime factory for tests
- No test data factories

**Impact**:
- Duplicated code
- Inconsistent test patterns
- Harder to add new tests

**Recommendation**:
Create `tests/helpers/`:
```
tests/helpers/
├── auth.ts           # Authentication utilities
├── runtime.ts        # BridgeRuntime factory
├── fixtures/         # Sample data
└── assertions.ts     # Custom assertions
```

---

### P2-4: No Hot-Reload for Development

**Severity**: Medium
**Files**: `package.json`

**Issue**:
Developers must restart the server after each change:
```json
"start:local-server": "node --experimental-strip-types apps/local-server/src/server.ts"
```

**Impact**:
- Slow iteration during development
- Context switching breaks flow

**Recommendation**:
Add `tsx watch` or similar:
```json
"dev": "tsx watch apps/local-server/src/server.ts"
```

---

## P3 - Low Priority (Optional)

| Issue | Impact | Effort |
|-------|--------|--------|
| No structured error codes | Error handling DX | Low |
| Stale planning docs | Navigation confusion | Medium |
| No contribution guidelines | Onboarding friction | Low |
| ADR numbering gaps | Documentation trust | Low |
