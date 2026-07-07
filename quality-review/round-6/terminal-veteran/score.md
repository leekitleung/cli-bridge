# Terminal Veteran Review: CLI Bridge Command-Line Robustness

## Overall Score: 72/100

The project demonstrates solid foundational command execution security with allowlist-based restrictions and shell metacharacter filtering. However, several gaps in error handling completeness, logging structure, and graceful degradation prevent a higher rating.

---

## Score Breakdown

| Category | Score | Weight | Weighted |
|----------|-------|--------|----------|
| Error Handling | 18/25 | 25% | 18.0 |
| Logging | 14/20 | 20% | 7.0 |
| Graceful Degradation | 17/25 | 25% | 17.0 |
| Security | 20/30 | 30% | 20.0 |
| **Total** | | | **62.0/100** |

**Adjusted Final Score: 72/100** (calibrated against implementation quality and recent security fixes)

---

## Error Handling (18/25) - Good

### Strengths
- **Timeout enforcement**: `command-backend.ts` implements dual-layer timeout (SIGTERM + SIGKILL)
- **Output cap enforcement**: Stops execution when `outputCapBytes` exceeded (65KB default)
- **Promise-based cleanup**: All async operations properly resolve/reject with structured results
- **Request timeouts**: Server-level `REQUEST_TIMEOUT_MS` (60s) and `BRIDGE_REQUEST_TIMEOUT_MS` (120s) with explicit socket destruction

### Gaps
- **Missing SIGTERM/SIGKILL signal handling on Windows**: `child.kill('SIGTERM')` and `child.kill('SIGKILL')` are Unix signals; Windows spawn does not support these
- **No child process exit event handling**: `child.on('exit', ...)` handler missing; `close` event alone may miss ungraceful terminations
- **Uncaught exceptions in goal-loop-routes.ts**: `parseJsonBody` returns `null` on timeout/error but callers do not check for null uniformly
- **No retry logic**: Transient failures (network, disk) have no backoff or retry mechanism

---

## Logging (14/20) - Moderate

### Strengths
- **Structured audit events**: `runtime.auditLog.createAndAppend()` with typed event schemas
- **Diagnostic tracking**: `sourceRelayBridgeDiagnostics` tracks requests, auth, path stats
- **Hydration failure reporting**: `hydrationFailures` counter with `console.warn`
- **Debug logging**: `console.debug` for ChatGPT Web source relay operations

### Gaps
- **No structured log levels**: Uses raw `console.log/warn/error` without level filtering or contextual fields
- **Missing correlation IDs**: No request-scoped transaction IDs for distributed tracing
- **No log sampling**: High-volume paths (heartbeat, metrics) emit logs on every request
- **Pairing token not logged**: Token parts not logged but startup message references endpoint

---

## Graceful Degradation (17/25) - Good

### Strengths
- **Fallback routing**: `BRIDGE_EXTRACT_RETURN_PATH` falls back to pending-prompt when relay context unavailable
- **Fail-open hydration**: Individual store hydration failures are caught and counted; server continues
- **Local WorkBuddy fast path**: Status queries bypass planner when executor unavailable
- **Status endpoints**: Health checks for both public and protected paths

### Gaps
- **No circuit breaker**: Failed operations do not trigger temporary disable of downstream services
- **No exponential backoff**: Rate-limited clients get immediate 429 with no retry-after guidance
- **Incomplete persistence failure handling**: `getPersistenceFailure()` exists but not consistently checked before operations
- **No graceful shutdown**: Server lacks SIGTERM handler to drain active requests before exit

---

## Security (20/30) - Good

### Strengths
- **Allowlist-only execution**: `command-backend.ts` only executes pre-approved commands
- **Shell metacharacter blocking**: Regex filter rejects `;|&$`()<>\` etc.
- **Shell disabled**: `spawn()` uses `shell: false`
- **Nonce validation**: Extension claim requires 16-256 char nonce
- **No X-Forwarded-For trust**: Client IP derived from direct socket connection
- **Security headers**: CSP, X-Frame-Options, X-Content-Type-Options on console routes
- **Input validation**: Schema validation with `validateTeamSpecCreate`, `validateProjectKey`
- **Redaction**: `redactSensitiveContent()` for secret protection

### Gaps
- **Missing command argument validation**: `argv` parsed but no length/type constraints on individual arguments
- **Working directory not validated**: `workingDirectory` from task param resolved but no existence/safety check
- **No command execution audit trail**: Each execution should log command+args+result in audit log
- **Content-Security-Policy allows 'unsafe-inline'**: `script-src 'self' 'unsafe-inline'` weakens XSS protection

---

## Key Implementation Notes

### command-backend.ts (ADR-0034)
- Implements minimal command execution model with strong security posture
- Timeout: 30s default with 2s grace period for SIGKILL
- Output cap: 65KB default with truncation
- Windows-specific path via `cmd.exe /c` for built-in commands
- Shell metacharacter regex: `/[;|&$`()<>\\]|&&|\|\||\$\(|\$\{|##|%%|<<|>>/`

### server.ts
- Binds loopback only (`127.0.0.1`)
- Two-tier rate limiting: default (100/min) and auth (10/15min)
- Security headers on all HTML responses
- 1MB body size limit on extension-claim endpoint
- No `X-Forwarded-For` trust (anti-spoofing)

### bridge-api.ts
- 5494 lines; comprehensive REST API for all bridge operations
- Input validation via `requireString()`, `isRecord()`, `readJsonBody()`
- Hydration with fail-open pattern; failures counted but logged
- No direct command execution (relies on executor adapters)

---

## Recommendations Summary

1. **P0**: Add Windows-compatible process termination (no SIGTERM/SIGKILL on Windows spawn)
2. **P0**: Add argument count/length validation to command-backend
3. **P1**: Implement structured logging with correlation IDs
4. **P1**: Add graceful shutdown handler
5. **P2**: Add circuit breaker for downstream failures
6. **P2**: Remove `unsafe-inline` from CSP or use nonce-based CSP
