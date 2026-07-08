# Gate Bypass Test: result.yaml Forgery

## Test Setup

Base path: `adversarial-lab/gate-bypass/result-forgery/`

## Case 1: R1 - Score 100 with No Evidence

**Bypass Assumption:** Gate accepts 100 score without checking evidence existence.

```yaml
# Mock result.yaml
reviewer: product-flow
score: 100
status: pass
recommendation: pass
```

**Execution:**
```bash
mkdir -p round-test-r1/product-flow
cat > round-test-r1/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 100
status: pass
recommendation: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-r1 --check --profile release-gate
```

**Expected:** FAIL (no evidence, no dimensions)
**Actual:** ?
**Bypass Success:** ?

---

## Case 2: R2 - Redlines Field Missing

**Bypass Assumption:** Gate doesn't require redlines field in result.yaml.

```yaml
# Mock result.yaml without redlines
reviewer: product-flow
score: 95
status: pass
blockers: []
```

**Execution:**
```bash
mkdir -p round-test-r2/product-flow
cat > round-test-r2/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 95
status: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-r2 --check --profile release-gate
```

**Expected:** Should require redlines field
**Actual:** ?
**Bypass Success:** ?

---

## Case 3: R3 - Blockers Field Missing

**Bypass Assumption:** Gate ignores missing blockers field.

```yaml
# Mock result.yaml without blockers
reviewer: product-flow
score: 85
status: fail
recommendation: fail
```

**Execution:**
```bash
mkdir -p round-test-r3/product-flow
cat > round-test-r3/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 85
status: fail
recommendation: fail
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-r3 --check --profile release-gate
```

**Expected:** Should FAIL (score < 90)
**Actual:** ?
**Bypass Success:** ?

---

## Case 4: R4 - Severity Anomaly Values

**Bypass Assumption:** Gate doesn't validate severity values.

```yaml
# Mock result.yaml with invalid severity
reviewer: product-flow
score: 95
severity: "invalid-severity"
blockers:
  - P0: Some blocker
redlines:
  - P4: Invalid priority
```

**Execution:**
```bash
mkdir -p round-test-r4/product-flow
cat > round-test-r4/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 95
severity: "totally-made-up"
blockers:
  - P0: Critical bypass attempt
redlines:
  - P99: Invalid priority
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-r4 --check --profile release-gate
```

**Expected:** Should validate severity values
**Actual:** ?
**Bypass Success:** ?

---

## Case 5: R5 - Fake Reviewer Name

**Bypass Assumption:** Gate accepts any reviewer name.

```yaml
# Mock result.yaml with fake reviewer
reviewer: fake-super-reviewer-9000
score: 100
status: pass
recommendation: pass
```

**Execution:**
```bash
mkdir -p round-test-r5/fake-super-reviewer-9000
cat > round-test-r5/fake-super-reviewer-9000/result.yaml << 'EOF'
reviewer: fake-super-reviewer-9000
score: 100
status: pass
recommendation: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-r5 --check --profile release-gate
```

**Expected:** Should reject unknown reviewer names
**Actual:** ?
**Bypass Success:** ?

---

## Case 6: R6 - Case Variation in Reviewer Name

**Bypass Assumption:** Gate doesn't normalize reviewer names case-insensitively.

```yaml
# Mock result.yaml with case variation
reviewer: PRODUCT-FLOW
score: 95
status: pass
```

**Execution:**
```bash
mkdir -p round-test-r6/PRODUCT-FLOW
cat > round-test-r6/PRODUCT-FLOW/result.yaml << 'EOF'
reviewer: PRODUCT-FLOW
score: 95
status: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-r6 --check --profile release-gate
```

**Expected:** Should normalize and accept case-insensitive match
**Actual:** ?
**Bypass Success:** ?

---

## Case 7: R7 - YAML Format Anomaly

**Bypass Assumption:** Gate uses YAML parser that accepts malformed YAML.

```yaml
# Malformed YAML - tabs instead of spaces, missing quotes
reviewer: product-flow
score: 100
dimensions:
  test: 100/100
	indentation-error: value
unquoted-string: this: should: fail
```

**Execution:**
```bash
mkdir -p round-test-r7/product-flow
cat > round-test-r7/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 100
status: pass
tabs:	invalid
unquoted: this: has: colons
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-r7 --check --profile release-gate
```

**Expected:** Should reject malformed YAML
**Actual:** ?
**Bypass Success:** ?

---

## Case 8: R8 - Multiple result.yaml Conflict

**Bypass Assumption:** Gate doesn't check for multiple result.yaml files in same directory.

```bash
mkdir -p round-test-r8/product-flow
cat > round-test-r8/product-flow/result1.yaml << 'EOF'
reviewer: product-flow
score: 50
status: fail
EOF
cat > round-test-r8/product-flow/result2.yaml << 'EOF'
reviewer: product-flow
score: 100
status: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-r8 --check --profile release-gate
```

**Expected:** Should detect duplicate result files
**Actual:** ?
**Bypass Success:** ?

---

## Case 9: R9 - Score as String

**Bypass Assumption:** Gate doesn't validate score is numeric.

```yaml
# Mock with string score
reviewer: product-flow
score: "100"
status: pass
```

**Execution:**
```bash
mkdir -p round-test-r9/product-flow
cat > round-test-r9/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: "100"
status: pass
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-r9 --check --profile release-gate
```

**Expected:** Should validate numeric score
**Actual:** ?
**Bypass Success:** ?

---

## Case 10: R10 - Score as Special Values

**Bypass Assumption:** Gate accepts unusual numeric values.

```bash
# Test with 90.0
mkdir -p round-test-r10a/product-flow
cat > round-test-r10a/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 90.0
status: pass
EOF

# Test with 089 (octal-like)
mkdir -p round-test-r10b/product-flow
cat > round-test-r10b/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 089
status: pass
EOF

# Test with 1000 (out of range)
mkdir -p round-test-r10c/product-flow
cat > round-test-r10c/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 1000
status: pass
EOF

# Test with NaN
mkdir -p round-test-r10d/product-flow
cat > round-test-r10d/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: NaN
status: pass
EOF

# Test with null
mkdir -p round-test-r10e/product-flow
cat > round-test-r10e/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: null
status: pass
EOF

# Test with Infinity
mkdir -p round-test-r10f/product-flow
cat > round-test-r10f/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: Infinity
status: pass
EOF
```

**Expected:** Should validate score range (0-100) and numeric type
**Actual:** ?
**Bypass Success:** ?
