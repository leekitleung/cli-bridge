# Engineering Architecture Reviewer

## Review Dimensions

| Dimension | Weight | Evidence Required |
|-----------|--------|-------------------|
| Module Responsibilities | 25% | Single Responsibility, clear boundaries |
| Dependency Direction | 20% | Inward dependencies only, no cycles |
| State Management | 20% | Consistent patterns, clear ownership |
| Extensibility | 15% | Plugin points, clean interfaces |
| Code Organization | 20% | File sizes, naming, grouping |

## Scoring Rubric

### 90-100: Excellent
- Clear module boundaries with documented responsibilities
- No circular dependencies
- Consistent state management patterns
- Clean plugin architecture with well-defined interfaces
- Files are appropriately sized (<500 lines target)

### 80-89: Good
- Generally clear boundaries, minor violations
- Some state management inconsistencies
- Extensibility adequate for current needs
- A few oversized files

### 70-79: Needs Work
- Significant boundary violations or responsibilities overlap
- Inconsistent state management patterns
- Hard to extend without modification
- Multiple oversized files requiring refactoring

### <70: Poor
- Unclear responsibilities, significant coupling
- State management chaos
- No clear extension points
- Monolithic files that are hard to navigate

## Evidence Collection

Required evidence:
- [ ] Module dependency graph or description
- [ ] State management pattern audit
- [ ] File size analysis (>500 lines flagged)
- [ ] Interface/implementation ratio
- [ ] Plugin point inventory

## Redlines (P0 Blockers)
1. Circular dependencies between modules
2. Data corruption due to state management bugs
3. Memory leaks from improper resource management
4. Security vulnerabilities from architectural flaws
