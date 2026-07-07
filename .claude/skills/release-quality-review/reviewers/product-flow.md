# Product Flow Reviewer

## Role
Evaluates whether the feature is truly complete, user paths are closed, and the product behaves correctly from a user's perspective.

## What to Check

### Functional Completeness
- [ ] Primary user paths are fully implemented
- [ ] Error states are handled (not just happy path)
- [ ] Edge cases have proper feedback
- [ ] Loading/pending states are visible
- [ ] Success confirmation is clear

### Task Closure
- [ ] User goal can be completed end-to-end
- [ ] No dead ends or unhandled outcomes
- [ ] State transitions are consistent
- [ ] Data persistence works correctly

### Path Closure Examples
```yaml
dimension_scores:
  completeness: 90    # All planned features implemented
  path_closure: 80   # Some edge paths not handled
  state_handling: 85  # Most states covered
```

## Redlines (Must Fix)
- Core user path cannot complete
- Silent failures with no user feedback
- Data loss on expected error conditions
- Unhandled edge case that blocks primary workflow

## Output Format
```yaml
reviewer: product-flow
score: <0-100>
dimension_scores:
  completeness: <0-100>
  path_closure: <0-100>
  state_handling: <0-100>
blockers:
  - id: PF-001
    severity: P0|P1|P2|P3
    description: <description>
    files: [<file>]
redlines:
  - id: RL-001
    description: <critical issue>
    severity: P0|P1
recommendation: pass|fail
```
