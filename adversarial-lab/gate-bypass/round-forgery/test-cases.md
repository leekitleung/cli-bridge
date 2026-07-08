# Gate Bypass Test: Round Forgery

## Test Setup

Base path: `adversarial-lab/gate-bypass/round-forgery/`

## Case 36: F1 - Old Round with New Name

**Bypass Assumption:** Gate trusts directory name without validation.

```bash
# Copy a passing round but rename to new round number
cp -r ../../../quality-reports/round-011 round-test-f1
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-f1 --check --profile release-gate
```

**Expected:** Should PASS (it's a real passing round)
**Actual:** ?
**Bypass Success:** N/A (expected if it's a real round)

---

## Case 37: F2 - Summary.md and result.yaml Inconsistency

**Bypass Assumption:** Gate doesn't cross-validate summary with results.

```bash
mkdir -p round-test-f2/product-flow
cat > round-test-f2/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 50
status: fail
EOF
# But summary says PASS
cat > round-test-f2/summary.md << 'EOF'
# Summary
All reviewers passed!
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-f2 --check --profile release-gate
```

**Expected:** Should FAIL - result.yaml says fail
**Actual:** ?
**Bypass Success:** ?

---

## Case 38: F3 - gate-result.json Manually Set to passed: true

**Bypass Assumption:** Gate reads gate-result.json instead of computing.

```bash
mkdir -p round-test-f3/product-flow
cat > round-test-f3/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 50
status: fail
EOF
cat > round-test-f3/gate-result.json << 'EOF'
{
  "passed": true,
  "timestamp": "2026-07-08T00:00:00Z",
  "reviewers": {}
}
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-f3 --check --profile release-gate
```

**Expected:** Should ignore gate-result.json and compute fresh
**Actual:** ?
**Bypass Success:** ?

---

## Case 39: F4 - evidence/manifest.yaml Missing

**Bypass Assumption:** Gate requires evidence manifest.

```bash
mkdir -p round-test-f4/product-flow
mkdir -p round-test-f4/evidence
cat > round-test-f4/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 100
status: pass
EOF
# Create evidence file but no manifest
echo "test content" > round-test-f4/evidence/test.txt
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-f4 --check --profile release-gate
```

**Expected:** Should handle missing manifest
**Actual:** ?
**Bypass Success:** N/A (may be acceptable)

---

## Case 40: F5 - Evidence Points to Non-existent File

**Bypass Assumption:** Gate doesn't validate evidence paths.

```bash
mkdir -p round-test-f5/product-flow
mkdir -p round-test-f5/evidence
cat > round-test-f5/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 95
status: pass
EOF
cat > round-test-f5/evidence/manifest.yaml << 'EOF'
evidence:
  - path: non-existent-file.txt
    type: test-log
  - path: another-missing.log
    type: typecheck-output
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-f5 --check --profile release-gate
```

**Expected:** Should validate evidence paths exist
**Actual:** ?
**Bypass Success:** ?

---

## Case 41: F6 - Timestamp from Future

**Bypass Assumption:** Gate doesn't validate timestamp.

```bash
mkdir -p round-test-f6/product-flow
cat > round-test-f6/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 100
status: pass
timestamp: "2099-12-31T23:59:59Z"
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-f6 --check --profile release-gate
```

**Expected:** Should validate timestamp is not in future
**Actual:** ?
**Bypass Success:** ?

---

## Case 42: F7 - Duplicate Reviewer Entries

**Bypass Assumption:** Gate doesn't deduplicate reviewers.

```bash
mkdir -p round-test-f7/product-flow
cat > round-test-f7/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 100
status: pass
EOF
cat > round-test-f7/summary.md << 'EOF'
# Summary

| Reviewer | Score |
|----------|-------|
| product-flow | 100 |
| product-flow | 50 |
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-f7 --check --profile release-gate
```

**Expected:** Should handle duplicates
**Actual:** ?
**Bypass Success:** ?

---

## Case 43: F8 - Round Number in Filename vs Directory

**Bypass Assumption:** Gate uses filename instead of directory.

```bash
mkdir -p round-test-f8/product-flow
# Create result.yaml with wrong round embedded
cat > round-test-f8/product-flow/result.yaml << 'EOF'
reviewer: product-flow
round: 999  # Embedding wrong round
score: 100
status: pass
EOF
# But directory is round-test-f8
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-f8 --check --profile release-gate
```

**Expected:** Should use directory round number
**Actual:** ?
**Bypass Success:** ?

---

## Case 44: F9 - Soft Links to Real Rounds

**Bypass Assumption:** Gate doesn't detect symlinks.

```bash
ln -s ../../../quality-reports/round-011 round-test-f9
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-f9 --check --profile release-gate
```

**Expected:** Should handle or reject symlinks
**Actual:** ?
**Bypass Success:** ?

---

## Case 45: F10 - Hidden Files/Directories Bypass

**Bypass Assumption:** Gate ignores hidden files.

```bash
mkdir -p round-test-f10/product-flow
mkdir -p round-test-f10/.hidden-reviewer
cat > round-test-f10/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 100
status: pass
EOF
cat > round-test-f10/.hidden-reviewer/result.yaml << 'EOF'
reviewer: hidden-reviewer
score: 0
status: fail
blockers:
  - P0: Hidden blocker that should cause failure
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-f10 --check --profile release-gate
```

**Expected:** Should scan all directories
**Actual:** ?
**Bypass Success:** ?
