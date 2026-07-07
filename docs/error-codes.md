# CLI Bridge Error Code Reference

This document provides a comprehensive reference for all error codes in the CLI Bridge system.

## Error Response Format

All API errors follow this format:

```typescript
{
  ok: false,
  error: string,  // User-friendly message
  code?: string,  // Machine-readable error code
  details?: unknown  // Additional context
}
```

---

## Authentication & Authorization Errors

| Code | HTTP Status | Description | Resolution |
|------|-------------|-------------|------------|
| `auth-missing-token` | 401 | No pairing token provided | Provide a valid pairing token in the `X-Pairing-Token` header |
| `auth-invalid-token` | 403 | Pairing token is invalid or expired | Re-authenticate with the Project Console |
| `auth-origin-forbidden` | 403 | Request origin not allowed | Ensure requests come from allowed origins (localhost) |
| `auth-session-expired` | 401 | Extension or console session has expired | Re-establish the session via the extension or console |

---

## Execution Errors

### Command Backend Errors (`command-backend.ts`)

| Code | HTTP Status | Description | Resolution |
|------|-------------|-------------|------------|
| `command-empty-prompt` | 400 | Empty command prompt provided | Provide a non-empty command string |
| `command-not-allowed` | 403 | Command not in allowlist | Use only whitelisted commands |
| `command-shell-metacharacter` | 400 | Shell metacharacters detected | Do not use shell operators like `;`, `|`, `&`, `$()`, etc. |
| `command-parse-error` | 400 | Failed to parse command | Check command syntax |
| `command-timeout` | 408 | Command execution timed out | Increase timeout or optimize command |
| `command-output-exceeded` | 413 | Output exceeds size limit (10MB) | Reduce output size |
| `command-killed` | 500 | Process was killed by signal | Check system resources |
| `command-spawn-error` | 500 | Failed to spawn process | Check system configuration |

### Executor Errors

| Code | HTTP Status | Description | Resolution |
|------|-------------|-------------|------------|
| `no-available-executor` | 503 | No executor backend is available | Register an executor (WorkBuddy, OpenCode) |
| `executor-error` | 500 | Executor threw an error | Check executor logs |
| `executor-unhealthy` | 503 | Executor failed health check | Restart the executor service |
| `executor-timeout` | 408 | Executor task timed out | Increase timeout |

---

## Review Errors (`review-result-parser.ts`)

| Code | HTTP Status | Description | Resolution |
|------|-------------|-------------|------------|
| `review-result-invalid-json` | 400 | Review result is not valid JSON | Ensure the result is properly formatted |
| `review-result-not-object` | 400 | Review result is not a JSON object | Provide a valid object |
| `review-result-forbidden-field` | 400 | Review result contains forbidden fields | Remove sensitive or internal fields |
| `review-result-invalid` | 400 | Review result validation failed | Check the result format |

---

## Endpoint Registry Errors

| Code | HTTP Status | Description | Resolution |
|------|-------------|-------------|------------|
| `endpoint-not-found` | 404 | Requested endpoint does not exist | Check the endpoint ID |
| `endpoint-offline` | 503 | Endpoint is offline or unavailable | Wait for endpoint to come online |
| `endpoint-already-offline` | 409 | Endpoint is already marked offline | No action needed |
| `duplicate-endpoint-id` | 409 | Endpoint ID already registered | Use a unique endpoint ID |
| `capability-denied` | 403 | Endpoint lacks required capability | Use an endpoint with the needed capability |

---

## Goal & Plan Errors

| Code | HTTP Status | Description | Resolution |
|------|-------------|-------------|------------|
| `goal-not-found` | 404 | Goal ID does not exist | Verify the goal ID |
| `goal-not-approved` | 400 | Goal is not in approved state | Approve the goal before execution |
| `plan-not-found` | 404 | Plan ID does not exist | Verify the plan ID |
| `plan-not-draft` | 400 | Plan is not in draft state | Create a new plan or reset existing |
| `step-not-found` | 404 | Step ID does not exist | Verify the step ID |
| `step-tier-violation` | 400 | Step tier exceeds allowed limit | Use lower-tier steps |
| `step-ceiling-reached` | 400 | Maximum step count reached | Start a new goal or increase ceiling |

---

## Queue & Relay Errors

| Code | HTTP Status | Description | Resolution |
|------|-------------|-------------|------------|
| `queue-empty` | 204 | No pending items in queue | Wait for new items |
| `queue-claim-failed` | 409 | Item already claimed by another | Retry or wait for next item |
| `relay-no-context` | 400 | No return context available | Ensure bidirectional relay is configured |
| `relay-endpoint-cannot-receive` | 400 | Target endpoint cannot receive | Use manual confirmation mode |
| `relay-connection-failed` | 503 | Failed to connect to relay | Check network and endpoints |

---

## Persistence Errors

| Code | HTTP Status | Description | Resolution |
|------|-------------|-------------|------------|
| `persistence-unavailable` | 503 | Storage persistence is unavailable | Check disk space and permissions |
| `persistence-hydration-failed` | 500 | Failed to restore persisted state | Check data files integrity |
| `persistence-commit-failed` | 500 | Failed to persist state | Check disk space |

---

## Loop & Automation Errors

| Code | HTTP Status | Description | Resolution |
|------|-------------|-------------|------------|
| `loop-not-found` | 404 | Loop ID does not exist | Verify the loop ID |
| `loop-already-running` | 409 | Loop is already running | Stop existing loop first |
| `loop-timeout` | 408 | Loop exceeded deadline | Increase deadline or optimize steps |
| `gate-approval-required` | 202 | Step requires gate approval | Approve via `/loop/approve` endpoint |
| `verification-failed` | 400 | Step output verification failed | Check output matches expected result |

---

## Rate Limiting Errors

| Code | HTTP Status | Description | Resolution |
|------|-------------|-------------|------------|
| `rate-limit-exceeded` | 429 | Too many requests | Wait and retry after `Retry-After` seconds |
| `rate-limit-no-entry` | 500 | Internal rate limit error | Retry request |

---

## Common Troubleshooting

### Authentication Issues

1. **Missing token error**: Ensure the extension is paired with the server
2. **Invalid token**: Clear browser storage and re-pair
3. **CORS errors**: Ensure requests are from localhost

### Execution Issues

1. **Command not allowed**: Check `ALLOWED_COMMANDS` in configuration
2. **Timeout errors**: Increase `timeoutMs` in task options
3. **Output too large**: Implement streaming or pagination

### Queue Issues

1. **Queue empty**: Wait for upstream processes to produce items
2. **Claim conflicts**: Implement exponential backoff retry
3. **Relay failures**: Check both endpoints are online

---

## Adding New Error Codes

When adding new error codes:

1. Use lowercase with hyphens (e.g., `my-new-error`)
2. Document in this file with description and resolution
3. Use consistent HTTP status codes (see table above)
4. Include machine-readable `code` in API responses
5. Provide user-friendly `error` message with resolution hints

---

*Last updated: 2026-07-07*
