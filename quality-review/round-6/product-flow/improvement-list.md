# Product Flow Improvement List - Round 6

## High-Priority Improvements

### 1. Implement Dependency Injection Container
**Effort**: High (2-3 weeks)
**Files**: Throughout codebase

**Description**: Replace direct instantiation and global singletons with a DI container pattern.

**Steps**:
1. Choose lightweight DI approach (e.g., `tsyringe`, manual DI, or factory pattern)
2. Identify all classes requiring DI
3. Refactor constructors to accept dependencies
4. Create container configuration
5. Update tests to use container or manual DI

**Benefits**:
- Improved testability
- Clearer dependency graph
- Easier component reuse
- Runtime configuration flexibility

---

### 2. Split BridgeRuntime into Focused Contexts
**Effort**: Medium (1-2 weeks)
**Files**: `apps/local-server/src/routes/bridge-api.ts`

**Description**: Decompose the monolithic `BridgeRuntime` interface into smaller, focused contexts.

**Steps**:
1. Identify natural groupings of runtime properties
2. Create focused context interfaces
3. Update `createBridgeRuntime()` to compose contexts
4. Update consumers to request only needed contexts
5. Deprecate monolithic `BridgeRuntime` type

**Target Structure**:
```typescript
interface CoreContext { packetStore, auditLog, persist }
interface GoalContext { goalStore, automationLoopStore, goalPlanCommandOptions }
interface ConversationContext { endpointRegistry, conversationPairingStore, ... }
interface ExecutionContext { workbuddyExecution, executionProposalStore }
interface StorageContext { projectStore, teamStore, ... }
```

---

### 3. Refactor Route Handler Architecture
**Effort**: Medium (1-2 weeks)
**Files**: `apps/local-server/src/server.ts`, `apps/local-server/src/routes/`

**Description**: Extract route handlers into separate modules with consistent patterns.

**Steps**:
1. Create `createRouter()` utility
2. Extract each route group into dedicated handler files
3. Move auth, rate-limiting, timeout to middleware
4. Apply consistent response helpers
5. Add route registration tests

---

### 4. Standardize Barrel Exports
**Effort**: Low (3-5 days)
**Files**: All module directories

**Description**: Add `index.ts` barrel exports to all public module directories.

**Target Directories**:
- `storage/` - All store exports
- `conversation/` - Adapters and registries
- `adapters/` - All adapter types
- `model/` - Provider interfaces
- `verification/` - Verification runners
- `security/` - Security utilities

---

### 5. Add Test Fixture Builders
**Effort**: Low (2-3 days)
**Files**: `tests/helpers/`

**Description**: Create shared test fixture builders for common domain objects.

**Fixtures to Create**:
```typescript
// tests/helpers/fixtures.ts
export const fixtures = {
  goal: createGoalFixture(),
  plan: createPlanFixture(),
  project: createProjectFixture(),
  executor: createMockExecutorFixture(),
  // ...
};
```

---

## Medium-Priority Improvements

### 6. Add Integration Test Coverage for Execution Layer
**Effort**: Medium (1 week)
**Files**: `tests/integration/`

**Description**: Add integration tests covering the full execution flow.

**Coverage Areas**:
- Goal -> Plan -> Approve -> Loop Start -> Gate Approval -> Execution -> Audit
- Executor selection and failover
- Error handling and recovery

---

### 7. Implement API Documentation Generator
**Effort**: Low (2-3 days)
**Files**: Build tooling

**Description**: Generate API documentation from JSDoc comments and route definitions.

**Options**:
- OpenAPI/Swagger spec generation
- TypeDoc for code documentation
- Custom route documentation generator

---

### 8. Add Deprecation Strategy
**Effort**: Low (1-2 days)
**Files**: Throughout codebase

**Description**: Establish conventions for API deprecation.

**Pattern to Implement**:
```typescript
/**
 * @deprecated Since v2.x, use `newMethod()` instead. Will be removed in v3.0.
 */
export function oldMethod() {
  console.warn('DEPRECATED: oldMethod() is deprecated');
  return newMethod();
}
```

---

### 9. Improve Error Message Consistency
**Effort**: Low (2-3 days)
**Files**: `apps/local-server/src/routes/`

**Description**: Standardize error response format across all endpoints.

**Current Issue**: Some endpoints return `{ status: 'error', message: ... }`, others return `{ ok: false, error: ... }`

**Recommendation**: Choose one pattern and migrate:
```typescript
// Consistent format
{ ok: false, error: { code: string, message: string } }
```

---

### 10. Add Health Check Metrics
**Effort**: Low (1-2 days)
**Files**: `apps/local-server/src/routes/health.ts`

**Description**: Expand health endpoint with system metrics.

**Metrics to Add**:
- Memory usage
- Active connections
- Store sizes
- Executor health summary

---

## Low-Priority Improvements

### 11. Add JSDoc to Public API Methods
**Effort**: Medium (ongoing)
**Files**: Throughout codebase

**Description**: Ensure all public methods have JSDoc documentation.

---

### 12. Add Conventional Commits Validation
**Effort**: Low (1 day)
**Files**: Git hooks, CI

**Description**: Enforce conventional commit format in pre-commit hook or CI.

---

### 13. Create ADR Index
**Effort**: Low (1 day)
**Files**: `docs/adr/`

**Description**: Create index document linking all ADRs with status.

---

### 14. Add Module Dependency Graph
**Effort**: Low (1-2 days)
**Files**: Documentation tooling

**Description**: Generate visual dependency graph for architecture documentation.

---

### 15. Performance Benchmark Suite
**Effort**: Medium (1 week)
**Files**: `tests/benchmarks/`

**Description**: Add benchmarks for critical paths:
- Store operations
- Route handler latency
- Executor dispatch overhead

---

## Quick Wins (Effort < 1 day)

1. **Add .editorconfig** - Ensure consistent editor settings
2. **Add .npmrc** - Configure npm/pnpm behavior
3. **Document error codes** - Create error code reference
4. **Add runbook index** - Link all operational runbooks
5. **Create architecture diagram** - Visual representation of components

---

## Summary Table

| Category | Item | Effort | Priority |
|----------|------|--------|----------|
| DI Container | Implement DI | High | P0 |
| Architecture | Split BridgeRuntime | Medium | P0 |
| Routes | Refactor handlers | Medium | P1 |
| Exports | Barrel exports | Low | P1 |
| Testing | Fixture builders | Low | P1 |
| Testing | Integration tests | Medium | P2 |
| Docs | API documentation | Low | P2 |
| Patterns | Deprecation strategy | Low | P2 |
| Errors | Consistency | Low | P2 |
| Health | Metrics | Low | P2 |
| Docs | JSDoc | Medium | P3 |
| Git | Conventional commits | Low | P3 |
| Docs | ADR index | Low | P3 |
| Docs | Dependency graph | Low | P3 |
| Performance | Benchmarks | Medium | P3 |

**Total Items**: 15+
**Estimated Total Effort**: 6-8 weeks for all items
