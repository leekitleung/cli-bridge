# Gate Bypass Test: Redlines Bypass

## Test Setup

Base path: `adversarial-lab/gate-bypass/redlines-bypass/`

## Case 27: RL1 - Non-empty Redlines but Pass Recommendation

**Bypass Assumption:** Gate checks recommendation instead of redlines.

```bash
mkdir -p round-test-rl1/product-flow
cat > round-test-rl1/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 95
status: pass
redlines:
  - P0: Critical security vulnerability
  - P1: Data loss risk
recommendation: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-rl1 --check --profile release-gate
```

**Expected:** Should FAIL - redlines non-empty
**Actual:** ?
**Bypass Success:** ?

---

## Case 28: RL2 - Redlines in Markdown but Empty in YAML

**Bypass Assumption:** Gate only checks YAML redlines field.

```bash
mkdir -p round-test-rl2/product-flow
cat > round-test-rl2/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 95
status: pass
redlines: []
recommendation: pass
EOF
cat > round-test-rl2/product-flow/score.md << 'EOF'
# Product Flow Review

## Overall Score: 95/100

## Redlines

- P0: SQL Injection vulnerability in user endpoint
- P1: Missing authentication on admin routes
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-rl2 --check --profile release-gate
```

**Expected:** Should FAIL - redlines in markdown
**Actual:** ?
**Bypass Success:** ?

---

## Case 29: RL3 - Redlines Field Type Error (String instead of Array)

**Bypass Assumption:** Gate doesn't validate redlines type.

```bash
mkdir -p round-test-rl3/product-flow
cat > round-test-rl3/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 95
status: pass
redlines: "P0: Critical issue"  # Should be array
recommendation: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-rl3 --check --profile release-gate
```

**Expected:** Should validate type
**Actual:** ?
**Bypass Success:** ?

---

## Case 30: RL4 - P0/P1 Blockers with Pass Recommendation

**Bypass Assumption:** Gate checks recommendation instead of blockers.

```bash
mkdir -p round-test-rl4/product-flow
cat > round-test-rl4/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 95
status: pass
blockers:
  - P0: Critical security flaw
  - P1: Authentication bypass
recommendation: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-rl4 --check --profile release-gate
```

**Expected:** Should FAIL - blockers non-empty
**Actual:** ?
**Bypass Success:** ?

---

## Case 31: RL5 - Empty Blockers Array with Real Blockers in Markdown

**Bypass Assumption:** Gate only checks YAML blockers field.

```bash
mkdir -p round-test-rl5/product-flow
cat > round-test-rl5/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 95
status: pass
blockers: []
recommendation: pass
EOF
cat > round-test-rl5/product-flow/blockers.md << 'EOF'
# Product Flow Blockers

## P0 Blockers

- SQL Injection vulnerability in database layer
- Missing rate limiting on authentication endpoint

## P1 Blockers

- Unvalidated user input in API responses
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-rl5 --check --profile release-gate
```

**Expected:** Should FAIL - blockers in markdown
**Actual:** ?
**Bypass Success:** ?

---

## Case 32: RL6 - P2/P3 Instead of P0/P1

**Bypass Assumption:** Gate only checks P0/P1 but not P2/P3 redlines.

```bash
mkdir -p round-test-rl6/product-flow
cat > round-test-rl6/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 95
status: pass
blockers:
  - P2: Performance degradation
  - P3: Minor UX issues
redlines:
  - P2: Slow query response time
  - P3: Inconsistent button styling
recommendation: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-rl6 --check --profile release-gate
```

**Expected:** Should PASS (only P0/P1 are blockers)
**Actual:** ?
**Bypass Success:** N/A (expected behavior)

---

## Case 33: RL7 - Blockers as Object Instead of Array

**Bypass Assumption:** Gate doesn't validate blockers structure.

```bash
mkdir -p round-test-rl7/product-flow
cat > round-test-rl7/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 95
status: pass
blockers:
  P0: Critical issue
  P1: Major issue
recommendation: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-rl7 --check --profile release-gate
```

**Expected:** Should validate array type
**Actual:** ?
**Bypass Success:** ?

---

## Case 34: RL8 - Unicode Blockers (Evil Twins)

**Bypass Assumption:** Gate doesn't handle Unicode variants.

```bash
mkdir -p round-test-rl8/product-flow
cat > round-test-rl8/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 95
status: pass
blockers:
  - "P0﹗ Critical issue"  # 𝑷0 vs P0
  - "P1） Major issue"      # 𝑷1 vs P1
recommendation: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-rl8 --check --profile release-gate
```

**Expected:** Should normalize Unicode
**Actual:** ?
**Bypass Success:** ?

---

## Case 35: RL9 - Whitespace Injection in Priority

**Bypass Assumption:** Gate uses simple string match.

```bash
mkdir -p round-test-rl9/product-flow
cat > round-test-rl9/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 95
status: pass
blockers:
  - "P0 : Critical issue"     # Space after P0
  - "P 0: Major issue"        # Space in middle
  - "P0\t: Critical issue"    # Tab after P0
recommendation: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-rl9 --check --profile release-gate
```

**Expected:** Should normalize whitespace
**Actual:** ?
**Bypass Success:** ?
