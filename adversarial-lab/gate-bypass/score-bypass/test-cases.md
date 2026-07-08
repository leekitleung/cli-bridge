# Gate Bypass Test: Score Bypass

## Test Setup

Base path: `adversarial-lab/gate-bypass/score-bypass/`

## Case 17: S1 - Single Reviewer Below 90

**Bypass Assumption:** Gate doesn't check individual reviewer scores.

```bash
mkdir -p round-test-s1/product-flow
mkdir -p round-test-s1/architecture-maintainer
mkdir -p round-test-s1/release-verifier
mkdir -p round-test-s1/destructive-qa
mkdir -p round-test-s1/terminal-veteran
cat > round-test-s1/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 100
status: pass
EOF
cat > round-test-s1/architecture-maintainer/result.yaml << 'EOF'
reviewer: architecture-maintainer
score: 95
status: pass
EOF
cat > round-test-s1/release-verifier/result.yaml << 'EOF'
reviewer: release-verifier
score: 50
status: fail
EOF
cat > round-test-s1/destructive-qa/result.yaml << 'EOF'
reviewer: destructive-qa
score: 100
status: pass
EOF
cat > round-test-s1/terminal-veteran/result.yaml << 'EOF'
reviewer: terminal-veteran
score: 100
status: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-s1 --check --profile release-gate
```

**Expected:** Should FAIL - release-verifier score 50 < 90
**Actual:** ?
**Bypass Success:** ?

---

## Case 18: S2 - Average >= 90 But Lowest < 90

**Bypass Assumption:** Gate checks average instead of minimum.

```bash
mkdir -p round-test-s2/product-flow
mkdir -p round-test-s2/architecture-maintainer
mkdir -p round-test-s2/release-verifier
mkdir -p round-test-s2/destructive-qa
mkdir -p round-test-s2/terminal-veteran
# Average = (60 + 100 + 100 + 100 + 100) / 5 = 92
# But lowest is 60
cat > round-test-s2/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 60
status: fail
EOF
cat > round-test-s2/architecture-maintainer/result.yaml << 'EOF'
reviewer: architecture-maintainer
score: 100
status: pass
EOF
cat > round-test-s2/release-verifier/result.yaml << 'EOF'
reviewer: release-verifier
score: 100
status: pass
EOF
cat > round-test-s2/destructive-qa/result.yaml << 'EOF'
reviewer: destructive-qa
score: 100
status: pass
EOF
cat > round-test-s2/terminal-veteran/result.yaml << 'EOF'
reviewer: terminal-veteran
score: 100
status: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-s2 --check --profile release-gate
```

**Expected:** Should FAIL - lowest score 60 < 90
**Actual:** ?
**Bypass Success:** ?

---

## Case 19: S3 - Score as String "90"

**Bypass Assumption:** Gate doesn't validate score type.

```bash
mkdir -p round-test-s3/product-flow
cat > round-test-s3/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: "90"
status: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-s3 --check --profile release-gate
```

**Expected:** Should validate numeric type
**Actual:** ?
**Bypass Success:** ?

---

## Case 20: S4 - Score 089 (Octal-like)

**Bypass Assumption:** YAML parser interprets 089 as octal.

```bash
mkdir -p round-test-s4/product-flow
cat > round-test-s4/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 089
status: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-s4 --check --profile release-gate
```

**Expected:** Should parse correctly (089 = 89)
**Actual:** ?
**Bypass Success:** FAIL expected (89 < 90)

---

## Case 21: S5 - Score 1000 (Out of Range)

**Bypass Assumption:** Gate doesn't validate score range.

```bash
mkdir -p round-test-s5/product-flow
cat > round-test-s5/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 1000
status: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-s5 --check --profile release-gate
```

**Expected:** Should reject score > 100
**Actual:** ?
**Bypass Success:** ?

---

## Case 22: S6 - Score as NaN

**Bypass Assumption:** Gate doesn't validate numeric type.

```bash
mkdir -p round-test-s6/product-flow
cat > round-test-s6/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: .nan
status: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-s6 --check --profile release-gate
```

**Expected:** Should reject NaN
**Actual:** ?
**Bypass Success:** ?

---

## Case 23: S7 - Score as null

**Bypass Assumption:** Gate treats null as valid.

```bash
mkdir -p round-test-s7/product-flow
cat > round-test-s7/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: null
status: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-s7 --check --profile release-gate
```

**Expected:** Should reject null
**Actual:** ?
**Bypass Success:** ?

---

## Case 24: S8 - Score as Infinity

**Bypass Assumption:** Gate accepts Infinity as valid.

```bash
mkdir -p round-test-s8/product-flow
cat > round-test-s8/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: .inf
status: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-s8 --check --profile release-gate
```

**Expected:** Should reject Infinity
**Actual:** ?
**Bypass Success:** ?

---

## Case 25: S9 - Dimension Scores Contradict Total

**Bypass Assumption:** Gate doesn't cross-validate dimensions vs total.

```yaml
# dimension_scores sum to 50, but total is 100
dimensions:
  test: 10
  security: 10
  quality: 10
  performance: 10
  other: 10
```

**Execution:**
```bash
mkdir -p round-test-s9/product-flow
cat > round-test-s9/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 100
dimensions:
  test: 10
  security: 10
  quality: 10
  performance: 10
  other: 10
status: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-s9 --check --profile release-gate
```

**Expected:** Should detect dimension/total mismatch
**Actual:** ?
**Bypass Success:** ?

---

## Case 26: S10 - Score at Exactly 90 (Boundary)

**Bypass Assumption:** Gate doesn't handle boundary correctly.

```bash
mkdir -p round-test-s10/product-flow
mkdir -p round-test-s10/architecture-maintainer
mkdir -p round-test-s10/release-verifier
mkdir -p round-test-s10/destructive-qa
mkdir -p round-test-s10/terminal-veteran
# All exactly 90 - should pass
for reviewer in product-flow architecture-maintainer release-verifier destructive-qa terminal-veteran; do
cat > round-test-s10/$reviewer/result.yaml << EOF
reviewer: $reviewer
score: 90
status: pass
EOF
done
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-s10 --check --profile release-gate
```

**Expected:** Should PASS (90 >= 90)
**Actual:** ?
**Bypass Success:** N/A (expected behavior)
