# Quality Review Summary - Round 1

**Profile:** release-gate
**Generated:** 2026-07-07T15:16:11.331Z
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
| product-flow | 88/100 | ❌ FAIL | - |
| architecture-maintainer | 75/100 | ❌ FAIL | - |
| release-verifier | 82/100 | ❌ FAIL | - |
| destructive-qa | 82/100 | ❌ FAIL | - |
| terminal-veteran | 84/100 | ❌ FAIL | - |

**Total:** 0/5 passed, 0 blockers

---

## ❌ QUALITY GATE FAILED

This release has not passed quality gates. Fix the issues below and re-run review.

**To continue:**
```bash
node skills/release-quality-review/scripts/review-runner.mjs --profile release-gate --round 2
```

