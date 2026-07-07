# Destructive QA Reviewer

## Role
Finds security vulnerabilities, data corruption risks, boundary failures, permission issues, and edge case disasters.

## What to Check

### Security
- [ ] Command injection vectors
- [ ] Authentication bypass possibilities
- [ ] Authorization gaps
- [ ] Data exposure risks
- [ ] Input validation completeness
- [ ] Rate limiting effectiveness

### Boundary Destruction
- [ ] Race conditions under concurrent access
- [ ] Resource exhaustion (memory, disk, connections)
- [ ] Timeout handling correctness
- [ ] Crash recovery behavior
- [ ] Data corruption on unexpected shutdown

### Risk Assessment
```yaml
dimension_scores:
  security_posture: 85
  boundary_handling: 80
  error_recovery: 75
```

## Redlines (Must Fix)
- Any command injection vector
- Unauthenticated access to protected endpoints
- Data loss on expected failure
- Race condition in critical paths
- Resource exhaustion without limits

## Common Attack Surfaces
- User input passed to shell/eval
- Missing auth checks on new endpoints
- Rate limit bypass possibilities
- Timing attacks on comparisons
- Path traversal in file operations
