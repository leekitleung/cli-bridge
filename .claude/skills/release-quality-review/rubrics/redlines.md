# Redlines - Critical Quality Issues

Redlines are **blocking issues** that MUST be fixed before the task can be considered complete. Unlike P1 blockers which may be addressed in follow-up PRs, redlines represent fundamental quality failures.

## Redline Categories

### Security Redlines
- [ ] Command injection vector exists
- [ ] Authentication bypass possible
- [ ] Credentials logged in plaintext
- [ ] SQL/NoSQL injection possible
- [ ] XSS vector in user content

### Functional Redlines
- [ ] Core user path cannot complete
- [ ] Data loss on expected failure
- [ ] Silent failure with no feedback
- [ ] Race condition in critical path

### Quality Redlines
- [ ] God file (>1000 lines) introduced
- [ ] Circular dependency introduced
- [ ] No tests for critical path
- [ ] Build fails

### UX Redlines
- [ ] Primary UI is unusable
- [ ] No error messages for failures
- [ ] Clickable elements invisible

## Redline Detection Pattern

```yaml
redlines:
  - id: RL-001
    description: Command injection via shell:true in user input
    severity: P0
    evidence:
      file: apps/local-server/src/execution/opencode-executor.ts
      line: 127
      type: code
```

## Redline vs Blocker

| Aspect | Redline | Blocker |
|--------|---------|---------|
| Severity | P0 only | P0, P1, P2, P3 |
| Fix timing | Before this PR | Can be follow-up |
| Gate impact | Hard fail | Soft fail (score drop) |
| Auto-fix | Required | Optional |
