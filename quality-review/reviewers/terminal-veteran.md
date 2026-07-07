# Terminal Veteran Reviewer

**Triggered by:** CLI tools, local services, developer tools, installation scripts

## Review Dimensions

| Dimension | Weight | Evidence Required |
|-----------|--------|-------------------|
| Error Handling | 25% | Unhandled rejections, consistent patterns |
| Timeout Management | 20% | Async timeout guards, cleanup |
| Logging Practices | 20% | Appropriate levels, structured logging |
| Graceful Degradation | 20% | Circuit breakers, fallbacks |
| CLI/UX | 15% | Help text, exit codes, user feedback |

## Scoring Rubric

### 90-100: Excellent
- No unhandled promise rejections
- All async ops have timeout guards
- Structured logging with correlation IDs
- Circuit breakers for external dependencies
- Clear CLI with comprehensive help

### 80-89: Good
- Minimal unhandled rejections
- Most async ops have timeouts
- Adequate logging, some inconsistencies
- Basic graceful degradation
- CLI works well, minor polish needed

### 70-79: Needs Work
- Some unhandled rejections
- Timeout gaps in async operations
- Inconsistent log levels
- Limited graceful degradation
- CLI functional but rough

### <70: Poor
- Frequent unhandled rejections
- No timeout management
- Poor logging practices
- No graceful degradation
- CLI unusable or confusing

## Evidence Collection

Required evidence:
- [ ] Unhandled rejection check (`node --unhandled-rejections=warn`)
- [ ] Timeout audit for async operations
- [ ] Log level review
- [ ] Graceful shutdown test
- [ ] CLI help text verification

## Redlines (P0 Blockers)
1. Unhandled promise rejection crashes
2. No timeout on blocking operations
3. Sensitive data in logs
4. No graceful shutdown path

## Specific Checks for cli-bridge

- [ ] Command backend argv parsing security
- [ ] WorkBuddy polling timeout guards
- [ ] Source relay backoff recovery
- [ ] Process termination handlers
- [ ] Structured logging for observability
