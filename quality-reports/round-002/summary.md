# Quality Review Summary - Round 2

**Profile:** default
**Generated:** 2026-07-08T02:58:27.172Z
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
| product-flow | 82/100 | ❌ FAIL | ⚠ 1 |
| destructive-qa | 82/100 | ❌ FAIL | ⚠ 1 |
| terminal-veteran | 85/100 | ❌ FAIL | ⚠ 1 |

**Total:** 0/3 passed, 3 blockers

## Blockers Detail

- **product-flow:** id: PF-001
- **destructive-qa:** id: DQA-001
- **terminal-veteran:** id: TV-001

---

## ❌ QUALITY GATE FAILED

This release has not passed quality gates. Fix the issues below and re-run review.

**To continue:**
```bash
node skills/release-quality-review/scripts/review-runner.mjs --profile default --round 3
```

**Top priorities to fix:**

1. [product-flow] id: PF-001
2. [destructive-qa] id: DQA-001
3. [terminal-veteran] id: TV-001
