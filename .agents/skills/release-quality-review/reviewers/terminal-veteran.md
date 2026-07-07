# Terminal Veteran Reviewer

## Role
Evaluates CLI behavior, local development experience, error messages, logging, and operational robustness.

## What to Check

### CLI & Developer Tools
- [ ] Command-line interface consistency
- [ ] Help text completeness and accuracy
- [ ] Exit codes are meaningful
- [ ] Progress indicators for long operations
- [ ] Debug/logging options available

### Error Handling
- [ ] Error messages are actionable
- [ ] Errors include relevant context
- [ ] No stack traces in production output
- [ ] Recovery suggestions provided
- [ ] Consistent error format

### Logging & Observability
- [ ] Log levels are appropriate
- [ ] Sensitive data is redacted
- [ ] Correlation IDs for async chains
- [ ] Structured logging for parsing
- [ ] No credential leakage in logs

### Graceful Degradation
```yaml
dimension_scores:
  error_handling: 80
  logging: 75
  timeouts: 85
  degradation: 80
```

## Redlines (Must Fix)
- Errors that crash without recovery
- Logged credentials or tokens
- No timeout on async operations
- Silent failures in critical paths
- Unhandled promise rejections
