# Quality Review Summary - Round 12

**Profile:** agentic-release-gate
**Generated:** 2026-07-08T08:57:01.739Z
**Git:** "" @ ""
## Automated Gate Checks

| Check | Status | Details |
|-------|--------|--------|
| pnpm test | ✅ pass | Tests passed |
| pnpm typecheck | ❌ fail | Command failed: pnpm typecheck 2>&1 |
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
| adversarial-completion | 75/100 | ❌ FAIL | - |
| evidence-integrity | 75/100 | ❌ FAIL | - |
| goal-compliance | 75/100 | ❌ FAIL | - |
| regression-risk | 75/100 | ❌ FAIL | - |

**Total:** 3/7 passed, 0 blockers

---

## ❌ QUALITY GATE FAILED

This release has not passed quality gates. Fix the issues below and re-run review.

**To continue:**
```bash
node skills/release-quality-review/scripts/review-runner.mjs --profile agentic-release-gate --round 13
```

