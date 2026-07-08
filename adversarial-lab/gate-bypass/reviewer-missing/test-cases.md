# Gate Bypass Test: Reviewer Missing

## Test Setup

Base path: `adversarial-lab/gate-bypass/reviewer-missing/`

## Case 11: M1 - Required Reviewer Completely Missing

**Bypass Assumption:** Gate doesn't verify all required reviewers exist.

```bash
# Only have one reviewer, release-gate requires 5
mkdir -p round-test-m1/product-flow
cat > round-test-m1/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 100
status: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-m1 --check --profile release-gate
```

**Expected:** Should FAIL - missing required reviewers
**Actual:** ?
**Bypass Success:** ?

---

## Case 12: M2 - Directory Exists but result.yaml Missing

**Bypass Assumption:** Gate only checks directory existence, not file content.

```bash
mkdir -p round-test-m2/product-flow
mkdir -p round-test-m2/architecture-maintainer
# Only create score.md, not result.yaml
cat > round-test-m2/product-flow/score.md << 'EOF'
# Score
100/100
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-m2 --check --profile release-gate
```

**Expected:** Should FAIL - result.yaml missing
**Actual:** ?
**Bypass Success:** ?

---

## Case 13: M3 - result.yaml Exists but Reviewer Name Mismatch

**Bypass Assumption:** Gate doesn't validate reviewer field matches directory name.

```bash
mkdir -p round-test-m3/product-flow
cat > round-test-m3/product-flow/result.yaml << 'EOF'
reviewer: wrong-reviewer-name
score: 100
status: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-m3 --check --profile release-gate
```

**Expected:** Should FAIL - reviewer name mismatch
**Actual:** ?
**Bypass Success:** ?

---

## Case 14: M4 - Optional Reviewer Substituting Required

**Bypass Assumption:** Gate accepts optional reviewer in place of required.

```bash
# release-gate requires product-flow, but only has native-designer
mkdir -p round-test-m4/native-designer
cat > round-test-m4/native-designer/result.yaml << 'EOF'
reviewer: native-designer
score: 100
status: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-m4 --check --profile release-gate
```

**Expected:** Should FAIL - required reviewer missing
**Actual:** ?
**Bypass Success:** ?

---

## Case 15: M5 - Extra Reviewers with Low Scores

**Bypass Assumption:** Gate only checks required reviewers and ignores extras.

```bash
mkdir -p round-test-m5/product-flow
mkdir -p round-test-m5/fake-reviewer
cat > round-test-m5/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 100
status: pass
EOF
cat > round-test-m5/fake-reviewer/result.yaml << 'EOF'
reviewer: fake-reviewer
score: 30
status: fail
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-m5 --check --profile release-gate
```

**Expected:** Should still PASS (only checks required)
**Actual:** ?
**Bypass Success:** N/A (expected behavior)

---

## Case 16: M6 - All Reviewers But One Has result.yaml, One Has Only score.md

**Bypass Assumption:** Gate accepts score.md without result.yaml.

```bash
mkdir -p round-test-m6/product-flow
mkdir -p round-test-m6/architecture-maintainer
mkdir -p round-test-m6/release-verifier
mkdir -p round-test-m6/destructive-qa
mkdir -p round-test-m6/terminal-veteran
cat > round-test-m6/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 100
status: pass
EOF
cat > round-test-m6/architecture-maintainer/result.yaml << 'EOF'
reviewer: architecture-maintainer
score: 95
status: pass
EOF
cat > round-test-m6/release-verifier/result.yaml << 'EOF'
reviewer: release-verifier
score: 90
status: pass
EOF
cat > round-test-m6/destructive-qa/result.yaml << 'EOF'
reviewer: destructive-qa
score: 92
status: pass
EOF
# terminal-veteran only has score.md, no result.yaml
cat > round-test-m6/terminal-veteran/score.md << 'EOF'
# Terminal Veteran
100/100
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-m6 --check --profile release-gate
```

**Expected:** Should handle mixed formats gracefully
**Actual:** ?
**Bypass Success:** ?
