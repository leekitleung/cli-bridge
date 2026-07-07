# Product Flow Blockers - Round 6

## P0 Blockers (Critical - Must Fix)

### 1. BridgeRuntime God Object Anti-Pattern
**File**: `apps/local-server/src/routes/bridge-api.ts`
**Lines**: ~200+ lines in BridgeRuntime interface

**Issue**: The `BridgeRuntime` interface contains 40+ properties, creating:
- Massive mocking burden for tests
- Implicit coupling between unrelated modules
- Difficult-to-reason-about dependency graph
- Risk of breaking changes affecting many consumers

**Impact**: 
- New features requiring new stores/context require modifying the central interface
- Test fixtures require constructing full `BridgeRuntime` with 40+ properties
- Component reuse across different runtime configurations is nearly impossible

**Recommendation**: 
Split into focused contexts:
```typescript
// Core context - always available
interface CoreContext {
  packetStore: InMemoryPacketStore;
  auditLog: InMemoryAuditLog;
  persist: () => void;
}

// Goal context - for goal-driven execution
interface GoalContext {
  goalStore: InMemoryGoalStore;
  automationLoopStore: InMemoryAutomationLoopStore;
}

// Conversation context - for multi-source routing
interface ConversationContext {
  conversationPairingStore: InMemoryConversationPairingStore;
  endpointRegistry: InMemoryEndpointRegistry;
  // ... etc
}
```

---

### 2. Monolithic Route Handler in server.ts
**File**: `apps/local-server/src/server.ts`
**Lines**: 530+ lines, single `requestHandler` function

**Issue**: All routing logic is in one function with mixed concerns:
- Authentication logic (checkAuth)
- Rate limiting
- Request timeout handling
- Route matching
- Response writing

**Impact**:
- Difficult to test individual routes in isolation
- Adding new routes requires modifying large function
- Hard to follow control flow

**Recommendation**: 
Implement router pattern:
```typescript
// Extract routes into separate modules
const router = createRouter();
router.post('/bridge/goals/:goalId/loop/start', handleGoalLoopStart);
router.get('/bridge/executors', handleExecutors);
// ... etc
```

---

## P1 Blockers (High - Should Fix)

### 3. Missing Dependency Injection Container
**Files**: Throughout codebase

**Issue**: Classes directly instantiate dependencies:
```typescript
// goal-loop-runner.ts
this.registry = getExecutorRegistry();
this.dispatcher = createExecutionDispatcher(this.registry);
```

This pattern:
- Prevents swapping implementations for testing
- Creates implicit dependencies not visible in constructor
- Makes global state harder to reason about

**Impact**:
- Unit tests must mock global singletons
- Component reuse is limited
- Runtime configuration is inflexible

**Recommendation**:
Implement simple DI container or use constructor injection consistently:
```typescript
constructor(
  private readonly registry: ExecutorRegistry,
  private readonly dispatcher: ExecutionDispatcher,
) {}
```

---

### 4. Inconsistent Store Access Patterns
**Files**: Throughout codebase

**Issue**: Mixed patterns for accessing stores and registries:
- Direct property: `runtime.goalStore.getGoal(id)`
- Singleton getter: `getExecutorRegistry()`
- Factory function: `createGoalLoopRunner(runtime, options)`

**Impact**:
- Inconsistent API surface
- Harder to mock in tests
- Unclear ownership of instances

**Recommendation**:
Standardize on constructor injection with optional factory defaults:
```typescript
class SomeService {
  constructor(
    private goalStore: GoalStore, // Required
    private registry: ExecutorRegistry = getExecutorRegistry(), // Optional default
  ) {}
}
```

---

### 5. Circular Dependency via Dynamic Imports
**File**: `apps/local-server/src/routes/goal-loop-routes.ts`

**Issue**:
```typescript
export async function handleExecutorsRequest(...) {
  const { getExecutorRegistry } = await import('../execution/executor-registry.ts');
  // ...
}
```

**Impact**:
- Hides import dependencies
- Module load order becomes significant
- Potential for runtime errors if import order changes

**Recommendation**:
Use static imports and restructure module boundaries if circular dependencies exist:
```typescript
import { getExecutorRegistry } from '../execution/executor-registry.ts';
```

---

## P2 Blockers (Medium - Nice to Fix)

### 6. No Barrel Export Standards
**Files**: Throughout codebase

**Issue**: Some directories have `index.ts` (e.g., `execution/index.ts`), others don't, forcing deep imports:
```typescript
// Without barrel
import { ExecutorRegistry } from '../execution/executor-registry.ts';

// With barrel
import { ExecutorRegistry } from '../execution';
```

**Recommendation**:
Add `index.ts` to all public module directories following pattern from `execution/`:
```typescript
// storage/index.ts
export * from './goal-store.ts';
export * from './project-store.ts';
// etc
```

---

### 7. Test Isolation Issues with Global Singletons
**Files**: `tests/unit/executor-registry.test.ts`

**Issue**: Tests must reset global state:
```typescript
test('should allow setting custom registry', () => {
  setExecutorRegistry(custom);
  // ... test
  setExecutorRegistry(new ExecutorRegistry()); // Reset!
});
```

**Recommendation**:
Consider factory functions that don't rely on global state:
```typescript
function createTestContext(overrides?: Partial<Context>): TestContext {
  return {
    registry: overrides?.registry ?? new ExecutorRegistry(),
    // ...
  };
}
```

---

### 8. Missing Test Fixture Builders
**Files**: Throughout test files

**Issue**: Each test manually constructs complex objects:
```typescript
const goal = runtime.goalStore.createGoal({
  id: 'test-goal-1',
  sessionId: 'session-1',
  description: 'Test goal',
});
// Many more lines of setup
```

**Recommendation**:
Create test fixture builders:
```typescript
// tests/helpers/fixtures.ts
export function createTestGoal(overrides?: Partial<CreateGoalInput>): Goal {
  return goalStore.createGoal({
    id: randomUUID(),
    sessionId: 'test-session',
    description: 'Test goal',
    ...overrides,
  });
}
```

---

## Summary

| Priority | Count | Files Affected |
|----------|-------|----------------|
| P0 | 2 | bridge-api.ts, server.ts |
| P1 | 3 | goal-loop-routes.ts, goal-loop-runner.ts, various |
| P2 | 3 | storage/, tests/, various |
| **Total** | **8** | |
