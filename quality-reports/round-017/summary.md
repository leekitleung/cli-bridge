# Quality Review Summary - Round 17

**Profile:** agentic-release-gate
**Generated:** 2026-07-08T11:00:27.266Z
**Git:** "" @ ""
## Automated Gate Checks

| Check | Status | Details |
|-------|--------|--------|
| pnpm test | ✅ pass | Tests passed |
| pnpm typecheck | ✅ pass | Typecheck passed |
| File sizes | ✅ 0 oversized | OK |
| Circular deps | ✅ | None found |
| Secrets scan | ✅ | Clean |

---

## Scores

| Reviewer | Score | Status | Blockers |
|----------|-------|--------|----------|
| product-flow | 98/100 | ✅ PASS | - |
| release-verifier | 98/100 | ✅ PASS | - |
| destructive-qa | 95/100 | ✅ PASS | - |
| adversarial-completion | 98/100 | ✅ PASS | - |
| evidence-integrity | 98/100 | ✅ PASS | - |
| goal-compliance | 98/100 | ✅ PASS | - |
| regression-risk | 98/100 | ✅ PASS | - |
| handoff-integrity | 75/100 | ❌ FAIL | - |

**Total:** 7/8 passed, 0 blockers

---

## ❌ QUALITY GATE FAILED

This release has not passed quality gates. Fix the issues below and re-run review.

**To continue:**
```bash
node skills/release-quality-review/scripts/review-runner.mjs --profile agentic-release-gate --round 18
```

