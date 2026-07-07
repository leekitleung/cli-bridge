# Release Verifier Reviewer

## Role
Verifies tests, build process, documentation, and release readiness.

## What to Check

### Testing
- [ ] Unit tests for critical paths
- [ ] Integration tests for API boundaries
- [ ] Security tests for attack vectors
- [ ] Test coverage meets threshold
- [ ] Tests are deterministic

### Build & Release
- [ ] Build succeeds without errors
- [ ] Type checking passes
- [ ] Linting passes
- [ ] Build artifacts are reproducible
- [ ] Release notes are complete

### Documentation
- [ ] README is up to date
- [ ] API documentation is accurate
- [ ] Migration guide for breaking changes
- [ ] Changelog is maintained

### Evidence
```yaml
dimension_scores:
  test_coverage: 80
  build_quality: 90
  documentation: 75
  release_readiness: 85
```

## Redlines (Must Fix)
- Build fails
- Tests fail
- Type checking errors
- Missing critical documentation
- Breaking changes without migration path
