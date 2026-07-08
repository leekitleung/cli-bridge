#!/bin/bash
# Gate Bypass Test Runner
# Executes all test cases and captures results

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
GATE_SCRIPT="$REPO_ROOT/skills/release-quality-review/scripts/review-gate.mjs"

cd "$REPO_ROOT"

echo "=========================================="
echo "Gate Bypass Test Suite"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS_COUNT=0
FAIL_COUNT=0
TOTAL_COUNT=0

run_test() {
    local test_id="$1"
    local test_name="$2"
    local setup_cmd="$3"
    local expected="$4"
    local test_dir="$5"

    TOTAL_COUNT=$((TOTAL_COUNT + 1))

    echo "----------------------------------------"
    echo "Test $test_id: $test_name"
    echo "Expected: $expected"
    echo ""

    # Setup
    if [ -n "$setup_cmd" ]; then
        eval "$setup_cmd" 2>/dev/null || true
    fi

    # Run gate
    local result
    local exit_code

    if [ -d "$test_dir" ]; then
        result=$(node "$GATE_SCRIPT" --round-dir "$test_dir" --check --profile release-gate 2>&1)
        exit_code=$?
    else
        result="DIRECTORY NOT FOUND: $test_dir"
        exit_code=2
    fi

    # Determine if bypass worked
    local bypassed=0
    case "$expected" in
        "FAIL"*)
            if echo "$result" | grep -q "PASSED\|GATE PASSED"; then
                bypassed=1
            fi
            ;;
        "PASS"*)
            if echo "$result" | grep -q "FAILED\|GATE FAILED"; then
                bypassed=1
            fi
            ;;
        "EXIT_1")
            if [ $exit_code -eq 0 ]; then
                bypassed=1
            fi
            ;;
        "EXIT_0")
            if [ $exit_code -ne 0 ]; then
                bypassed=1
            fi
            ;;
    esac

    if [ $bypassed -eq 1 ]; then
        echo -e "${RED}⚠ BYPASS SUCCESSFUL${NC}"
        echo "This test case CAN bypass the gate!"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    else
        echo -e "${GREEN}✓ BLOCKED${NC}"
        echo "Gate correctly handled this test case."
        PASS_COUNT=$((PASS_COUNT + 1))
    fi

    echo ""
    echo "Result: $result"
    echo "Exit code: $exit_code"
    echo ""
}

# ==========================================
# RESULT FORGERY TESTS (R1-R10)
# ==========================================
echo ""
echo "=== RESULT FORGERY TESTS ==="
echo ""

# R1 - Score 100 with no evidence
run_test "R1" "Score 100 with no evidence" \
    "mkdir -p adversarial-lab/gate-bypass/result-forgery/round-test-r1/product-flow && cat > adversarial-lab/gate-bypass/result-forgery/round-test-r1/product-flow/result.yaml << 'YAML'
reviewer: product-flow
score: 100
status: pass
recommendation: pass
YAML" \
    "FAIL" \
    "adversarial-lab/gate-bypass/result-forgery/round-test-r1"

# R2 - Redlines field missing
run_test "R2" "Redlines field missing" \
    "mkdir -p adversarial-lab/gate-bypass/result-forgery/round-test-r2/product-flow && cat > adversarial-lab/gate-bypass/result-forgery/round-test-r2/product-flow/result.yaml << 'YAML'
reviewer: product-flow
score: 95
status: pass
YAML" \
    "PASS" \
    "adversarial-lab/gate-bypass/result-forgery/round-test-r2"

# R3 - Blockers field missing
run_test "R3" "Blockers field missing" \
    "mkdir -p adversarial-lab/gate-bypass/result-forgery/round-test-r3/product-flow && cat > adversarial-lab/gate-bypass/result-forgery/round-test-r3/product-flow/result.yaml << 'YAML'
reviewer: product-flow
score: 85
status: fail
recommendation: fail
YAML" \
    "FAIL" \
    "adversarial-lab/gate-bypass/result-forgery/round-test-r3"

# R4 - Invalid severity
run_test "R4" "Invalid severity values" \
    "mkdir -p adversarial-lab/gate-bypass/result-forgery/round-test-r4/product-flow && cat > adversarial-lab/gate-bypass/result-forgery/round-test-r4/product-flow/result.yaml << 'YAML'
reviewer: product-flow
score: 95
severity: totally-made-up
blockers:
  - P0: Critical
redlines:
  - P99: Invalid
YAML" \
    "FAIL" \
    "adversarial-lab/gate-bypass/result-forgery/round-test-r4"

# R5 - Fake reviewer name
run_test "R5" "Fake reviewer name" \
    "mkdir -p adversarial-lab/gate-bypass/result-forgery/round-test-r5/fake-reviewer-9000 && cat > adversarial-lab/gate-bypass/result-forgery/round-test-r5/fake-reviewer-9000/result.yaml << 'YAML'
reviewer: fake-reviewer-9000
score: 100
status: pass
recommendation: pass
YAML" \
    "FAIL" \
    "adversarial-lab/gate-bypass/result-forgery/round-test-r5"

# R6 - Case variation
run_test "R6" "Case variation in reviewer name" \
    "mkdir -p adversarial-lab/gate-bypass/result-forgery/round-test-r6/PRODUCT-FLOW && cat > adversarial-lab/gate-bypass/result-forgery/round-test-r6/PRODUCT-FLOW/result.yaml << 'YAML'
reviewer: PRODUCT-FLOW
score: 95
status: pass
recommendation: pass
YAML" \
    "PASS" \
    "adversarial-lab/gate-bypass/result-forgery/round-test-r6"

# R7 - Malformed YAML
run_test "R7" "Malformed YAML" \
    "mkdir -p adversarial-lab/gate-bypass/result-forgery/round-test-r7/product-flow && cat > adversarial-lab/gate-bypass/result-forgery/round-test-r7/product-flow/result.yaml << 'YAML'
reviewer: product-flow
score:	100
unquoted: this: has: colons
YAML" \
    "FAIL" \
    "adversarial-lab/gate-bypass/result-forgery/round-test-r7"

# R8 - Score as string
run_test "R8" "Score as string" \
    "mkdir -p adversarial-lab/gate-bypass/result-forgery/round-test-r8/product-flow && cat > adversarial-lab/gate-bypass/result-forgery/round-test-r8/product-flow/result.yaml << 'YAML'
reviewer: product-flow
score: \"100\"
status: pass
recommendation: pass
YAML" \
    "FAIL" \
    "adversarial-lab/gate-bypass/result-forgery/round-test-r8"

# R9 - Score 1000 (out of range)
run_test "R9" "Score 1000 (out of range)" \
    "mkdir -p adversarial-lab/gate-bypass/result-forgery/round-test-r9/product-flow && cat > adversarial-lab/gate-bypass/result-forgery/round-test-r9/product-flow/result.yaml << 'YAML'
reviewer: product-flow
score: 1000
status: pass
recommendation: pass
YAML" \
    "FAIL" \
    "adversarial-lab/gate-bypass/result-forgery/round-test-r9"

# R10 - Score as NaN
run_test "R10" "Score as NaN" \
    "mkdir -p adversarial-lab/gate-bypass/result-forgery/round-test-r10/product-flow && cat > adversarial-lab/gate-bypass/result-forgery/round-test-r10/product-flow/result.yaml << 'YAML'
reviewer: product-flow
score: .nan
status: pass
recommendation: pass
YAML" \
    "FAIL" \
    "adversarial-lab/gate-bypass/result-forgery/round-test-r10"

# ==========================================
# REVIEWER MISSING TESTS (M1-M6)
# ==========================================
echo ""
echo "=== REVIEWER MISSING TESTS ==="
echo ""

# M1 - Required reviewer missing
run_test "M1" "Required reviewer missing" \
    "mkdir -p adversarial-lab/gate-bypass/reviewer-missing/round-test-m1/product-flow && cat > adversarial-lab/gate-bypass/reviewer-missing/round-test-m1/product-flow/result.yaml << 'YAML'
reviewer: product-flow
score: 100
status: pass
recommendation: pass
YAML" \
    "FAIL" \
    "adversarial-lab/gate-bypass/reviewer-missing/round-test-m1"

# M2 - Directory exists but result.yaml missing
run_test "M2" "Directory exists but result.yaml missing" \
    "mkdir -p adversarial-lab/gate-bypass/reviewer-missing/round-test-m2/product-flow && cat > adversarial-lab/gate-bypass/reviewer-missing/round-test-m2/product-flow/score.md << 'MD'
# Score
100/100
MD" \
    "FAIL" \
    "adversarial-lab/gate-bypass/reviewer-missing/round-test-m2"

# M3 - Reviewer name mismatch
run_test "M3" "Reviewer name mismatch" \
    "mkdir -p adversarial-lab/gate-bypass/reviewer-missing/round-test-m3/product-flow && cat > adversarial-lab/gate-bypass/reviewer-missing/round-test-m3/product-flow/result.yaml << 'YAML'
reviewer: wrong-reviewer
score: 100
status: pass
recommendation: pass
YAML" \
    "FAIL" \
    "adversarial-lab/gate-bypass/reviewer-missing/round-test-m3"

# M4 - Optional reviewer substituting required
run_test "M4" "Optional reviewer substituting required" \
    "mkdir -p adversarial-lab/gate-bypass/reviewer-missing/round-test-m4/native-designer && cat > adversarial-lab/gate-bypass/reviewer-missing/round-test-m4/native-designer/result.yaml << 'YAML'
reviewer: native-designer
score: 100
status: pass
recommendation: pass
YAML" \
    "FAIL" \
    "adversarial-lab/gate-bypass/reviewer-missing/round-test-m4"

# ==========================================
# SCORE BYPASS TESTS (S1-S10)
# ==========================================
echo ""
echo "=== SCORE BYPASS TESTS ==="
echo ""

# S1 - Single reviewer below 90
run_test "S1" "Single reviewer below 90" \
    "mkdir -p adversarial-lab/gate-bypass/score-bypass/round-test-s1/{product-flow,architecture-maintainer,release-verifier,destructive-qa,terminal-veteran} && \
    for r in product-flow architecture-maintainer destructive-qa terminal-veteran; do
        cat > adversarial-lab/gate-bypass/score-bypass/round-test-s1/\$r/result.yaml << 'YAML'
reviewer: REPLACEME
score: 100
status: pass
recommendation: pass
YAML
        sed -i \"s/REPLACEME/\$r/g\" adversarial-lab/gate-bypass/score-bypass/round-test-s1/\$r/result.yaml
    done && \
    cat > adversarial-lab/gate-bypass/score-bypass/round-test-s1/release-verifier/result.yaml << 'YAML'
reviewer: release-verifier
score: 50
status: fail
recommendation: fail
YAML" \
    "FAIL" \
    "adversarial-lab/gate-bypass/score-bypass/round-test-s1"

# S2 - Average >= 90 but lowest < 90
run_test "S2" "Average >= 90 but lowest < 90" \
    "mkdir -p adversarial-lab/gate-bypass/score-bypass/round-test-s2/{product-flow,architecture-maintainer,release-verifier,destructive-qa,terminal-veteran} && \
    cat > adversarial-lab/gate-bypass/score-bypass/round-test-s2/product-flow/result.yaml << 'YAML'
reviewer: product-flow
score: 60
status: fail
recommendation: fail
YAML
    for r in architecture-maintainer release-verifier destructive-qa terminal-veteran; do
        cat > adversarial-lab/gate-bypass/score-bypass/round-test-s2/\$r/result.yaml << 'YAML'
reviewer: REPLACEME
score: 100
status: pass
recommendation: pass
YAML
        sed -i \"s/REPLACEME/\$r/g\" adversarial-lab/gate-bypass/score-bypass/round-test-s2/\$r/result.yaml
    done" \
    "FAIL" \
    "adversarial-lab/gate-bypass/score-bypass/round-test-s2"

# S3 - Score as string "90"
run_test "S3" "Score as string" \
    "mkdir -p adversarial-lab/gate-bypass/score-bypass/round-test-s3/product-flow && cat > adversarial-lab/gate-bypass/score-bypass/round-test-s3/product-flow/result.yaml << 'YAML'
reviewer: product-flow
score: \"90\"
status: pass
recommendation: pass
YAML" \
    "FAIL" \
    "adversarial-lab/gate-bypass/score-bypass/round-test-s3"

# S4 - Score at boundary (90 exactly)
run_test "S4" "Score at boundary (90 exactly)" \
    "mkdir -p adversarial-lab/gate-bypass/score-bypass/round-test-s4/{product-flow,architecture-maintainer,release-verifier,destructive-qa,terminal-veteran} && \
    for r in product-flow architecture-maintainer release-verifier destructive-qa terminal-veteran; do
        cat > adversarial-lab/gate-bypass/score-bypass/round-test-s4/\$r/result.yaml << 'YAML'
reviewer: REPLACEME
score: 90
status: pass
recommendation: pass
YAML
        sed -i \"s/REPLACEME/\$r/g\" adversarial-lab/gate-bypass/score-bypass/round-test-s4/\$r/result.yaml
    done" \
    "PASS" \
    "adversarial-lab/gate-bypass/score-bypass/round-test-s4"

# ==========================================
# REDLINES BYPASS TESTS (RL1-RL9)
# ==========================================
echo ""
echo "=== REDLINES BYPASS TESTS ==="
echo ""

# RL1 - Non-empty redlines but pass
run_test "RL1" "Non-empty redlines but pass" \
    "mkdir -p adversarial-lab/gate-bypass/redlines-bypass/round-test-rl1/product-flow && cat > adversarial-lab/gate-bypass/redlines-bypass/round-test-rl1/product-flow/result.yaml << 'YAML'
reviewer: product-flow
score: 95
status: pass
redlines:
  - P0: Critical vulnerability
  - P1: Major flaw
recommendation: pass
YAML" \
    "FAIL" \
    "adversarial-lab/gate-bypass/redlines-bypass/round-test-rl1"

# RL2 - Redlines in Markdown but empty in YAML
run_test "RL2" "Redlines in Markdown but empty in YAML" \
    "mkdir -p adversarial-lab/gate-bypass/redlines-bypass/round-test-rl2/product-flow && \
    cat > adversarial-lab/gate-bypass/redlines-bypass/round-test-rl2/product-flow/result.yaml << 'YAML'
reviewer: product-flow
score: 95
status: pass
redlines: []
recommendation: pass
YAML
    cat > adversarial-lab/gate-bypass/redlines-bypass/round-test-rl2/product-flow/score.md << 'MD'
# Score
95/100
## Redlines
- P0: SQL Injection
MD" \
    "FAIL" \
    "adversarial-lab/gate-bypass/redlines-bypass/round-test-rl2"

# RL3 - Blockers with pass recommendation
run_test "RL3" "Blockers with pass recommendation" \
    "mkdir -p adversarial-lab/gate-bypass/redlines-bypass/round-test-rl3/product-flow && cat > adversarial-lab/gate-bypass/redlines-bypass/round-test-rl3/product-flow/result.yaml << 'YAML'
reviewer: product-flow
score: 95
status: pass
blockers:
  - P0: Critical issue
recommendation: pass
YAML" \
    "FAIL" \
    "adversarial-lab/gate-bypass/redlines-bypass/round-test-rl3"

# RL4 - Unicode variants
run_test "RL4" "Unicode variants in priority" \
    "mkdir -p adversarial-lab/gate-bypass/redlines-bypass/round-test-rl4/product-flow && cat > adversarial-lab/gate-bypass/redlines-bypass/round-test-rl4/product-flow/result.yaml << 'YAML'
reviewer: product-flow
score: 95
status: pass
blockers:
  - "P0﹗ Critical issue"
recommendation: pass
YAML" \
    "FAIL" \
    "adversarial-lab/gate-bypass/redlines-bypass/round-test-rl4"

# RL5 - Whitespace injection
run_test "RL5" "Whitespace injection in priority" \
    "mkdir -p adversarial-lab/gate-bypass/redlines-bypass/round-test-rl5/product-flow && cat > adversarial-lab/gate-bypass/redlines-bypass/round-test-rl5/product-flow/result.yaml << 'YAML'
reviewer: product-flow
score: 95
status: pass
blockers:
  - "P0 : Critical issue"
recommendation: pass
YAML" \
    "FAIL" \
    "adversarial-lab/gate-bypass/redlines-bypass/round-test-rl5"

# ==========================================
# ROUND FORGERY TESTS (F1-F10)
# ==========================================
echo ""
echo "=== ROUND FORGERY TESTS ==="
echo ""

# F1 - Copy old round
run_test "F1" "Copy old round" \
    "cp -r quality-reports/round-011 adversarial-lab/gate-bypass/round-forgery/round-test-f1 2>/dev/null || mkdir -p adversarial-lab/gate-bypass/round-forgery/round-test-f1/product-flow && cat > adversarial-lab/gate-bypass/round-forgery/round-test-f1/product-flow/result.yaml << 'YAML'
reviewer: product-flow
score: 100
status: pass
recommendation: pass
YAML" \
    "PASS" \
    "adversarial-lab/gate-bypass/round-forgery/round-test-f1"

# F2 - gate-result.json manually set to passed
run_test "F2" "gate-result.json manually set to passed" \
    "mkdir -p adversarial-lab/gate-bypass/round-forgery/round-test-f2/product-flow && \
    cat > adversarial-lab/gate-bypass/round-forgery/round-test-f2/product-flow/result.yaml << 'YAML'
reviewer: product-flow
score: 50
status: fail
recommendation: fail
YAML
    cat > adversarial-lab/gate-bypass/round-forgery/round-test-f2/gate-result.json << 'JSON'
{\"passed\": true}
JSON" \
    "FAIL" \
    "adversarial-lab/gate-bypass/round-forgery/round-test-f2"

# F3 - Evidence points to non-existent file
run_test "F3" "Evidence points to non-existent file" \
    "mkdir -p adversarial-lab/gate-bypass/round-forgery/round-test-f3/product-flow && \
    cat > adversarial-lab/gate-bypass/round-forgery/round-test-f3/product-flow/result.yaml << 'YAML'
reviewer: product-flow
score: 95
status: pass
recommendation: pass
YAML
    mkdir -p adversarial-lab/gate-bypass/round-forgery/round-test-f3/evidence && \
    cat > adversarial-lab/gate-bypass/round-forgery/round-test-f3/evidence/manifest.yaml << 'YAML'
evidence:
  - path: non-existent.txt
YAML" \
    "PASS" \
    "adversarial-lab/gate-bypass/round-forgery/round-test-f3"

# F4 - Timestamp from future
run_test "F4" "Timestamp from future" \
    "mkdir -p adversarial-lab/gate-bypass/round-forgery/round-test-f4/product-flow && cat > adversarial-lab/gate-bypass/round-forgery/round-test-f4/product-flow/result.yaml << 'YAML'
reviewer: product-flow
score: 100
status: pass
timestamp: \"2099-12-31T23:59:59Z\"
recommendation: pass
YAML" \
    "PASS" \
    "adversarial-lab/gate-bypass/round-forgery/round-test-f4"

# F5 - Hidden files bypass
run_test "F5" "Hidden files bypass" \
    "mkdir -p adversarial-lab/gate-bypass/round-forgery/round-test-f5/product-flow && \
    mkdir -p adversarial-lab/gate-bypass/round-forgery/round-test-f5/.hidden-reviewer && \
    cat > adversarial-lab/gate-bypass/round-forgery/round-test-f5/product-flow/result.yaml << 'YAML'
reviewer: product-flow
score: 100
status: pass
recommendation: pass
YAML
    cat > adversarial-lab/gate-bypass/round-forgery/round-test-f5/.hidden-reviewer/result.yaml << 'YAML'
reviewer: hidden-reviewer
score: 0
status: fail
blockers:
  - P0: Hidden blocker
recommendation: fail
YAML" \
    "PASS" \
    "adversarial-lab/gate-bypass/round-forgery/round-test-f5"

# ==========================================
# SUMMARY
# ==========================================
echo ""
echo "=========================================="
echo "TEST SUMMARY"
echo "=========================================="
echo ""
echo -e "${GREEN}Blocked (Safe): $PASS_COUNT${NC}"
echo -e "${RED}Bypassed (Vulnerable): $FAIL_COUNT${NC}"
echo "Total: $TOTAL_COUNT"
echo ""

if [ $FAIL_COUNT -gt 0 ]; then
    echo -e "${RED}⚠ WARNING: $FAIL_COUNT bypass paths detected!${NC}"
    echo "Review the final report for remediation recommendations."
    exit 1
else
    echo -e "${GREEN}✓ All bypass attempts blocked!${NC}"
    exit 0
fi
