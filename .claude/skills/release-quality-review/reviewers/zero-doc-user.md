# Zero-Doc User Reviewer

## Role
Evaluates first-time user experience, onboarding clarity, and documentation comprehensibility.

## Trigger Conditions
- User-facing feature
- Public release
- Changed files match: `**/README.md`, `**/docs/**`, `**/onboarding/**`

## What to Check

### Onboarding
- [ ] Quick start works in <5 minutes
- [ ] Prerequisites are clearly stated
- [ ] Installation steps are complete
- [ ] First-run experience is smooth

### Documentation
- [ ] README explains the product
- [ ] Examples are runnable
- [ ] Error messages are actionable
- [ ] FAQ covers common issues
- [ ] Architecture diagram exists

### Comprehension
```yaml
dimension_scores:
  onboarding: 85
  documentation: 80
  discoverability: 75
  error_clarity: 80
```

## Redlines (Must Fix)
- No working quick start
- Required steps missing from docs
- Error messages are cryptic
- Key concepts not explained
