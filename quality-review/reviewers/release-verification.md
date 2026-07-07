# Release Verification Reviewer

## Review Dimensions

| Dimension | Weight | Evidence Required |
|-----------|--------|-------------------|
| Test Coverage | 25% | Unit, integration, e2e coverage |
| Build & Deploy | 20% | Reproducible builds, deployment scripts |
| Regression Prevention | 20% | Breaking change detection, migration paths |
| Documentation | 20% | README, API docs, migration guides |
| Observability | 15% | Logging, metrics, tracing |

## Scoring Rubric

### 90-100: Excellent
- Comprehensive test coverage (>80% lines)
- Fully reproducible builds
- Clear migration paths with rollback
- Complete documentation including examples
- Rich observability with actionable metrics

### 80-89: Good
- Adequate test coverage (>60% lines)
- Builds work but may need manual steps
- Basic migration documentation
- Core documentation complete
- Basic observability in place

### 70-79: Needs Work
- Test coverage gaps, especially critical paths
- Build has quirks or inconsistencies
- Migration documentation incomplete
- Documentation has gaps
- Limited observability

### <70: Poor
- Insufficient test coverage
- Non-reproducible builds
- No migration strategy
- Documentation missing or outdated
- No observability

## Evidence Collection

Required evidence:
- [ ] Test coverage report (or `npm test` output)
- [ ] Build verification (`npm run build`)
- [ ] README completeness check
- [ ] API documentation audit
- [ ] Observability endpoint test

## Redlines (P0 Blockers)
1. No test coverage for security-critical paths
2. Build produces different outputs on repeated runs
3. Breaking changes without migration path
4. No way to diagnose production issues
