# Round 6: Destructive QA Review Report

**Review Date:** 2026-07-07
**Reviewer:** Claude Code (Destructive QA Reviewer)
**Scope:** Multi-Executor Architecture, Goal Loop, Command Execution

---

## Overall Score: **62 / 100**

The multi-executor architecture has solid shell injection mitigations but has significant gaps in input validation, edge case handling, and chaos engineering coverage.

---

## Category Breakdown

### Security (30% weight) — Score: 21/30

| Sub-category | Score | Notes |
|--------------|-------|-------|
| Shell Injection Prevention | 8/10 | Good: `shell: false`, metacharacter blocking, allowlist |
| Input Validation | 5/10 | Weak: No validation on goalId, planId, executionId parameters |
| XSS / Output Sanitization | 6/10 | Partial: `redactSensitiveContent` used, but inconsistent |
| Permission Bypass | 2/10 | **CRITICAL**: `inboundRelayEndpointId` from options (trusts operator config) |

**Key Findings:**

1. **Shell Metacharacter Detection** (`command-backend.ts:74`): Comprehensive regex covers `;|&$`()<>\\` and compound operators `&&`, `||`, `$()`, `${}`. This is robust.

2. **Working Directory Traversal** (`opencode-executor.ts:90-101`): Path validation ensures `resolvedWorkingDir.startsWith(workspaceRoot + path.sep)`. However, symlink attacks are not addressed.

3. **Allowlist Enforcement** (`command-backend.ts:36-51`): Command allowlist with path resolution. Windows `cmd.exe` is hardcoded as allowed.

4. **Missing Input Validation**: `goalId`, `planId`, `executionId` in HTTP routes are parsed directly without length/sanity checks. An attacker could submit arbitrarily long IDs.

### Edge Cases (25% weight) — Score: 14/25

| Sub-category | Score | Notes |
|--------------|-------|-------|
| Null/Undefined Handling | 4/5 | Most functions handle missing data gracefully |
| Empty String Cases | 3/5 | Empty prompt handled, but empty goalId/planId not validated |
| Concurrent Access | 2/5 | No locking on shared state (executionProposalStore, etc.) |
| Timeout Edge Cases | 3/5 | Timeouts implemented but not consistently |
| Buffer/Overflow | 2/5 | Body size capped at 1MB, output capped at 65KB |

**Key Findings:**

1. **Race Condition in HealthCheck** (`executor-registry.ts:307-321`): Health check runs in interval without coordination. If healthCheck() takes longer than interval, multiple checks can overlap.

2. **Memory Pressure in Polling** (`workbuddy-executor.ts:143-159`): 2-second polling interval could accumulate results if `getResult()` is slow. No backpressure mechanism.

3. **JSON.parse Exception** (`goal-automation-loop.ts:79-84`): `parseGoalLoopConfig` catches parse errors but returns `null` silently. Callers may not handle null config.

### Breaking Changes (25% weight) — Score: 15/25

| Sub-category | Score | Notes |
|--------------|-------|-------|
| API Contract Changes | 4/5 | ExecutorCapabilities extended, but backward compatible |
| Migration Path | 3/5 | No version migration for new execution proposal fields |
| Deprecation Handling | 4/5 | Old endpoints still work, new ones added |
| Cross-Component Impact | 4/5 | Changes to goal-store affect automation loops |

**Key Findings:**

1. **ExecutorRegistry Singleton** (`executor-registry.ts:336-347`): Global singleton pattern makes testing and replacement difficult. `setExecutorRegistry()` exists but is not used in production.

2. **BridgeRuntime Serialization** (`bridge-api.ts:1660-1753`): Hydration failures are logged but not exposed to operators. Silent failures could cause data loss.

3. **SourceAdapterRegistry** (`bridge-api.ts:1617-1626`): Adapters registered dynamically; no adapter versioning.

### Chaos Engineering (20% weight) — Score: 12/20

| Sub-category | Score | Notes |
|--------------|-------|-------|
| Fault Injection | 3/5 | mockMode exists, but no chaos scenarios |
| Graceful Degradation | 4/5 | Falls back to first healthy executor, but no circuit breaker |
| Recovery Testing | 2/5 | No recovery test suite |
| Timeout Behavior | 3/5 | Timeouts exist but no chaos scenarios |

**Key Findings:**

1. **No Chaos Scenarios**: No chaos tests for executor failures, network partitions, or resource exhaustion.

2. **No Circuit Breaker**: If an executor fails repeatedly, no mechanism to temporarily disable it. Health check will continue marking it unhealthy.

3. **No Timeout Jitter**: Fixed poll intervals (2000ms, 5000ms) could cause thundering herd.

---

## Detailed Security Analysis

### Shell Injection Vectors

**Protected:**
- `command-backend.ts:74-83`: Metacharacter regex blocks `;|&$`()<>\\` and compound operators
- `opencode-executor.ts:108-112`: `shell: false` prevents shell interpretation
- `command-backend.ts:120`: `shell: false` enforced

**Potential Bypass:**
- The metacharacter regex does NOT block `\n` (newline). A crafted prompt with newlines could potentially inject commands when `shell: true` is accidentally enabled.
- Symlink traversal in working directory validation: `workspaceRoot` check passes but symlink points outside.

### Input Validation Gaps

```
POST /bridge/goals/:goalId/loop/approve
Body: { "executionId": "..." }

goalId extracted from URL path via regex: /^\/bridge\/goals\/([^/]+)/
No length check, no character validation, no format check
```

Attacker could submit:
- `goalId`: 10KB of repeated characters
- `executionId`: Empty string (validated at line 252)

### Permission Model

The `inboundRelayEndpointId` is set from `options.inboundRelayEndpointId` which comes from server config. This is operator-trusted but could be exploited if:
1. Config file is world-readable
2. Environment variable injection via CI/CD

---

## Recommendations

1. **P0**: Add length limits on all ID fields extracted from HTTP requests
2. **P0**: Add chaos tests for executor failures
3. **P1**: Implement circuit breaker for unhealthy executors
4. **P1**: Add jitter to polling intervals to prevent thundering herd
5. **P2**: Expose hydration failures to operators
6. **P2**: Add symlink detection to path traversal checks
