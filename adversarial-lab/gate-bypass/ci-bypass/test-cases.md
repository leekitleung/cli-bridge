# Gate Bypass Test: CI Bypass

## Test Setup

Base path: `adversarial-lab/gate-bypass/ci-bypass/`

## Case 46: CI1 - review-gate Exit Code Not Checked

**Bypass Assumption:** CI doesn't check exit code of review-gate.

```bash
# Simulate: CI runs gate but ignores exit code
mkdir -p round-test-ci1/product-flow
cat > round-test-ci1/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 50
status: fail
EOF
# Run gate, capture exit code
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-ci1 --check --profile release-gate
echo "Exit code: $?"
```

**Expected:** Exit code 1 (failure)
**Actual:** ?
**Bypass Success:** ?

---

## Case 47: CI2 - Workflow Continues on Gate Failure

**Bypass Assumption:** CI continues even when gate fails.

```yaml
# Simulated workflow
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - run: node review-gate.mjs
        shell: bash
        continue-on-error: true  # THIS IS THE BYPASS
```

**Evidence:** Need to check actual workflow file
**Bypass Success:** Need to verify workflow file

---

## Case 48: CI3 - Test Failure Doesn't Fail Workflow

**Bypass Assumption:** CI doesn't run tests as gate.

```yaml
# Simulated workflow - tests run but result ignored
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test
        shell: bash
        continue-on-error: true  # THIS IS THE BYPASS
```

**Evidence:** Need to check actual workflow file
**Bypass Success:** Need to verify workflow file

---

## Case 49: CI4 - Gate Only Checks File Existence, Not Content

**Bypass Assumption:** Gate accepts any result.yaml without validation.

```bash
mkdir -p round-test-ci4/product-flow
cat > round-test-ci4/product-flow/result.yaml << 'EOF'
# This is not valid YAML at all!
reviewer product-flow
score: 100
EOF
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-ci4 --check --profile release-gate
```

**Expected:** Should FAIL - invalid YAML
**Actual:** ?
**Bypass Success:** ?

---

## Case 50: CI5 - Workflow Allows Manual Override

**Bypass Assumption:** CI has a bypass flag that can be set.

```yaml
# Simulated workflow with override
jobs:
  gate:
    runs-on: ubuntu-latest
    outputs:
      gate_passed: ${{ steps.gate.outputs.passed }}
    steps:
      - id: gate
        run: node review-gate.mjs
      - name: Manual Override
        if: github.event.inputs.override == 'true'
        run: echo "Manual override used"
```

**Evidence:** Need to check actual workflow file
**Bypass Success:** Need to verify workflow file

---

## Case 51: CI6 - Typecheck Runs But Errors Ignored

**Bypass Assumption:** Typecheck errors don't fail the gate.

```bash
# The gate should run typecheck and fail if there are errors
# Let's see what happens with a file that has obvious errors
mkdir -p round-test-ci6/product-flow
cat > round-test-ci6/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 100
status: pass
EOF
# Check if gate actually runs typecheck
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-ci6 --check --profile release-gate 2>&1 | grep -i typecheck
```

**Expected:** Should see typecheck output
**Actual:** ?
**Bypass Success:** ?

---

## Case 52: CI7 - Workflow Uses Different Branch's Results

**Bypass Assumption:** Gate reads from main instead of current branch.

```bash
# If CI checkout is shallow or uses wrong ref
# This is a configuration issue
echo "Need to verify CI config checks out current HEAD"
```

**Evidence:** Need to check CI configuration
**Bypass Success:** Need to verify CI file

---

## Case 53: CI8 - Git Diff Empty on Non-Main Branch

**Bypass Assumption:** CI doesn't detect changes on feature branches.

```bash
# Check if gate detects empty diff
node ../../skills/release-quality-review/scripts/review-gate.mjs --check --profile release-gate 2>&1 | grep -i "changed\|diff"
```

**Expected:** Should handle empty diff gracefully
**Actual:** ?
**Bypass Success:** N/A (expected behavior)

---

## Case 54: CI9 - Secrets Scanning Has False Negatives

**Bypass Assumption:** Gate doesn't scan for actual secrets.

```bash
# Create a fake secret in source
mkdir -p round-test-ci9/product-flow
cat > round-test-ci9/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 100
status: pass
EOF
# Check if gate scans for secrets in the repo
node ../../skills/release-quality-review/scripts/review-gate.mjs --round-dir round-test-ci9 --check --profile release-gate 2>&1 | grep -i secret
```

**Expected:** Should scan for secrets
**Actual:** ?
**Bypass Success:** ?

---

## Case 55: CI10 - Workflow Runs on PR but Uses Main's Gate

**Bypass Assumption:** Gate reads from PR source, not merge base.

```bash
# If CI checkout is incorrect
echo "Need to verify CI does git checkout of PR branch, not main"
```

**Evidence:** Need to check CI configuration
**Bypass Success:** Need to verify CI file
