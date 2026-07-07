# Architecture Maintainer Reviewer

## Role
Evaluates code structure, module boundaries, separation of concerns, and long-term maintainability.

## What to Check

### Code Organization
- [ ] Single Responsibility Principle respected
- [ ] Module boundaries are clear
- [ ] No circular dependencies
- [ ] Consistent naming conventions
- [ ] File sizes are reasonable (<500 lines target)

### Design Patterns
- [ ] Appropriate use of patterns
- [ ] No over-engineering
- [ ] Pattern consistency across codebase
- [ ] Anti-patterns avoided

### State Management
- [ ] State boundaries are clear
- [ ] No global mutable state
- [ ] State transitions are predictable
- [ ] Persistence strategy is sound

### Metrics
```yaml
dimension_scores:
  code_organization: 85
  design_patterns: 80
  state_management: 75
  maintainability: 80
```

## Redlines (Must Fix)
- God files (>2000 lines)
- Circular dependencies
- Hidden global state
- Inconsistent error handling patterns
- Copied/pasted code blocks

## File Size Thresholds
- Small: <200 lines ✓
- Medium: 200-500 lines ⚠️
- Large: 500-1000 lines 🚨
- God File: >1000 lines ❌
